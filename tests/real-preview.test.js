import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadEquipmentDirectory } from '../server/equipment-files.js';
import { createLoadoutService } from '../server/loadout-service.js';
import { createAppServer } from '../server/http-server.js';
import { BitBuffer } from '../server/bit-buffer.js';
import { mockDatabase } from '../src/data/mock-database.js';
import { availableOperators, resolveAttachments } from '../src/domain/compatibility.js';
import { createController } from '../src/ui/controller.js';
import { requestLoadout, requestDatasets } from '../src/ui/remote-generator.js';

// Read the user's verified records without editing equipment or refreshing approvals.
// Synthetic providers below are test fixtures, never a production fallback.
const real = await loadEquipmentDirectory(fileURLToPath(new URL('../database/real/', import.meta.url)));
const fictional = await loadEquipmentDirectory(fileURLToPath(new URL('../database/example/', import.meta.url)));
const op = (db, id) => db.operators.find(item => item.id === id);
function scriptedProvider(db, operator, primaryId, secondaryId, offset = 0) {
  const draws = [];
  const plan = (choices, index) => { if (choices.length > 1) draws.push([Math.ceil(Math.log2(choices.length)), index]); };
  const pool = availableOperators(db, operator.side);
  plan(pool, pool.findIndex(item => item.id === operator.id));
  for (const [slot, id] of [['primary', primaryId], ['secondary', secondaryId]]) {
    plan(operator[slot], operator[slot].indexOf(id));
    for (const choices of Object.values(resolveAttachments(db, operator, id))) if (choices.length) plan(choices, offset % choices.length);
  }
  plan(operator.gadgets, offset % operator.gadgets.length);
  return { stats: { bitsConsumed: 0 }, async nextBits(k) {
    const next = draws.shift(); assert.ok(next, 'unexpected random draw'); assert.equal(k, next[0]);
    this.stats.bitsConsumed += k; return next[1];
  }, done() { assert.equal(draws.length, 0); } };
}
function validResult(db, result) {
  const operator = op(db, result.operatorId);
  assert.ok(availableOperators(db, result.side).some(item => item.id === operator.id));
  assert.equal(result.display.operator, operator.name);
  assert.ok(operator.gadgets.includes(result.gadgetId));
  assert.equal(result.display.gadget, db.gadgets.find(item => item.id === result.gadgetId).name);
  for (const slot of ['primary', 'secondary']) {
    const weapon = result[slot]; assert.ok(operator[slot].includes(weapon.id));
    assert.equal(result.display[slot].name, db.weapons.find(item => item.id === weapon.id).name);
    for (const [attachment, choices] of Object.entries(resolveAttachments(db, operator, weapon.id))) {
      if (!choices.length) {
        assert.equal(weapon.attachments[attachment], null); assert.equal(result.display[slot].attachments[attachment], null);
      } else {
        assert.ok(choices.includes(weapon.attachments[attachment]));
        assert.equal(result.display[slot].attachments[attachment], db.attachments.find(item => item.id === weapon.attachments[attachment]).name);
      }
    }
  }
}

test('checked-in Sledge and Smoke retain current verification and target-patch eligibility', () => {
  assert.equal(real.dataVersion.kind, 'real');
  assert.equal(real.dataVersion.status, 'ready');
  assert.ok(availableOperators(real, 'attack').some(item => item.id === 'sledge'));
  assert.ok(availableOperators(real, 'defense').some(item => item.id === 'smoke'));
});

test('Sledge Reaper MK2 exceptions and Smoke SMG-11 category inheritance stay distinct', async () => {
  const category = real.categories.find(item => item.id === 'machine-pistol').attachments;
  const reaper = resolveAttachments(real, op(real, 'sledge'), 'reaper-mk2');
  const smg = resolveAttachments(real, op(real, 'smoke'), 'smg-11');
  assert.deepEqual(reaper.optic, []); assert.deepEqual(reaper.grip, []);
  assert.deepEqual(reaper.barrel, ['flash-hider', 'compensator', 'muzzle-brake', 'suppressor', 'none']);
  assert.ok(!reaper.barrel.includes('extended-barrel'));
  assert.deepEqual(reaper.underbarrel, category.underbarrel);
  assert.deepEqual(smg, category);
  assert.ok(smg.barrel.includes('extended-barrel'));
  // Exercise every observed attachment choice, both primary/secondary options,
  // and both gadgets without probabilistic test outcomes or data changes.
  for (const id of ['sledge', 'smoke']) {
    const operator = op(real, id);
    for (const primary of operator.primary) for (const secondary of operator.secondary) {
      const choices = [...Object.values(resolveAttachments(real, operator, primary)), ...Object.values(resolveAttachments(real, operator, secondary)), operator.gadgets];
      for (let offset = 0; offset < Math.max(...choices.map(list => list.length)); offset++) {
        const provider = scriptedProvider(real, operator, primary, secondary, offset);
        const result = await createLoadoutService(mockDatabase, provider, { loadReal: async () => real }).generate(operator.side, 'real');
        validResult(real, result); provider.done();
      }
    }
  }
});

