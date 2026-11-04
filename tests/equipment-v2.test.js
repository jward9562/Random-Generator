import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEquipmentDirectory, parseEquipmentJson } from '../server/equipment-files.js';
import { inspectEquipmentDatabase } from '../src/domain/equipment-v2.js';
import { availableOperators, resolveAttachments, validateDatabase } from '../src/domain/compatibility.js';
import { generateLoadout } from '../src/domain/generate-loadout.js';
import { mockDatabase } from '../src/data/mock-database.js';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verificationFingerprint } from '../src/domain/verification.js';

const example = await loadEquipmentDirectory(fileURLToPath(new URL('../database/example', import.meta.url)));
const copy = () => structuredClone(example);
const operator = (db, id) => db.operators.find(op => op.id === id);
const codes = db => inspectEquipmentDatabase(db).issues.map(issue => issue.code);
const reviewAgain = db => { for (const op of db.operators) if (op.verification?.status === 'verified') op.verification.fingerprint = verificationFingerprint(db, op); };

test('fictional v2 examples load; only complete patch-verified operators enter the pool', () => {
  const report = inspectEquipmentDatabase(example);
  assert.ok(report.issues.every(issue => issue.severity === 'warning'));
  assert.deepEqual(availableOperators(example, 'attack').map(op => op.id), ['demo-vector']);
  assert.deepEqual(availableOperators(example, 'defense').map(op => op.id), ['demo-bastion']);
  assert.ok(report.issues.some(issue => issue.path.includes('demo-unfinished')));
});

test('shared weapons inherit category lists, weapon changes, then distinct operator restrictions', () => {
  const vector = resolveAttachments(example, operator(example, 'demo-vector'), 'demo-shared-rifle');
  const bastion = resolveAttachments(example, operator(example, 'demo-bastion'), 'demo-shared-rifle');
  assert.deepEqual(vector.optic, ['none', 'demo-dot']);
  assert.deepEqual(bastion.optic, ['demo-scope']);
  assert.deepEqual(vector.barrel, ['none', 'demo-suppressor']);
  assert.deepEqual(bastion.barrel, ['none']);
  assert.deepEqual(vector.grip, ['none', 'demo-grip']);
  assert.deepEqual(vector.underbarrel, []);
  assert.deepEqual(bastion.underbarrel, ['none', 'demo-laser']);
  vector.grip.push('changed-copy');
  assert.deepEqual(example.categories[0].attachments.grip, ['none', 'demo-grip']);
});

test('same-category weapons may have different attachment exceptions', () => {
  const db = copy();
  const op = operator(db, 'demo-vector');
  db.weapons.push({ id: 'demo-other-rifle', name: 'Other fictional rifle', category: 'demo-rifle-category', slot: 'primary', attachmentOverrides: { optic: ['none'], grip: [] } });
  op.primary.push('demo-other-rifle');
  op.verification.weaponsChecked.push('demo-other-rifle');
  reviewAgain(db); // Simulate an explicit new manual check of the changed fixture.
  assert.deepEqual(resolveAttachments(db, op, 'demo-other-rifle').optic, ['none']);
  assert.deepEqual(resolveAttachments(db, op, 'demo-other-rifle').grip, []);
  assert.deepEqual(resolveAttachments(db, op, 'demo-shared-rifle').grip, ['none', 'demo-grip']);
  assert.equal(availableOperators(db, 'attack').length, 1);
});

test('operator additions can grant a known attachment absent from inherited choices', () => {
  const db = copy();
  operator(db, 'demo-vector').attachmentOverrides['demo-shared-rifle'].barrel = { add: ['demo-brake'] };
  reviewAgain(db);
  assert.deepEqual(resolveAttachments(db, operator(db, 'demo-vector'), 'demo-shared-rifle').barrel, ['none', 'demo-suppressor', 'demo-brake']);
  assert.equal(availableOperators(db, 'attack').length, 1);
});

