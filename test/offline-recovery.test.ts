import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import type {BinaryNode} from '@whiskeysockets/baileys';
import {recoverOfflineSync} from '../src/offline-recovery.js';

test('stalled offline sync requests another batch, waits for activity, and stops on completion',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const ws=new EventEmitter(),sent:BinaryNode[]=[],events:string[]=[];
  const stop=recoverOfflineSync({ws,sendNode:async node=>{sent.push(node);}},event=>events.push(event));
  t.after(stop);
  t.mock.timers.tick(10000);
  assert.equal(sent.length,0);
  ws.emit('CB:ib,,offline_preview');
  t.mock.timers.tick(4000);
  ws.emit('frame',{tag:'message',attrs:{offline:'0'}});
  t.mock.timers.tick(4000);
  assert.equal(sent.length,0);
  t.mock.timers.tick(1000);
  await Promise.resolve();
  assert.deepEqual(sent,[{tag:'ib',attrs:{},content:[{tag:'offline_batch',attrs:{count:'100'}}]}]);
  ws.emit('CB:ib,,offline');
  t.mock.timers.tick(10000);
  assert.equal(sent.length,1);
  assert.ok(events.includes('offline-sync-complete'));
});

test('recovery is capped, stops on send failure, and cleans up socket listeners',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const ws=new EventEmitter();let sent=0;
  const stop=recoverOfflineSync({ws,sendNode:async()=>{sent++;}},()=>{});
  ws.emit('CB:ib,,offline_preview');
  for(let i=0;i<55;i++){t.mock.timers.tick(5000);await Promise.resolve();}
  assert.equal(sent,50);
  stop();
  assert.equal(ws.listenerCount('frame'),0);
  const failing=new EventEmitter();let attempts=0;
  const stopFailed=recoverOfflineSync({ws:failing,sendNode:async()=>{attempts++;throw new Error('private error');}},()=>{});
  t.after(stopFailed);
  failing.emit('CB:ib,,offline_preview');
  t.mock.timers.tick(5000);await Promise.resolve();
  t.mock.timers.tick(10000);
  assert.equal(attempts,1);
  failing.emit('CB:ib,,offline_preview');
  t.mock.timers.tick(10000);
  assert.equal(attempts,1);
  stopFailed();
  failing.emit('CB:ib,,offline_preview');
  t.mock.timers.tick(10000);
  assert.equal(attempts,1);
});

test('stopping while a batch send is pending does not schedule more requests',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const ws=new EventEmitter();let resolveSend!:()=>void, sent=0;
  const stop=recoverOfflineSync({ws,sendNode:()=>{sent++;return new Promise<void>(resolve=>{resolveSend=resolve;});}},()=>{});
  ws.emit('CB:ib,,offline_preview');
  t.mock.timers.tick(5000);
  stop();resolveSend();await Promise.resolve();
  t.mock.timers.tick(10000);
  assert.equal(sent,1);
});

test('offline activity during a slow send cannot start overlapping requests',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const ws=new EventEmitter();let resolveSend!:()=>void,sent=0;
  const stop=recoverOfflineSync({ws,sendNode:()=>{sent++;return new Promise<void>(resolve=>{resolveSend=resolve;});}},()=>{});
  t.after(stop);
  ws.emit('CB:ib,,offline_preview');
  t.mock.timers.tick(5000);
  ws.emit('frame',{tag:'notification',attrs:{offline:'1'}});
  t.mock.timers.tick(10000);
  assert.equal(sent,1);
  ws.emit('CB:ib,,offline');
  resolveSend();await Promise.resolve();
  ws.emit('CB:ib,,offline_preview');
  t.mock.timers.tick(10000);
  assert.equal(sent,1);
});