test('shared M590A1 and P226 use their shared definitions on both verified operators', async () => {
  for (const id of ['m590a1', 'p226-mk-25']) assert.deepEqual(resolveAttachments(real, op(real, 'sledge'), id), resolveAttachments(real, op(real, 'smoke'), id));
  for (const id of ['sledge', 'smoke']) {
    const operator = op(real, id); const provider = scriptedProvider(real, operator, 'm590a1', 'p226-mk-25');
    const result = await createLoadoutService(mockDatabase, provider, { loadReal: async () => real }).generate(operator.side, 'real');
    validResult(real, result);
    assert.equal(result.primary.attachments.barrel, null); assert.equal(result.primary.attachments.grip, null);
  }
});

test('fictional shared-weapon generation preserves category, weapon and operator exceptions', async () => {
  for (const id of ['demo-vector', 'demo-bastion']) {
    const operator = op(fictional, id);
    const provider = scriptedProvider(fictional, operator, 'demo-shared-rifle', 'demo-pistol', 1);
    const result = await createLoadoutService(fictional, provider).generate(operator.side);
    validResult(fictional, result);
    assert.equal(result.primary.attachments.optic, id === 'demo-vector' ? 'demo-dot' : 'demo-scope');
    assert.equal(result.primary.attachments.barrel, id === 'demo-vector' ? 'demo-suppressor' : 'none');
    assert.equal(result.primary.attachments.underbarrel, id === 'demo-vector' ? null : 'demo-laser');
  }
});

test('Draft, invalid structure, stale fingerprints/patch and incomplete sides consume zero buffered bits', async () => {
  for (const [mutate, code] of [
    [db => { db.dataVersion.status = 'draft'; }, 'DATA_DRAFT'],
    [db => { db.weapons[0].category = 'missing'; }, 'DATA_INVALID'],
    [db => { db.weapons.push(structuredClone(db.weapons[0])); }, 'DATA_INVALID'],
    [db => { db.dataVersion.patch = 'DIFFERENT-PATCH'; }, 'NO_ELIGIBLE'],
    [db => { op(db, 'sledge').verification.patch = 'OLD-PATCH'; }, 'NO_ELIGIBLE'],
    [db => { delete op(db, 'sledge').verification.fingerprint; }, 'NO_ELIGIBLE'],
    [db => { op(db, 'sledge').verification.status = 'draft'; }, 'NO_ELIGIBLE'],
    [db => { op(db, 'sledge').gadgets = null; }, 'NO_ELIGIBLE'],
    [db => { db.categories.find(item => item.id === 'machine-pistol').attachments.barrel.pop(); }, 'NO_ELIGIBLE'],
  ]) {
    const database = structuredClone(real); mutate(database);
    let calls = 0; const buffer = new BitBuffer(async () => { calls++; return new Uint8Array(64); });
    await buffer.nextBits(1); const before = { ...buffer.stats };
    const service = createLoadoutService(mockDatabase, buffer, { loadReal: async () => database });
    await assert.rejects(() => service.generate('attack', 'real'), error => error.code === code);
    assert.deepEqual(buffer.stats, before); assert.equal(calls, 1);
  }
});

test('metadata and switching need no randomness; real files are reloaded and a failure preserves the old result', async () => {
  let database = structuredClone(real), reads = 0, refills = 0;
  const buffer = new BitBuffer(async () => { refills++; return new Uint8Array(1024); });
  const service = createLoadoutService(mockDatabase, buffer, { loadReal: async () => { reads++; return structuredClone(database); } });
  const controller = createController({ generate: (side, dataset) => service.generate(side, dataset), loadDatasets: async () => Object.fromEntries((await service.describeDatasets()).datasets.map(item => [item.mode, item])) });
  await controller.refreshDatasets(); await controller.selectDataset('real');
  assert.equal(refills, 0); assert.equal(controller.state.result, null);
  assert.equal(controller.state.datasets.real.totalEligible, availableOperators(real, 'attack').length + availableOperators(real, 'defense').length);
  await controller.generateAll(); const previous = controller.state.result; const consumed = buffer.stats.bitsConsumed;
  database.dataVersion.status = 'draft';
  await controller.generateAll();
  assert.match(controller.state.error, /Draft/); assert.equal(controller.state.result, previous);
  assert.equal(buffer.stats.bitsConsumed, consumed); assert.equal(controller.state.datasets.real.status, 'draft');
  await controller.selectDataset('mock'); assert.equal(controller.state.result, previous);
  await controller.generateAll(); assert.equal(controller.state.result.dataset.mode, 'mock');
  assert.equal(refills, 1, 'mock and real reuse the same remaining bits'); assert.ok(reads >= 4);
});

