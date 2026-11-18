import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
import { isSupportedChat } from './config.js';
import { withBotIcon } from './messages.js';
import type { Store } from './store.js';

export interface Recipient {
  jid: string;
  name: string;
  kind: 'contact' | 'group';
  phone?: string;
}

export interface OutboundConnection {
  account: string;
  groups(): Promise<Recipient[]>;
  phone(number: string): Promise<string | undefined>;
  send(jid: string, text: string, id: string): Promise<unknown>;
}

interface Draft {
  account: string;
  recipient: Recipient;
  text: string;
  expiresAt: number;
}

export class Outbound {
  private drafts = new Map<string, Draft>();

  constructor(
    private store: Store,
    private connection: () => OutboundConnection | undefined,
    private now = Date.now,
  ) {}

  contact(account: string, jid: string, phone?: string, name?: string) {
    if (!isSupportedChat(jid) || jid.endsWith('@g.us')) return;
    const previous = this.store.db.prepare(
      'SELECT jid, phone, name FROM outbound_contacts WHERE account=? AND (jid=? OR jid=? OR phone=?)',
    ).all(account, jid, phone ?? jid, phone ?? jid) as { jid: string; phone: string | null; name: string | null }[];
    const canonical = jid.endsWith('@lid') ? jid : previous.find(contact => contact.jid.endsWith('@lid'))?.jid ?? jid;
    const savedName = name ?? previous.find(contact => contact.name)?.name ?? null;
    const savedPhone = phone ?? previous.find(contact => contact.phone)?.phone ?? null;
    if (!savedName && !previous.length) return;
    this.store.atomic(() => {
      for (const contact of previous) {
        this.store.db.prepare('DELETE FROM outbound_contacts WHERE account=? AND jid=?').run(account, contact.jid);
      }
      this.store.db.prepare('INSERT INTO outbound_contacts VALUES (?,?,?,?)').run(account, canonical, savedPhone, savedName);
    });
  }

  private contacts(account: string): Recipient[] {
    return this.store.db.prepare(
      "SELECT jid, name, 'contact' AS kind, phone FROM outbound_contacts WHERE account=? AND name IS NOT NULL AND name<>''",
    ).all(account) as unknown as Recipient[];
  }

  private expireDrafts() {
    for (const [id, draft] of this.drafts) {
      if (draft.expiresAt <= this.now()) this.drafts.delete(id);
    }
  }

  async preview(selector: string, text: string) {
    if (!selector.trim() || selector.length > 256 || !text.trim() || Buffer.byteLength(text) > 12000) {
      throw new Error('Supply a recipient and a nonempty message of at most 12,000 UTF-8 bytes.');
    }
    const connection = this.connection();
    if (!connection) throw new Error('WhatsApp is disconnected. Try again when it reconnects.');

    const typed = /^(contact|group):/i.exec(selector.trim());
    const kind = typed?.[1].toLowerCase();
    const query = selector.trim().slice(typed?.[0].length ?? 0).trim();
    const phone = /^\+[1-9]\d{6,14}$/.test(query);
    let candidates: Recipient[];
    if (phone && kind !== 'group') {
      const jid = await connection.phone(query);
      candidates = jid && isSupportedChat(jid) && !jid.endsWith('@g.us')
        ? [{ jid, name: query, kind: 'contact' }]
        : [];
    } else {
      const contacts = kind === 'group' ? [] : this.contacts(connection.account);
      const groups = kind === 'contact' ? [] : await connection.groups();
      const normalized = (value: string) => value.normalize('NFKC').trim().toLowerCase();
      candidates = [...contacts, ...groups].filter(recipient => (
        recipient.jid === query || normalized(recipient.name) === normalized(query)
      ));
    }
    if (!candidates.length) return { state: 'not_found' };
    if (candidates.length !== 1) return { state: 'ambiguous', candidates };

    this.expireDrafts();
    if (this.drafts.size >= 128) throw new Error('Too many open previews. Retry after an earlier preview expires.');
    const id = '3EB0' + randomBytes(16).toString('hex').toUpperCase();
    const recipient = candidates[0];
    const expiresAt = this.now() + 10 * 60_000;
    const message = withBotIcon(text);
    this.drafts.set(id, { account: connection.account, recipient, text: message, expiresAt });
    return { state: 'preview', id, recipient, text: message, expiresAt };
  }

  status(id: string) {
    this.expireDrafts();
    return { id, state: this.store.directSendState(id) ?? (this.drafts.has(id) ? 'preview' : 'unknown') };
  }

  async confirm(id: string) {
    this.expireDrafts();
    const draft = this.drafts.get(id);
    if (!draft) return this.status(id);
    const connection = this.connection();
    if (!connection) throw new Error('WhatsApp is disconnected. The message was not sent.');
    if (connection.account !== draft.account) throw new Error('The connected WhatsApp account changed. Prepare a new preview.');

    this.store.beginDirectSend(id, draft.recipient.jid);
    this.drafts.delete(id);
    try {
      const content = await connection.send(draft.recipient.jid, draft.text, id);
      this.store.atomic(() => {
        this.store.remember(id, content);
        this.store.sentState(id, 'sent');
      });
    } catch {
      // The network may have failed after WhatsApp accepted the send.
      this.store.sentState(id, 'review');
    }
    return this.status(id);
  }
}

export function startOutboundServer(file: string, outbound: Outbound, onError: (error: unknown) => void) {
  const token = randomBytes(32).toString('hex');
  const server = createServer({ requestTimeout: 15_000, headersTimeout: 10_000 }, async (request, response) => {
    if (request.method !== 'POST' || request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(403).end();
      return;
    }
    const reply = (status: number, value: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
    };
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 80_000) {
          response.writeHead(413, { Connection: 'close' }).end();
          return;
        }
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> | null;
      if (request.url === '/preview' && typeof body?.recipient === 'string' && typeof body.text === 'string') {
        reply(200, await outbound.preview(body.recipient, body.text));
      } else if (typeof body?.id === 'string' && /^3EB0[A-F0-9]{32}$/.test(body.id)) {
        if (request.url === '/confirm') reply(200, await outbound.confirm(body.id));
        else if (request.url === '/status') reply(200, outbound.status(body.id));
        else reply(400, { error: 'Invalid outbound request.' });
      } else {
        reply(400, { error: 'Invalid outbound request.' });
      }
    } catch (error) {
      reply(400, { error: error instanceof Error ? error.message : 'Outbound request failed.' });
    }
  });

  server.on('error', onError);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    if (!address || typeof address === 'string') return;
    try {
      writeFileSync(file, JSON.stringify({ pid: process.pid, port: address.port, token }), { mode: 0o600 });
    } catch (error) {
      server.close();
      onError(error);
    }
  });
  return server;
}