test('null is unknown, [] is unavailable, and none is a real available choice', async () => {
  const db = copy();
  const result = await generateLoadout(db, 'attack', { nextBits: async () => 0 });
  assert.equal(result.primary.attachments.underbarrel, null);
  assert.equal(result.secondary.attachments.optic, 'none');
  db.categories[0].attachments.grip = null;
  assert.equal(availableOperators(db, 'attack').length, 0);
  assert.ok(codes(db).includes('INCOMPLETE'));
  db.weapons[0].attachmentOverrides.grip = ['none'];
  reviewAgain(db);
  assert.equal(availableOperators(db, 'attack').length, 1, 'a complete weapon replacement can resolve an unknown category slot');
});

test('draft, needs-review, missing verification and stale patches exclude operators', () => {
  for (const mutate of [
    op => { op.verification.status = 'draft'; },
    op => { op.verification.status = 'needs-review'; },
    op => { delete op.verification; },
    op => { op.verification.patch = 'OLD-FICTIONAL-PATCH'; },
    op => { op.verification.checkedOn = '2026-02-30'; },
    op => { op.verification.checkedBy = ''; },
    op => { op.verification.evidence = []; },
    op => { op.verification.weaponsChecked = ['demo-shared-rifle']; },
    op => { op.primary = []; op.attachmentOverrides = {}; },
    op => { op.gadgets = null; },
  ]) {
    const db = copy();
    mutate(operator(db, 'demo-vector'));
    assert.equal(availableOperators(db, 'attack').length, 0);
    assert.equal(availableOperators(db, 'defense').length, 1);
  }
});

test('dataset gate and patch changes prevent accidental promotion', async () => {
  for (const mutate of [
    db => { db.dataVersion.status = 'draft'; },
    db => { db.dataVersion.patch = null; },
    db => { db.dataVersion.patch = 'NEXT-FICTIONAL-PATCH'; },
  ]) {
    const db = copy();
    db.dataVersion.kind = 'real'; // Synthetic real-mode test, not a game claim.
    mutate(db);
    assert.equal(availableOperators(db, 'attack').length, 0);
    await assert.rejects(() => generateLoadout(db, 'attack', { nextBits() { assert.fail('must not draw'); } }), /No valid choices/);
  }
});

test('real v2 pool contains only reviewed records and uses existing generation', async () => {
  const db = copy();
  db.dataVersion.kind = 'real';
  reviewAgain(db);
  const result = await generateLoadout(db, 'attack', { nextBits: async () => 0 });
  assert.equal(result.operatorId, 'demo-vector');
  assert.deepEqual(result.dataVersion, db.dataVersion);
});

test('missing names on dependencies prevent eligible incomplete loadouts', () => {
  for (const mutate of [
    db => { db.weapons[0].name = ''; },
    db => { db.categories[0].name = ''; },
    db => { db.attachments.find(item => item.id === 'demo-dot').name = ''; },
    db => { db.gadgets.find(item => item.id === 'demo-smoke').name = ''; },
  ]) {
    const db = copy();
    mutate(db);
    assert.equal(availableOperators(db, 'attack').length, 0);
  }
});

test('all catalog IDs, missing references and wrong attachment types are reported', () => {
  const db = copy();
  for (const key of ['attachments', 'categories', 'weapons', 'gadgets', 'operators']) db[key].push(structuredClone(db[key][0]));
  db.categories[0].attachments.optic.push('missing-sight', 'demo-grip');
  db.weapons[1].category = 'missing-category';
  operator(db, 'demo-vector').gadgets.push('missing-gadget');
  const report = inspectEquipmentDatabase(db);
  assert.equal(report.issues.filter(issue => issue.code === 'DUPLICATE_ID').length, 5);
  assert.ok(report.issues.filter(issue => issue.code === 'MISSING_REFERENCE').length >= 3);
  assert.ok(codes(db).includes('WRONG_ATTACHMENT_SLOT'));
  assert.deepEqual(report.eligibleOperators, []);
  assert.throws(() => validateDatabase(db), /Invalid database/);
});

