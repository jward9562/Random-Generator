import test from 'node:test';
import assert from 'node:assert/strict';
import { mockDatabase } from '../src/data/mock-database.js';
import { ATTACHMENT_SLOTS, availableOperators, resolveAttachments, validateDatabase } from '../src/domain/compatibility.js';
import { generateLoadout } from '../src/domain/generate-loadout.js';
import { choose } from '../src/random/selection.js';
import { LocalRandomProvider } from '../src/random/local-provider.js';

const copy = () => structuredClone(mockDatabase);
function sequence(values) {
  return { calls: 0, async nextUint32() { assert.ok(this.calls < values.length, 'unexpected random draw'); return values[this.calls++]; } };
}

test('fixture metadata explicitly identifies unverified mock data', () => {
  assert.equal(validateDatabase(mockDatabase), mockDatabase);
  assert.equal(mockDatabase.dataVersion.kind, 'mock');
  assert.equal(mockDatabase.dataVersion.verifiedPatch, null);
});

test('compatibility inherits defaults and replaces slots in weapon/operator order', () => {
  const db = copy();
  const operator = db.operators[0];
  operator.attachmentOverrides['demo-rifle'].barrel = ['mock-suppressor'];
  const actual = resolveAttachments(db, operator, 'demo-rifle');
  assert.deepEqual(actual.optic, ['mock-dot']);
  assert.deepEqual(actual.barrel, ['mock-suppressor']);
  assert.deepEqual(actual.grip, db.categories.rifle.grip);
  assert.deepEqual(resolveAttachments(mockDatabase, mockDatabase.operators[1], 'demo-rifle').barrel, ['none', 'mock-brake']);
  actual.grip.push('mutation');
  assert.ok(!db.categories.rifle.grip.includes('mutation'));
});

test('empty override removes a slot and unrelated operators keep their compatibility', () => {
  const db = copy();
  db.operators[0].attachmentOverrides['demo-rifle'].optic = [];
  assert.deepEqual(resolveAttachments(db, db.operators[0], 'demo-rifle').optic, []);
  assert.deepEqual(resolveAttachments(db, db.operators[1], 'demo-rifle').optic, db.categories.rifle.optic);
  assert.throws(() => resolveAttachments(db, db.operators[0], 'demo-compact'), /not available/);
});

test('singleton choices consume no randomness; empty choices fail explicitly', async () => {
  const provider = sequence([]);
  assert.equal(await choose(['fixed'], provider), 'fixed');
  assert.equal(provider.calls, 0);
  await assert.rejects(() => choose([], provider), /No valid choices/);
});

test('rejection sampling discards the incomplete 32-bit tail before modulo', async () => {
  const provider = sequence([0xffffffff, 0xfffffffe]);
  assert.equal(await choose(['a', 'b', 'c'], provider), 'c');
  assert.equal(provider.calls, 2);
  assert.equal(await choose(['a', 'b', 'c', 'd'], sequence([0xffffffff])), 'd');
});

test('accepted values map to every index at bucket boundaries', async () => {
  const choices = ['a', 'b', 'c'];
  for (const value of [0, 1, 2, 3, 4, 5, 0xfffffffc, 0xfffffffd, 0xfffffffe]) {
    assert.equal(await choose(choices, sequence([value])), choices[value % 3]);
  }
});

test('invalid, failed, and repeatedly rejected provider values fail', async () => {
  for (const value of [-1, 2 ** 32, 0.5, NaN, undefined, '2']) {
    await assert.rejects(() => choose([1, 2], sequence([value])), /invalid 32-bit/);
  }
  await assert.rejects(() => choose([1, 2], { nextUint32() { throw new Error('offline'); } }), /offline/);
  await assert.rejects(() => choose([1, 2, 3], { nextUint32: async () => 0xffffffff }), /rejection limit/);
});

