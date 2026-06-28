import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readBody, MAX_BODY_BYTES } from '../../src/http.js';

test('readBody returns the full body as a UTF-8 string', async () => {
  const req = Readable.from([Buffer.from('hel'), Buffer.from('lo')]);
  assert.equal(await readBody(req), 'hello');
});

test('readBody reassembles a multi-byte char split across chunks', async () => {
  // The old `s += chunk` decoded each Buffer in isolation, mangling the boundary
  // byte; buffering then decoding once must yield the intact character.
  const euro = Buffer.from('€'); // 3 bytes: e2 82 ac
  const req = Readable.from([euro.subarray(0, 1), euro.subarray(1)]);
  assert.equal(await readBody(req), '€');
});

test('readBody rejects with status 413 once the body exceeds the limit', async () => {
  const req = Readable.from([Buffer.alloc(50, 0x61)]);
  await assert.rejects(
    () => readBody(req, 10),
    (e) => e.status === 413 && /too large/.test(e.message),
  );
});

test('readBody accepts a body exactly at the limit', async () => {
  const req = Readable.from([Buffer.alloc(10, 0x61)]);
  assert.equal(await readBody(req, 10), 'aaaaaaaaaa');
});

test('MAX_BODY_BYTES is the default cap (1 MiB)', () => {
  assert.equal(MAX_BODY_BYTES, 1 << 20);
});
