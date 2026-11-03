import { readFile, readdir, realpath, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { loadEquipmentDirectory, parseEquipmentJson } from './equipment-files.js';
import { inspectEquipmentDatabase } from '../src/domain/equipment-v2.js';
import { invalidateVerifications, verificationFingerprint } from '../src/domain/verification.js';

const catalogs = ['attachments', 'categories', 'weapons', 'gadgets'];
const allowed = path => /^(metadata|attachments|categories|weapons|gadgets)\.json$/.test(path) || /^operators\/[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(path);
const json = value => JSON.stringify(value, null, 2) + '\n';
export class EditorError extends Error {
  constructor(message, status = 400, issues = []) { super(message); this.status = status; this.issues = issues; }
}

export class EditorStore {
  #root;
  #tail = Promise.resolve();
  #beforeWrite;
  constructor(directory, { beforeWrite = async () => {} } = {}) { this.#root = resolve(directory); this.#beforeWrite = beforeWrite; }
  #serial(task) { const result = this.#tail.then(task); this.#tail = result.catch(() => {}); return result; }
  async #safe(path, missing = false) {
    const full = join(this.#root, path);
    try {
      if ((await lstat(full)).isSymbolicLink() || (await realpath(full)).toLowerCase() !== resolve(full).toLowerCase()) throw new EditorError('Linked data paths are not supported. Use ordinary files inside database/real/.');
    } catch (error) { if (!(missing && error.code === 'ENOENT')) throw error; }
    return full;
  }
  async #preflight() {
    await this.#safe(''); await this.#safe('operators');
    await this.#safe('.editor-recovery.json', true); await this.#safe('.editor-backups', true);
  }
  async #files() {
    const files = {};
    const names = ['metadata.json', ...catalogs.map(key => `${key}.json`)];
    for (const name of await readdir(join(this.#root, 'operators'))) {
      if (name.endsWith('.json')) names.push(`operators/${name}`);
    }
    for (const name of names.sort()) {
      if (!allowed(name)) throw new EditorError(`Unsupported operator filename: ${name}. Use lowercase IDs with hyphens and .json.`);
      files[name] = await readFile(await this.#safe(name), 'utf8');
    }
    return files;
  }
  #revision(files) { return createHash('sha256').update(JSON.stringify(files)).digest('hex'); }
  async #atomic(path, text) {
    const full = await this.#safe(path, true);
    const temporary = `${full}.${randomUUID()}.tmp`;
    let handle;
    try {
      handle = await open(temporary, 'wx'); await handle.writeFile(text); await handle.sync(); await handle.close(); handle = null;
      await rename(temporary, full);
    } finally {
      await handle?.close(); await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
  }
  async #recover() {
    const journalPath = join(this.#root, '.editor-recovery.json');
    let journal;
    try { journal = parseEquipmentJson(await readFile(journalPath, 'utf8'), 'Recovery journal'); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (journal.version !== 1 || !Array.isArray(journal.changes) || journal.changes.some(change => !allowed(change.path) || (change.before !== null && typeof change.before !== 'string') || typeof change.after !== 'string')) throw new EditorError('Recovery journal is invalid. Restore from a backup before editing.', 503);
    // Refuse to overwrite a third-party edit made after the interrupted save.
    for (const change of journal.changes) {
      let current = null;
      try { current = await readFile(await this.#safe(change.path), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (current !== change.before && current !== change.after) throw new EditorError('Recovery found an external change. Preserve your files and consult the editor guide before restoring the backup.', 409);
    }
    for (const change of journal.changes) {
      if (change.before === null) await unlink(join(this.#root, change.path)).catch(error => { if (error.code !== 'ENOENT') throw error; });
      else await this.#atomic(change.path, change.before);
    }
    await unlink(journalPath);
  }
  async #load() {
    await this.#preflight(); await this.#recover();
    const files = await this.#files();
    const database = await loadEquipmentDirectory(this.#root);
    if (this.#revision(files) !== this.#revision(await this.#files())) throw new EditorError('Files changed while loading. Please reload.', 409);
    invalidateVerifications(database);
    return { database, revision: this.#revision(files), report: inspectEquipmentDatabase(database) };
  }
  load() { return this.#serial(() => this.#load()); }
  save(input) { return this.#serial(async () => {
    const current = await this.#load();
    if (input.revision !== current.revision) throw new EditorError('The files changed outside this tab. Your edits are still here. Export them, then reload the latest database before saving again.', 409);
    const db = structuredClone(input.database);
    const initial = inspectEquipmentDatabase(db);
    if (initial.issues.some(issue => issue.severity === 'error')) throw new EditorError('Fix the errors below before saving. Your edits have been kept.', 422, initial.issues);
    if (db.dataVersion.kind !== current.database.dataVersion.kind) throw new EditorError('The dataset kind cannot be changed in the editor.');
    // IDs are stable; the first version creates/edits but does not delete or rename.
    for (const key of [...catalogs, 'operators']) for (const old of current.database[key]) if (!db[key].some(record => record.id === old.id)) throw new EditorError('Deleting or renaming saved IDs is not supported. Keep the existing ID.');
    const verifyIds = input.verifyIds ?? [];
    if (!Array.isArray(verifyIds) || !verifyIds.every(id => typeof id === 'string' && db.operators.some(op => op.id === id))) throw new EditorError('Invalid verification request.');
    for (const op of db.operators) {
      const previous = current.database.operators.find(item => item.id === op.id);
      if (!verifyIds.includes(op.id) && op.verification?.status === 'verified') {
        // Client data may not silently refresh a verification fingerprint.
        op.verification = { ...op.verification, fingerprint: previous?.verification?.fingerprint };
        if (previous?.verification?.status !== 'verified') op.verification.status = 'needs-review';
      }
    }
    invalidateVerifications(db);
    for (const id of verifyIds) {
      const op = db.operators.find(item => item.id === id);
      op.verification = { ...op.verification, status: 'verified' };
      op.verification.fingerprint = verificationFingerprint(db, op);
      const check = inspectEquipmentDatabase(db);
      const problems = check.issues.filter(issue => issue.path.startsWith(`operators[${id}]`));
      if (problems.length) throw new EditorError('This operator cannot be verified yet. Complete the fields and check every weapon.', 422, problems);
    }
    const report = inspectEquipmentDatabase(db);
    const before = await this.#files();
    if (this.#revision(before) !== input.revision) throw new EditorError('Files changed before saving. Reload the latest version; your edits are still here.', 409);
    const output = { 'metadata.json': json({ schemaVersion: db.schemaVersion, dataVersion: db.dataVersion }) };
    for (const key of catalogs) output[`${key}.json`] = json(db[key]);
    const existingPaths = new Map(Object.entries(before).filter(([path]) => path.startsWith('operators/')).map(([path, text]) => [parseEquipmentJson(text).id, path]));
    for (const op of db.operators) {
      const path = existingPaths.get(op.id) ?? `operators/${op.id}.json`;
      if (Object.hasOwn(output, path)) throw new EditorError('An operator filename conflicts with another record. Keep IDs and filenames unique.');
      output[path] = json(op);
    }
    const changes = Object.entries(output).filter(([path, text]) => before[path] !== text).map(([path, after]) => ({ path, before: before[path] ?? null, after }));
    if (changes.length) {
      await mkdir(join(this.#root, '.editor-backups'), { recursive: true });
      const journal = json({ version: 1, changes });
      await this.#atomic(`.editor-backups/${Date.now()}-${randomUUID()}.json`, journal);
      await this.#atomic('.editor-recovery.json', journal);
      try {
        for (const change of changes) { await this.#beforeWrite(change.path); await this.#atomic(change.path, change.after); }
        await unlink(join(this.#root, '.editor-recovery.json'));
      } catch {
        try { await this.#recover(); } catch { throw new EditorError('Save was interrupted and needs recovery. Keep your edits open and follow the recovery instructions in the guide.', 503); }
        throw new EditorError('Save failed; the original files were restored. Your edits are still here. Check file permissions and try again.', 503);
      }
    }
    return { database: db, revision: this.#revision(await this.#files()), report };
  }); }
}