test('a fully fixed loadout uses zero draws and preserves unavailable slots as null', async () => {
  const db = copy();
  db.operators = [{ ...db.operators[1], primary: ['demo-rifle'], secondary: ['demo-sidearm'], gadgets: ['demo-breach'] }];
  for (const category of Object.values(db.categories)) {
    for (const slot of ATTACHMENT_SLOTS) category[slot] = category[slot].length ? ['none'] : [];
  }
  db.weapons['demo-rifle'].attachmentOverrides = {};
  const provider = sequence([]);
  const result = await generateLoadout(db, 'attack', provider);
  assert.equal(provider.calls, 0);
  assert.equal(result.operatorId, 'demo-drift');
  assert.equal(result.primary.attachments.optic, 'none');
  assert.equal(result.secondary.attachments.grip, null);
  assert.equal(result.secondary.attachments.barrel, null);
  assert.deepEqual(result.dataVersion, db.dataVersion);
});

test('generated choices stay within side, inventory, and resolved attachment restrictions', async () => {
  let seed = 123456789;
  const provider = { async nextUint32() { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return seed >>> 0; } };
  const before = JSON.stringify(mockDatabase);
  const seen = new Set();
  for (const side of ['attack', 'defense']) {
    for (let run = 0; run < 200; run += 1) {
      const result = await generateLoadout(mockDatabase, side, provider);
      const operator = mockDatabase.operators.find(op => op.id === result.operatorId);
      seen.add(operator.id);
      assert.equal(operator.side, side);
      assert.ok(operator.gadgets.includes(result.gadgetId));
      for (const slot of ['primary', 'secondary']) {
        assert.ok(operator[slot].includes(result[slot].id));
        const allowed = resolveAttachments(mockDatabase, operator, result[slot].id);
        for (const attachmentSlot of ATTACHMENT_SLOTS) {
          const actual = result[slot].attachments[attachmentSlot];
          if (!allowed[attachmentSlot].length) assert.equal(actual, null);
          else assert.ok(allowed[attachmentSlot].includes(actual));
        }
      }
    }
  }
  assert.equal(seen.size, mockDatabase.operators.length);
  assert.equal(JSON.stringify(mockDatabase), before);
});

test('operator count is derived from the current database and empty sides fail', async () => {
  const db = copy();
  const previous = availableOperators(db, 'attack').length;
  db.operators.push({ ...structuredClone(db.operators[1]), id: 'additional-fixture' });
  assert.equal(availableOperators(db, 'attack').length, previous + 1);
  db.operators = db.operators.filter(op => op.side === 'attack');
  await assert.rejects(() => generateLoadout(db, 'defense', sequence([])), /No valid choices/);
  assert.throws(() => availableOperators(db, 'invalid'), /Choose attack or defense/);
});

test('invalid compatibility data is rejected before randomness is consumed', async () => {
  const mutations = [
    db => { db.categories.rifle.optic = ['missing']; },
    db => { db.weapons['demo-rifle'].attachmentOverrides.barrel = ['none', 'none']; },
    db => { db.operators[0].attachmentOverrides['demo-rifle'].optic = ['missing']; },
    db => { db.operators[0].attachmentOverrides['demo-compact'] = { optic: [] }; },
    db => { db.operators[0].primary = ['demo-pistol']; },
    db => { db.operators[0].gadgets = []; },
    db => { db.operators.push(db.operators[0]); },
    db => { db.weapons['demo-rifle'].category = 'missing'; },
    db => { db.categories.rifle.typo = []; },
    db => { delete db.categories.rifle.optic; },
    db => { db.dataVersion.kind = 'verified'; },
    db => { db.dataVersion.verifiedPatch = 'pretend-patch'; },
  ];
  for (const mutate of mutations) {
    const db = copy();
    mutate(db);
    const provider = sequence([]);
    await assert.rejects(() => generateLoadout(db, 'attack', provider), /Invalid database/);
    assert.equal(provider.calls, 0);
  }
});

test('local provider supplies 32-bit values and labels the source honestly', async () => {
  const provider = new LocalRandomProvider();
  const value = await provider.nextUint32();
  assert.ok(Number.isInteger(value) && value >= 0 && value < 2 ** 32);
  assert.match(provider.label, /not RANDOM\.ORG/);
});
