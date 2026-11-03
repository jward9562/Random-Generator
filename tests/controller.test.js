import test from 'node:test';
import assert from 'node:assert/strict';
import { createController, SIDE_STORAGE_KEY } from '../src/ui/controller.js';
import { mockDatabase } from '../src/data/mock-database.js';
import { generateLoadout } from '../src/domain/generate-loadout.js';

const withProvider = provider => ({ generate: side => generateLoadout(mockDatabase, side, provider) });
const options = withProvider({ nextBits: async () => 0 });
function memoryStorage() {
  const entries = new Map();
  return { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value) };
}

test('side persists across controller instances; invalid saved values fall back', () => {
  const storage = memoryStorage();
  const first = createController({ ...options, storage });
  assert.equal(first.state.selectedSide, 'attack');
  first.selectSide('defense');
  assert.equal(createController({ ...options, storage }).state.selectedSide, 'defense');
  storage.setItem(SIDE_STORAGE_KEY, 'invalid');
  assert.equal(createController({ ...options, storage }).state.selectedSide, 'attack');
});

test('blocked browser storage does not prevent side changes or generation', async () => {
  const storage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const controller = createController({ ...options, storage });
  controller.selectSide('defense');
  await controller.generateAll();
  assert.equal(controller.state.result.side, 'defense');
});

test('mid-generation failure keeps the entire previous result and allows retry', async () => {
  let calls = 0;
  let failAt = Infinity;
  const provider = { async nextBits() { if (++calls === failAt) throw new Error('test provider offline'); return 0; } };
  const controller = createController(withProvider(provider));
  await controller.generateAll();
  const previous = controller.state.result;
  assert.ok(previous);
  controller.selectSide('defense');
  failAt = calls + 3;
  await controller.generateAll();
  assert.equal(controller.state.result, previous);
  assert.equal(controller.state.result.side, 'attack');
  assert.equal(controller.state.selectedSide, 'defense');
  assert.match(controller.state.error, /offline/);
  assert.equal(controller.state.busy, false);
  failAt = Infinity;
  await controller.generateAll();
  assert.equal(controller.state.error, null);
  assert.equal(controller.state.result.side, 'defense');
});

test('first generation failure leaves no partial result', async () => {
  const controller = createController(withProvider({ async nextBits() { throw new Error('unavailable'); } }));
  await controller.generateAll();
  assert.equal(controller.state.result, null);
  assert.equal(controller.state.busy, false);
  assert.match(controller.state.error, /unavailable/);
});

test('pending requests block duplicate generation and side changes', async () => {
  let complete;
  let calls = 0;
  const controller = createController({ ...options, generate: () => { calls += 1; return new Promise(resolve => { complete = resolve; }); } });
  const pending = controller.generateAll();
  assert.equal(controller.state.busy, true);
  controller.selectSide('defense');
  await controller.generateAll();
  assert.equal(controller.state.selectedSide, 'attack');
  assert.equal(calls, 1);
  complete({ side: 'attack' });
  await pending;
  assert.equal(controller.state.busy, false);
});

test('opening the app and changing sides never requests a loadout', () => {
  let calls = 0;
  const controller = createController({ generate: () => { calls += 1; } });
  controller.selectSide('defense');
  controller.selectSide('attack');
  assert.equal(calls, 0);
  assert.equal(controller.state.result, null);
});
