import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Outbound, startOutboundServer, type OutboundConnection } from '../src/outbound.js';
import { Store } from '../src/store.js';

test('outbound preview disambiguates recipients and concurrent confirmation sends the exact text once', async t => {
  const store = new Store(':memory:');
  t.after(() => store.close());
  const account = '100@s.whatsapp.net';
  let finish!: (content: object) => void;
  const sent: string[][] = [];
  const connection: OutboundConnection = {
    account,
    groups: async () => [{jid:'300@g.us', name:'Rohit Yadav', kind:'group'}],
    phone: async () => undefined,
    send: (jid, text, id) => {
      assert.equal(store.isOutgoing('200@s.whatsapp.net', id), true);
      assert.equal(store.requestForMessage(jid, id), undefined);
      sent.push([jid, text, id]);
      return new Promise(resolve => { finish = resolve; });
    },
  };
  const outbound = new Outbound(store, () => connection);
  outbound.contact(account, '200@s.whatsapp.net', '200@s.whatsapp.net', 'Rohit Yadav');
  outbound.contact(account, '400@lid', '200@s.whatsapp.net', 'Rohit Yadav');
  outbound.contact('999@s.whatsapp.net', '201@s.whatsapp.net', undefined, 'Rohit Yadav');

  const text = 'Ready for review.\n';
  const matches = await outbound.preview('Rohit Yadav', text);
  assert.equal(matches.state, 'ambiguous');
  assert.deepEqual(matches.candidates?.map(candidate => candidate.jid), ['400@lid', '300@g.us']);
  const preview = await outbound.preview('contact:Rohit Yadav', text);
  assert.equal(preview.state, 'preview');
  assert.equal(preview.text, '🤖 ' + text);
  assert.deepEqual(sent, []);
  const id = preview.id!;
  const first = outbound.confirm(id);
  assert.equal((await outbound.confirm(id)).state, 'sending');
  finish({conversation:'🤖 ' + text});
  assert.equal((await first).state, 'sent');
  assert.equal((await outbound.confirm(id)).state, 'sent');
  assert.deepEqual(sent, [['400@lid', '🤖 ' + text, id]]);
});

test('expired and different-account previews cannot send, and uncertain sends stay in review across a restart', async t => {
  const directory = mkdtempSync(join(tmpdir(), 't3-outbound-'));
  const database = join(directory, 'bridge.sqlite');
  let store = new Store(database);
  t.after(() => { store.close(); rmSync(directory, {recursive:true, force:true}); });
  let now = 0;
  let attempts = 0;
  const connection: OutboundConnection = {
    account:'100@s.whatsapp.net',
    groups: async () => [],
    phone: async () => '123456789@s.whatsapp.net',
    send: async () => { attempts++; throw new Error('Connection lost during send'); },
  };
  let outbound = new Outbound(store, () => connection, () => now);
  const preview = () => outbound.preview('+123456789', 'Test');
  const expired = (await preview()).id!;
  now += 600_001;
  assert.equal((await outbound.confirm(expired)).state, 'unknown');

  const id = (await preview()).id!;
  connection.account = '200@s.whatsapp.net';
  await assert.rejects(outbound.confirm(id), /account changed/);
  assert.equal(attempts, 0);

  connection.account = '100@s.whatsapp.net';
  assert.equal((await outbound.confirm(id)).state, 'review');
  const interrupted = (await preview()).id!;
  store.beginDirectSend(interrupted, '123456789@s.whatsapp.net');
  store.close();
  store = new Store(database);
  outbound = new Outbound(store, () => connection, () => now);
  assert.equal((await outbound.confirm(id)).state, 'review');
  assert.equal(outbound.status(interrupted).state, 'review');
  assert.equal(attempts, 1);
  assert.deepEqual(store.pending(), []);
});

test('the T3 command previews over local IPC and sends only after confirmation', async t => {
  const directory = mkdtempSync(join(tmpdir(), 't3-outbound-cli-'));
  const store = new Store(':memory:');
  const config = join(directory, 'config.json');
  const account = '100@s.whatsapp.net';
  const sent: string[] = [];
  writeFileSync(config, JSON.stringify({dataDir:'.', allowedSenderJids:[account]}));
  const outbound = new Outbound(store, () => ({
    account,
    groups: async () => [{jid:'300@g.us', name:'Project team', kind:'group'}],
    phone: async () => undefined,
    send: async (jid, text) => { sent.push(jid, text); return {conversation:text}; },
  }));
  const endpoint = join(directory, 'outbound.json');
  const faults: unknown[] = [];
  const server = startOutboundServer(endpoint, outbound, error => faults.push(error));
  t.after(() => { server.close(); store.close(); rmSync(directory, {recursive:true, force:true}); });
  await once(server, 'listening');
  assert.equal(existsSync(endpoint), true);
  assert.deepEqual(faults, []);

  async function invoke(args: string[], input?: string) {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/outbound-cli.ts', '--config', config, ...args]);
    let output = '', errors = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { errors += chunk; });
    child.stdin.end(input);
    const [code] = await once(child, 'close');
    assert.equal(code, 0, errors || output);
    return JSON.parse(output);
  }

  const preview = await invoke(['preview', 'group:Project team'], '🤖 Ready.');
  assert.equal(preview.state, 'preview');
  assert.equal(preview.text, '🤖 Ready.');
  assert.deepEqual(sent, []);
  assert.equal((await invoke(['confirm', preview.id])).state, 'sent');
  assert.equal((await invoke(['status', preview.id])).state, 'sent');
  assert.deepEqual(sent, ['300@g.us', '🤖 Ready.']);
});
