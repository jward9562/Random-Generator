import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, cp, readFile, writeFile, readdir, rm, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { get } from 'node:http';
import { EditorStore } from '../server/editor-store.js';
import { createEditorServer } from '../server/editor-http.js';
import { loadEquipmentDirectory } from '../server/equipment-files.js';
import { verificationFingerprint, verificationIsCurrent, sha256 } from '../src/domain/verification.js';
import { inspectEquipmentDatabase } from '../src/domain/equipment-v2.js';
import { createEditorModel, operatorState } from '../editor/model.js';

const fixture = await loadEquipmentDirectory('database/example');
async function directory(t) {
  const parent = resolve('.local/editor-tests'); await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'case-')); await cp('database/example', dir, { recursive: true });
  t.after(async () => { assert.ok(dir.startsWith(parent + '\\') || dir.startsWith(parent + '/')); await rm(dir, { recursive: true, force: true }); });
  return dir;
}
function payload(snapshot) { return { database: structuredClone(snapshot.database), revision: snapshot.revision, verifyIds: [] }; }
const vector = db => db.operators.find(op => op.id === 'demo-vector');

test('browser-compatible SHA-256 agrees with Node for known and multi-block UTF-8 inputs', () => {
  for (const value of ['', 'abc', '🌈 Siege '.repeat(100), 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64)]) assert.equal(sha256(value), createHash('sha256').update(value).digest('hex'));
});

test('operator, category, weapon, attachment, gadget, evidence and patch edits invalidate fingerprints', () => {
  for (const mutate of [
    db => { vector(db).name += ' changed'; },
    db => { vector(db).side = 'defense'; },
    db => { vector(db).attachmentOverrides['demo-shared-rifle'].optic = ['none']; },
    db => { db.weapons[0].name += ' changed'; },
    db => { db.categories[0].attachments.grip = []; },
    db => { db.attachments[1].name += ' changed'; },
    db => { db.gadgets.find(item => item.id === 'demo-smoke').name += ' changed'; },
    db => { vector(db).verification.evidence.push('new note'); },
    db => { db.dataVersion.patch = 'NEXT-PATCH'; },
  ]) {
    const db = structuredClone(fixture); assert.ok(verificationIsCurrent(db, vector(db))); mutate(db);
    assert.ok(!verificationIsCurrent(db, vector(db)));
    assert.ok(!inspectEquipmentDatabase(db).eligibleOperators.some(op => op.id === 'demo-vector'));
  }
});

test('unrelated equipment and JSON property order do not invalidate a reviewed operator', () => {
  const db = structuredClone(fixture);
  db.gadgets.push({ id: 'unrelated', name: 'Unrelated fictional gadget' });
  db.dataVersion.id = 'new-revision';
  db.weapons.reverse(); db.categories.reverse(); db.attachments.reverse();
  vector(db).verification = Object.fromEntries(Object.entries(vector(db).verification).reverse());
  assert.ok(verificationIsCurrent(db, vector(db)));
});

test('loading outside edits marks affected operators needs-review without silently rewriting files', async t => {
  const dir = await directory(t); const store = new EditorStore(dir);
  const path = join(dir, 'weapons.json'); const weapons = JSON.parse(await readFile(path)); weapons[0].name = 'Externally changed'; await writeFile(path, JSON.stringify(weapons));
  const loaded = await store.load(); assert.equal(vector(loaded.database).verification.status, 'needs-review');
  const raw = JSON.parse(await readFile(join(dir, 'operators/demo-vector.json'))); assert.equal(raw.verification.status, 'verified');
  assert.equal(operatorState(loaded.database, vector(loaded.database)), 'Needs review');
});

test('create and save incomplete drafts; shared edits invalidate all affected saved verification', async t => {
  const dir = await directory(t); const store = new EditorStore(dir); const initial = await store.load(); const input = payload(initial);
  input.database.operators.push({ id: 'fictional-new', name: 'Fictional new operator', side: 'attack', primary: null, secondary: null, gadgets: null, verification: { status: 'draft' } });
  input.database.categories[0].attachments.grip = [];
  const saved = await store.save(input);
  assert.equal(vector(saved.database).verification.status, 'needs-review');
  assert.equal(saved.database.operators.find(op => op.id === 'demo-bastion').verification.status, 'needs-review');
  assert.equal(JSON.parse(await readFile(join(dir, 'operators/fictional-new.json'))).verification.status, 'draft');
  assert.equal((await store.load()).revision, saved.revision);
  assert.ok((await readdir(join(dir, '.editor-backups'))).length > 0);
});

test('validation errors leave original files intact and model retains unsaved edits', async t => {
  const store = new EditorStore(await directory(t)); const initial = await store.load(); const model = createEditorModel(initial);
  model.database.weapons[0].category = 'missing-category'; model.change();
  await assert.rejects(() => store.save(model.payload()), error => error.status === 422 && error.issues.some(issue => issue.code === 'MISSING_REFERENCE'));
  assert.equal((await store.load()).revision, initial.revision);
  assert.equal(model.database.weapons[0].category, 'missing-category'); assert.equal(model.dirty, true);
});

test('stale tabs cannot overwrite external edits', async t => {
  const dir = await directory(t); const store = new EditorStore(dir); const initial = await store.load();
  await writeFile(join(dir, 'gadgets.json'), JSON.stringify([...fixture.gadgets, { id: 'external', name: 'External fictional entry' }]));
  await assert.rejects(() => store.save(payload(initial)), error => error.status === 409);
  assert.ok((await store.load()).database.gadgets.some(item => item.id === 'external'));
});

