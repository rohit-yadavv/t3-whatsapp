import test from 'node:test';
import assert from 'node:assert/strict';
import { disconnectAction, streamErrorReason } from '../src/connection.js';

test('pairing restart is retried, terminal account failures stop, network errors back off', () => {
  assert.equal(disconnectAction(515),'restart');
  for (const code of [401,403,411,440,500]) assert.equal(disconnectAction(code),'stop');
  for (const code of [408,428,503,undefined]) assert.equal(disconnectAction(code),'retry');
});

test('known ack stream errors retry within a limit; other session failures stop', () => {
  assert.equal(streamErrorReason(new Error('Stream Errored (ack)')),'ack');
  assert.equal(disconnectAction(500,'ack',0),'retry');
  assert.equal(disconnectAction(500,'ack',2),'retry');
  assert.equal(disconnectAction(500,'ack',3),'stop');
  assert.equal(disconnectAction(500),'stop');
  assert.equal(disconnectAction(500,'other-stream-error'),'stop');
  assert.equal(disconnectAction(401,'ack'),'stop');
  assert.equal(disconnectAction(403,'ack'),'stop');
});
test('disconnect diagnostics do not expose arbitrary error text', () => {
  assert.equal(streamErrorReason(new Error('secret token abc123')),undefined);
  assert.equal(streamErrorReason(new Error('Stream Errored (private data)')),'other-stream-error');
  assert.equal(streamErrorReason(null),undefined);
});
