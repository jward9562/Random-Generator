import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { loadEquipmentDirectory } from './equipment-files.js';
import { inspectEquipmentDatabase } from '../src/domain/equipment-v2.js';
import { availableOperators, validateDatabase, ATTACHMENT_SLOTS } from '../src/domain/compatibility.js';
import { PublicError } from './errors.js';

// Read only a fixed project directory. No request can supply a path or database.
async function loadRealDatabase() {
  const journal = new URL('../database/real/.editor-recovery.json', import.meta.url);
  async function requireSettledSave() {
    try { await access(journal); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    throw new Error('An editor save needs to finish or recover.');
  }
  await requireSettledSave();
  const database = await loadEquipmentDirectory(fileURLToPath(new URL('../database/real/', import.meta.url)));
  await requireSettledSave();
  return database;
}

export function createDatasets(mockDatabase, { loadReal = loadRealDatabase } = {}) {
  async function load(mode) {
    if (!['mock', 'real'].includes(mode)) throw new PublicError('DATASET', 'Choose Fictional mock or Real-data preview.', 400);
    const summary = { mode, label: mode === 'real' ? 'Real-data preview' : 'Fictional mock', id: null, patch: null, status: 'unavailable', counts: { attack: 0, defense: 0 }, totalEligible: 0, error: null };
    let database;
    try { database = mode === 'real' ? await loadReal() : mockDatabase; }
    catch {
      summary.error = { code: 'DATA_LOAD', message: 'Could not read database/real/. Finish any editor save or recovery, then run Validate-Database.cmd and try again.' };
      return { database: null, summary };
    }
    if (mode === 'mock') {
      validateDatabase(database);
      Object.assign(summary, { id: database.dataVersion.id, status: 'ready' });
      for (const side of ['attack', 'defense']) summary.counts[side] = availableOperators(database, side).length;
    } else {
      const report = inspectEquipmentDatabase(database);
      const version = database?.dataVersion;
      Object.assign(summary, { id: typeof version?.id === 'string' ? version.id : null, patch: typeof version?.patch === 'string' ? version.patch : null, status: version?.status === 'ready' ? 'ready' : 'draft' });
      const errors = report.issues.filter(issue => issue.severity === 'error');
      if (database?.schemaVersion !== 2 || version?.kind !== 'real') {
        summary.error = { code: 'DATA_INVALID', message: 'Real-data preview requires a version 2 database with kind real. Run Validate-Database.cmd.' };
      } else if (errors.length) {
        summary.error = { code: 'DATA_INVALID', message: `Real database validation failed: ${errors.slice(0, 3).map(issue => `${issue.path}: ${issue.message}`).join('; ')} Run Validate-Database.cmd for the full report.` };
      } else if (version.status !== 'ready') {
        summary.error = { code: 'DATA_DRAFT', message: 'The real database is Draft. After reviewing it, intentionally set Dataset readiness to Ready in the local editor and save. No real loadout can be generated yet.' };
      } else if (!summary.patch?.trim()) {
        summary.error = { code: 'DATA_PATCH', message: 'Set a target patch in the local editor and manually verify operators for that patch before generating.' };
      }
      if (!summary.error) for (const op of report.eligibleOperators) summary.counts[op.side]++;
    }
    summary.totalEligible = summary.counts.attack + summary.counts.defense;
    return { database, summary };
  }
  return { load, async describe() { return { datasets: (await Promise.all(['mock', 'real'].map(load))).map(item => item.summary) }; } };
}

export function requireEligibleSide(summary, side) {
  const error = summary.error ?? (summary.counts[side] === 0 ? {
    code: 'NO_ELIGIBLE', message: `No eligible ${side === 'attack' ? 'Attack' : 'Defense'} operators in ${summary.label} for patch ${summary.patch ?? 'unverified'}. Check completeness, current verification fingerprints, and patch matching in the editor or Validate-Database.cmd.`,
  } : null);
  if (error) {
    const failure = new PublicError(error.code, error.message, 422);
    failure.dataset = summary;
    throw failure;
  }
}

// Return only the names used in this result, from the very snapshot generated.
// Reviewers, evidence notes, fingerprints and the full catalogs stay server-side.
export function displayLoadout(database, result) {
  const find = (catalog, id) => Array.isArray(catalog) ? catalog.find(item => item.id === id) : catalog[id];
  const weapon = value => ({ name: find(database.weapons, value.id).name, attachments: Object.fromEntries(ATTACHMENT_SLOTS.map(slot => [slot, value.attachments[slot] === null ? null : find(database.attachments, value.attachments[slot]).name])) });
  return { operator: find(database.operators, result.operatorId).name, primary: weapon(result.primary), secondary: weapon(result.secondary), gadget: find(database.gadgets, result.gadgetId).name };
}
