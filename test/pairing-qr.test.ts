import test from 'node:test';
import assert from 'node:assert/strict';
import { pairingQrPng } from '../src/pairing-qr.js';

test('pairing QR is a full-size square PNG suitable for a separate image viewer', async () => {
  const png = await pairingQrPng('synthetic-test-pairing-payload,'.repeat(12));
  assert.deepEqual([...png.subarray(0,8)], [137,80,78,71,13,10,26,10]);
  const width=png.readUInt32BE(16), height=png.readUInt32BE(20);
  assert.equal(width,height);
  assert.ok(width>=600, `QR is too small: ${width}`);
});