test('invalid override operations fail closed before any random draw', async () => {
  const cases = [
    { optic: { remove: ['demo-laser'] } },
    { optic: { add: ['demo-dot'] } },
    { optic: { add: ['demo-scope'], remove: ['demo-scope'] } },
    { optic: { add: ['missing-sight'] } },
    { optic: ['demo-dot', 'demo-dot'] },
    { optic: { add: null } },
    { optic: { replace: ['demo-dot'] } },
    { optcis: [] },
    { optic: {} },
  ];
  for (const change of cases) {
    const db = copy();
    operator(db, 'demo-vector').attachmentOverrides['demo-shared-rifle'] = change;
    await assert.rejects(() => generateLoadout(db, 'attack', { nextBits() { assert.fail('must not draw'); } }), /Invalid database/);
  }
  const db = copy();
  operator(db, 'demo-vector').attachmentOverrides['unavailable-weapon'] = { optic: [] };
  assert.ok(codes(db).includes('UNAVAILABLE_WEAPON'));
  db.categories[0].attachments.optic = null;
  assert.ok(codes(db).includes('UNKNOWN_BASE'));
});

test('malformed records yield structured diagnostics rather than validator crashes', () => {
  for (const db of [null, {}, { ...copy(), weapons: null }, { ...copy(), operators: [null] }, { ...copy(), categories: [null] }]) {
    assert.ok(inspectEquipmentDatabase(db).issues.some(issue => issue.severity === 'error'));
  }
  for (const mutate of [
    db => { db.dataVersion.id = ''; },
    db => { db.dataVersion.status = 'verfied'; },
    db => { db.dataVersion.kind = 'verified'; },
    db => { db.dataVersion.patch = 123; },
  ]) {
    const db = copy();
    mutate(db);
    assert.throws(() => validateDatabase(db), /Invalid database/);
  }
});

test('v1 mock compatibility remains supported but a legacy verified flag cannot bypass review', () => {
  assert.equal(validateDatabase(mockDatabase), mockDatabase);
  const old = structuredClone(mockDatabase);
  old.dataVersion = { id: 'legacy', kind: 'verified', verifiedPatch: 'DEMO' };
  assert.throws(() => validateDatabase(old), /schema version 2/);
  assert.throws(() => availableOperators(old, 'attack'), /schema version 2/);
});

test('JSON reader rejects duplicate properties including escaped spelling', () => {
  assert.throws(() => parseEquipmentJson('{"id":"one","id":"two"}'), /duplicate JSON property/);
  assert.throws(() => parseEquipmentJson('{"id":"one","\\u0069d":"two"}'), /duplicate JSON property/);
  assert.throws(() => parseEquipmentJson('{"optic":{"add":[],"add":[]}}'), /duplicate JSON property/);
  assert.deepEqual(parseEquipmentJson('[{"id":"one"},{"id":"two"}]'), [{ id: 'one' }, { id: 'two' }]);
  assert.throws(() => parseEquipmentJson('{"id":}'), /invalid JSON/);
});

test('an empty draft workspace has no eligible operators', () => {
  const db = { schemaVersion: 2, dataVersion: { id: 'empty-draft', kind: 'real', patch: null, status: 'draft' }, attachments: [], categories: [], weapons: [], gadgets: [], operators: [] };
  assert.equal(inspectEquipmentDatabase(db).eligibleOperators.length, 0);
});

test('validator CLI reports draft findings; strict mode fails incomplete data', () => {
  const script = fileURLToPath(new URL('../scripts/validate-data.mjs', import.meta.url));
  const ordinary = spawnSync(process.execPath, [script, 'database/example'], { encoding: 'utf8' });
  assert.equal(ordinary.status, 0, ordinary.stderr);
  assert.match(ordinary.stdout, /Eligible attack: 1/);
  assert.match(ordinary.stdout, /demo-unfinished/);
  const strict = spawnSync(process.execPath, [script, 'database/example', '--strict'], { encoding: 'utf8' });
  assert.equal(strict.status, 1);
});