test('interrupted writes roll back and retain a recovery backup', async t => {
  const dir = await directory(t); let writes = 0;
  const store = new EditorStore(dir, { beforeWrite: async () => { if (++writes === 2) throw new Error('simulated disk failure'); } });
  const initial = await store.load(); const input = payload(initial); input.database.dataVersion.id = 'changed'; input.database.gadgets[0].name = 'changed';
  await assert.rejects(() => store.save(input), /original files were restored/);
  assert.equal((await store.load()).revision, initial.revision);
  assert.ok((await readdir(join(dir, '.editor-backups'))).length > 0);
});

test('startup recovery restores an interrupted transaction and refuses unrelated external changes', async t => {
  const dir = await directory(t); const path = join(dir, 'metadata.json'); const before = await readFile(path, 'utf8'); const after = before.replace('fictional-authoring-example-v1', 'interrupted');
  const journal = { version: 1, changes: [{ path: 'metadata.json', before, after }] };
  await writeFile(join(dir, '.editor-recovery.json'), JSON.stringify(journal)); await writeFile(path, after);
  await new EditorStore(dir).load(); assert.equal(await readFile(path, 'utf8'), before);
  await writeFile(join(dir, '.editor-recovery.json'), JSON.stringify(journal)); await writeFile(path, before + '\n');
  await assert.rejects(() => new EditorStore(dir).load(), /external change/);
  assert.equal(await readFile(path, 'utf8'), before + '\n');
});

test('explicit re-verification is required; a forged refreshed client fingerprint is not accepted', async t => {
  const store = new EditorStore(await directory(t)); let loaded = await store.load(); let input = payload(loaded);
  vector(input.database).name += ' updated'; vector(input.database).verification.fingerprint = verificationFingerprint(input.database, vector(input.database));
  loaded = await store.save(input); assert.equal(vector(loaded.database).verification.status, 'needs-review');
  input = payload(loaded); input.verifyIds = ['demo-vector'];
  loaded = await store.save(input); assert.ok(verificationIsCurrent(loaded.database, vector(loaded.database)));
  input = payload(loaded); vector(input.database).primary = null; delete vector(input.database).attachmentOverrides; input.verifyIds = ['demo-vector'];
  await assert.rejects(() => store.save(input), /cannot be verified/);
});

test('pending manual confirmations are cancelled if their dependencies change before save', () => {
  const model = createEditorModel({ database: fixture, revision: 'test' }); model.confirm('demo-vector');
  assert.deepEqual(model.payload().verifyIds, ['demo-vector']);
  model.database.categories[0].attachments.grip = []; model.change();
  assert.deepEqual(model.payload().verifyIds, []); assert.equal(vector(model.database).verification.status, 'needs-review');
});

test('choosing Draft cancels a pending verification instead of re-verifying on save', () => {
  const model = createEditorModel({ database: fixture, revision: 'test' }); model.confirm('demo-vector');
  vector(model.database).verification.status = 'draft'; model.change();
  assert.deepEqual(model.payload().verifyIds, []);
  assert.equal(vector(model.database).verification.status, 'draft');
});

test('simultaneous saves serialize and reject the stale second revision', async t => {
  const store = new EditorStore(await directory(t)); const initial = await store.load();
  const first = payload(initial); first.database.gadgets[0].name = 'First edit';
  const second = payload(initial); second.database.gadgets[0].name = 'Second edit';
  const results = await Promise.allSettled([store.save(first), store.save(second)]);
  assert.equal(results[0].status, 'fulfilled');
  assert.equal(results[1].reason.status, 409);
  assert.equal((await store.load()).database.gadgets[0].name, 'First edit');
});

test('unknown exceptions remain unknown, not unavailable or inherited', async t => {
  const store = new EditorStore(await directory(t)); const input = payload(await store.load());
  input.database.weapons[0].attachmentOverrides.grip = null;
  const saved = await store.save(input); assert.equal(saved.database.weapons[0].attachmentOverrides.grip, null);
  assert.ok(!saved.report.eligibleOperators.length);
});

test('ID traversal, deletion, and filename collisions cannot be saved', async t => {
  const dir = await directory(t); const store = new EditorStore(dir); const initial = await store.load();
  const input = payload(initial); vector(input.database).id = '../outside'; await assert.rejects(() => store.save(input));
  const deleted = payload(initial); deleted.database.operators.pop(); await assert.rejects(() => store.save(deleted), /Deleting or renaming/);
  assert.equal((await store.load()).revision, initial.revision);
  await rename(join(dir, 'operators/demo-vector.json'), join(dir, 'operators/new-operator.json'));
  const collision = payload(await store.load());
  collision.database.operators.push({ id: 'new-operator', name: 'Fictional new', side: 'attack', primary: null, secondary: null, gadgets: null, verification: { status: 'draft' } });
  await assert.rejects(() => store.save(collision), /filename conflicts/);
});

test('editor HTTP allows only its fixed assets and same-origin saves', async t => {
  const store = new EditorStore(await directory(t)); const server = createEditorServer(store);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(done => { server.close(done); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base)).status, 200);
  for (const path of ['/.env', '/server/config.js', '/database/real/metadata.json', '/api/read?path=../.env']) assert.equal((await fetch(base + path)).status, 404);
  const snapshot = await (await fetch(base + '/api/database')).json();
  assert.equal(snapshot.workspace, 'real');
  const hostileHostStatus = await new Promise((resolve, reject) => {
    get(base, { headers: { Host: 'untrusted.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(hostileHostStatus, 403);
  const post = origin => fetch(base + '/api/save', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(payload(snapshot)) });
  assert.equal((await post('https://example.com')).status, 403);
  assert.equal((await post('null')).status, 403);
  assert.equal((await post(base)).status, 200);
});
