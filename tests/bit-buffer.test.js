import test from 'node:test';
import assert from 'node:assert/strict';
import { BitBuffer } from '../server/bit-buffer.js';
import { choose } from '../src/random/selection.js';
import { createLoadoutService } from '../server/loadout-service.js';
import { mockDatabase } from '../src/data/mock-database.js';

test('bits are consumed MSB-first, across bytes and blocks, without eager refills', async () => {
  const blocks = [Uint8Array.of(0b10110110, 0b01001111), Uint8Array.of(0b11000000)];
  let calls = 0;
  const buffer = new BitBuffer(async () => blocks[calls++]);
  assert.equal(calls, 0);
  assert.equal(await buffer.nextBits(3), 5);
  assert.equal(await buffer.nextBits(5), 22);
  assert.equal(calls, 1);
  assert.equal(await buffer.nextBits(10), 319);
  assert.equal(calls, 2);
  assert.deepEqual(buffer.stats, { bitsRemaining: 6, bitsConsumed: 18, blocksFetched: 2 });
});

test('single choices consume no bits and never fetch even with an empty buffer', async () => {
  const buffer = new BitBuffer(() => { throw new Error('must not fetch'); });
  assert.equal(await choose(['only'], buffer), 'only');
  assert.equal(buffer.stats.bitsConsumed, 0);
});

test('rejected values are consumed rather than recycled', async () => {
  const buffer = new BitBuffer(async () => Uint8Array.of(0b11100100));
  assert.equal(await choose(['a', 'b', 'c'], buffer), 'c');
  assert.equal(buffer.stats.bitsConsumed, 4);
  assert.equal(await choose(['a', 'b', 'c'], buffer), 'b');
  assert.equal(buffer.stats.bitsConsumed, 6);
});

test('failed refill never rewinds bits consumed by an incomplete read', async () => {
  let calls = 0;
  const buffer = new BitBuffer(async () => {
    if (++calls === 2) throw new Error('offline');
    return Uint8Array.of(calls === 1 ? 0xff : 0x40);
  });
  assert.equal(await buffer.nextBits(6), 63);
  await assert.rejects(() => buffer.nextBits(4), /offline/);
  assert.equal(buffer.stats.bitsConsumed, 8);
  assert.equal(await buffer.nextBits(2), 1);
  assert.equal(buffer.stats.bitsConsumed, 10);
});

test('overlapping reads serialize refills and consume disjoint bits', async () => {
  let calls = 0;
  const buffer = new BitBuffer(async () => { calls += 1; return Uint8Array.of(0x12, 0x34); });
  assert.deepEqual(await Promise.all([buffer.nextBits(4), buffer.nextBits(4), buffer.nextBits(8)]), [1, 2, 52]);
  assert.equal(calls, 1);
  assert.equal(buffer.stats.bitsRemaining, 0);
});

test('multiple loadouts reuse unused true bits; exhaustion fails without a partial result', async () => {
  let calls = 0;
  const buffer = new BitBuffer(async () => { if (++calls > 1) throw new Error('offline'); return new Uint8Array(16); });
  const service = createLoadoutService(mockDatabase, buffer);
  let successes = 0;
  while (true) {
    try {
      const result = await service.generate('attack');
      assert.equal(result.randomness.source, 'RANDOM.ORG');
      assert.ok(result.randomness.bitsConsumed > 0);
      successes += 1;
    } catch (error) { assert.match(error.message, /offline/); break; }
  }
  assert.ok(successes > 1);
  assert.equal(calls, 2);
  assert.equal(buffer.stats.bitsConsumed, 128);
});

test('fully fixed results do not claim use of RANDOM.ORG', async () => {
  const db = structuredClone(mockDatabase);
  db.operators = [{ ...db.operators[1], secondary: ['demo-sidearm'] }];
  for (const category of Object.values(db.categories)) for (const slot of Object.keys(category)) category[slot] = ['none'];
  db.weapons['demo-rifle'].attachmentOverrides = {};
  const buffer = new BitBuffer(() => { throw new Error('must not fetch'); });
  const result = await createLoadoutService(db, buffer).generate('attack');
  assert.deepEqual(result.randomness, { source: 'none-required', method: null, bitsConsumed: 0 });
});

test('service rejects overlapping generations without extra consumption', async () => {
  let resolve;
  const buffer = new BitBuffer(() => new Promise(done => { resolve = done; }));
  const service = createLoadoutService(mockDatabase, buffer);
  const pending = service.generate('attack');
  await assert.rejects(() => service.generate('defense'), /Another loadout/);
  resolve(new Uint8Array(32));
  await pending;
});