test('load failures are sanitized, real mode never falls back, and mock still works', async () => {
  const buffer = new BitBuffer(async () => new Uint8Array(1024));
  const service = createLoadoutService(mockDatabase, buffer, { loadReal: async () => { throw new Error('PRIVATE PATH OR CONTENT'); } });
  const info = await service.describeDatasets();
  assert.ok(!JSON.stringify(info).includes('PRIVATE')); assert.equal(buffer.stats.bitsConsumed, 0);
  await assert.rejects(() => service.generate('attack', 'real'), error => error.code === 'DATA_LOAD');
  assert.equal(buffer.stats.bitsConsumed, 0);
  assert.equal((await service.generate('attack')).dataset.mode, 'mock');
});

test('real preview keeps its previous successful result when the shared bit buffer cannot refill', async () => {
  let refills = 0;
  const buffer = new BitBuffer(async () => { if (++refills > 1) throw new Error('Synthetic refill failure'); return new Uint8Array(8); });
  const service = createLoadoutService(mockDatabase, buffer, { loadReal: async () => real });
  const controller = createController({ generate: (side, dataset) => service.generate(side, dataset) });
  await controller.selectDataset('real'); await controller.generateAll();
  assert.equal(controller.state.result.operatorId, 'sledge');
  let previous;
  for (let attempt = 0; attempt < 10 && !controller.state.error; attempt++) { previous = controller.state.result; await controller.generateAll(); }
  assert.match(controller.state.error, /refill failure/);
  assert.equal(controller.state.result, previous); assert.equal(controller.state.selectedDataset, 'real');
  assert.equal(buffer.stats.bitsConsumed, 64); assert.equal(refills, 2);
});

test('an unverified defender is excluded without excluding the eligible attacker', async () => {
  const database = structuredClone(real); op(database, 'smoke').verification.status = 'needs-review';
  const buffer = new BitBuffer(async () => new Uint8Array(1024));
  const service = createLoadoutService(mockDatabase, buffer, { loadReal: async () => database });
  const summary = (await service.describeDatasets()).datasets.find(item => item.mode === 'real');
  assert.equal(summary.counts.defense, 0); assert.ok(summary.counts.attack > 0);
  await assert.rejects(() => service.generate('defense', 'real'), /No eligible Defense/);
  assert.equal(buffer.stats.bitsConsumed, 0);
  assert.equal((await service.generate('attack', 'real')).operatorId, 'sledge');
});

test('browser rejects an old or incomplete result before it can replace a displayed loadout', async () => {
  await assert.rejects(() => requestLoadout('attack', async () => Response.json({ result: { side: 'attack', randomness: { source: 'RANDOM.ORG' } } }), 'real'), /invalid loadout/);
});

test('HTTP preview exposes only summary and result labels and rejects arbitrary mode/path input', async t => {
  const service = createLoadoutService(mockDatabase, new BitBuffer(async () => new Uint8Array(1024)), { loadReal: async () => real });
  const server = createAppServer({ service });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(done => { server.close(done); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const localFetch = (path, options = {}) => fetch(base + path, { ...options, headers: { ...options.headers, Origin: base } });
  const summaries = await requestDatasets(localFetch); assert.equal(summaries.real.patch, real.dataVersion.patch);
  const result = await requestLoadout('attack', localFetch, 'real'); validResult(real, result);
  const exposed = JSON.stringify({ summaries, result });
  for (const forbidden of ['checkedBy', 'checkedOn', 'evidence', 'fingerprint', 'attachmentOverrides']) assert.ok(!exposed.includes(forbidden));
  for (const path of ['/database/real/operators/sledge.json', '/.env', '/server/datasets.js']) assert.equal((await localFetch(path)).status, 404);
  for (const body of [{ side: 'attack', dataset: '../real' }, { side: 'attack', dataset: 'real', path: '.env' }, { side: 'attack', dataset: null }]) assert.equal((await localFetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status, 400);
  assert.equal((await fetch(base + '/api/datasets', { headers: { Origin: 'https://example.org' } })).status, 403);
});

test('late metadata cannot overwrite fresh generation metadata; dataset switching is blocked while busy', async () => {
  let finishMetadata, finishGeneration;
  const summary = { mode: 'real', patch: 'current' };
  const controller = createController({ loadDatasets: () => new Promise(resolve => { finishMetadata = resolve; }), generate: () => new Promise(resolve => { finishGeneration = resolve; }) });
  const metadata = controller.refreshDatasets(); const pending = controller.generateAll();
  controller.selectDataset('real'); assert.equal(controller.state.selectedDataset, 'mock');
  finishGeneration({ dataset: summary }); await pending;
  finishMetadata({ real: { patch: 'old' } }); await metadata;
  assert.equal(controller.state.datasets.real.patch, 'current');
});
