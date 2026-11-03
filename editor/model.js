import { inspectEquipmentDatabase } from '../src/domain/equipment-v2.js';
import { invalidateVerifications, verificationFingerprint, verificationIsCurrent } from '../src/domain/verification.js';

export function operatorState(db, op) {
  if (op.verification?.status === 'needs-review' || (op.verification?.status === 'verified' && !verificationIsCurrent(db, op))) return 'Needs review';
  const issues = inspectEquipmentDatabase(db).issues.filter(issue => issue.path.startsWith(`operators[${op.id}]`) && !issue.path.includes('.verification'));
  if (issues.length || !op.name?.trim()) return 'Incomplete';
  return verificationIsCurrent(db, op) ? 'Verified' : 'Complete · unverified';
}

export function createEditorModel(snapshot) {
  let database = structuredClone(snapshot.database);
  let revision = snapshot.revision;
  let dirty = false;
  const pending = new Map();
  return {
    get database() { return database; }, get dirty() { return dirty; },
    get report() { return inspectEquipmentDatabase(database); },
    change() {
      dirty = true;
      invalidateVerifications(database);
      for (const [id, fingerprint] of pending) {
        const op = database.operators.find(item => item.id === id);
        if (!op || !verificationIsCurrent(database, op) || verificationFingerprint(database, op) !== fingerprint) pending.delete(id);
      }
    },
    confirm(id) {
      const op = database.operators.find(item => item.id === id);
      dirty = true; pending.delete(id);
      op.verification.status = 'verified';
      op.verification.fingerprint = verificationFingerprint(database, op);
      const problems = inspectEquipmentDatabase(database).issues.filter(issue => issue.severity === 'error' || issue.path.startsWith(`operators[${id}]`));
      if (problems.length) { op.verification.status = 'needs-review'; throw new Error(problems.map(issue => `${issue.path}: ${issue.message}`).join('\n')); }
      pending.set(id, op.verification.fingerprint); dirty = true;
    },
    payload() { return { database: structuredClone(database), revision, verifyIds: [...pending.keys()] }; },
    saved(snapshot) { database = structuredClone(snapshot.database); revision = snapshot.revision; pending.clear(); dirty = false; },
  };
}
