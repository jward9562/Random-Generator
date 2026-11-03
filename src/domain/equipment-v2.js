// Authoring schema v2. No network, filesystem, UI, or randomness dependencies.
import { verificationIsCurrent } from './verification.js';
export const EQUIPMENT_SLOTS = Object.freeze(['optic', 'barrel', 'grip', 'underbarrel']);
const SLOTS = EQUIPMENT_SLOTS;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const stableId = value => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const own = (object, key) => Object.hasOwn(object, key);

function applyOverride(base, change, path, report) {
  if (change === null) return null; // An explicit unknown exception must not inherit.
  if (Array.isArray(change)) return [...change]; // Explicit replacement, including [].
  if (!isObject(change)) { report('error', 'INVALID_OVERRIDE', path, 'Use a replacement list or an object with add/remove lists.'); return null; }
  if (Object.keys(change).some(key => !['add', 'remove'].includes(key)) || !Object.keys(change).length) {
    report('error', 'INVALID_OVERRIDE', path, 'Only add and remove are supported; replacement uses a plain list.');
    return null;
  }
  const add = own(change, 'add') ? change.add : [];
  const remove = own(change, 'remove') ? change.remove : [];
  if (!Array.isArray(add) || !Array.isArray(remove)) { report('error', 'INVALID_OVERRIDE', path, 'add and remove must be lists.'); return null; }
  if (!Array.isArray(base)) { report('error', 'UNKNOWN_BASE', path, 'Cannot add/remove from unknown defaults. Enter a complete replacement list.'); return null; }
  for (const id of remove) if (!base.includes(id)) report('error', 'INVALID_REMOVAL', path, `Cannot remove ${id}: it is not inherited here.`);
  for (const id of add) {
    if (remove.includes(id)) report('error', 'CONFLICTING_OVERRIDE', path, `${id} cannot be added and removed together.`);
    if (base.includes(id)) report('error', 'REDUNDANT_ADDITION', path, `${id} is already inherited here.`);
  }
  return [...base.filter(id => !remove.includes(id)), ...add];
}

function resolve(db, operator, weaponId, report) {
  const weapon = db.weapons.find(item => item?.id === weaponId);
  const category = db.categories.find(item => item?.id === weapon?.category);
  const result = {};
  for (const slot of SLOTS) {
    let value = category?.attachments?.[slot] ?? null;
    for (const [changes, path] of [
      [weapon?.attachmentOverrides, `weapons[${weaponId}].attachmentOverrides`],
      [operator?.attachmentOverrides?.[weaponId], `operators[${operator?.id}].attachmentOverrides.${weaponId}`],
    ]) {
      if (isObject(changes) && own(changes, slot)) value = applyOverride(value, changes[slot], `${path}.${slot}`, report);
    }
    result[slot] = Array.isArray(value) ? [...value] : null;
  }
  return result;
}

// Draft-friendly preview: unknown slots stay null rather than becoming unavailable.
export function previewAttachments(db, operator, weaponId) {
  const issues = [];
  const choices = resolve(db, operator, weaponId, (severity, code, path, message) => issues.push({ severity, code, path, message }));
  return { choices, issues };
}

export function resolveV2Attachments(db, operator, weaponId) {
  if (![...(operator.primary ?? []), ...(operator.secondary ?? [])].includes(weaponId)) throw new Error('Weapon is not available to this operator.');
  const errors = [];
  const result = resolve(db, operator, weaponId, (_severity, _code, path, message) => errors.push(`${path}: ${message}`));
  if (Object.values(result).some(value => value === null)) errors.push('Attachment compatibility is incomplete.');
  if (errors.length) throw new Error(`Invalid database: ${errors.join('; ')}`);
  return result;
}

// Returns all findings in one pass. Structural errors fail the whole dataset closed;
// unfinished records are warnings and cannot enter the eligible operator list.
export function inspectEquipmentDatabase(db) {
  const issues = [];
  const report = (severity, code, path, message) => issues.push({ severity, code, path, message });
  const error = (code, path, message) => report('error', code, path, message);
  const incomplete = (path, message) => report('warning', 'INCOMPLETE', path, message);
  const fields = (value, allowed, path) => {
    if (isObject(value)) for (const key of Object.keys(value)) if (!allowed.includes(key)) error('UNKNOWN_FIELD', `${path}.${key}`, 'Unknown field; check spelling.');
  };
  if (!isObject(db) || db.schemaVersion !== 2) {
    error('SCHEMA', 'schemaVersion', 'Expected equipment schema version 2.');
    return { issues, eligibleOperators: [] };
  }
  fields(db, ['schemaVersion', 'dataVersion', 'attachments', 'categories', 'weapons', 'gadgets', 'operators'], 'database');
  const version = db.dataVersion;
  fields(version, ['id', 'kind', 'patch', 'status'], 'dataVersion');
  if (!nonempty(version?.id)) error('VERSION', 'dataVersion.id', 'A dataset revision name is required.');
  if (!['mock', 'real'].includes(version?.kind)) error('VERSION', 'dataVersion.kind', 'Use mock or real.');
  if (!['draft', 'ready'].includes(version?.status)) error('VERSION', 'dataVersion.status', 'Use draft or ready.');
  if (version?.patch !== null && !nonempty(version?.patch)) error('PATCH', 'dataVersion.patch', 'Enter a patch identifier, or null while it is unknown.');
  if (!nonempty(version?.patch)) incomplete('dataVersion.patch', 'Target patch is unknown; no operators can be eligible.');
  if (version?.status === 'draft') report('warning', 'DRAFT_DATASET', 'dataVersion.status', 'Dataset is a draft; generation is disabled for this dataset.');

  const catalogs = {};
  for (const key of ['attachments', 'categories', 'weapons', 'gadgets', 'operators']) {
    const list = db[key];
    catalogs[key] = new Map();
    if (!Array.isArray(list)) { error('CATALOG', key, 'Expected a list of records.'); continue; }
    if (!list.length) incomplete(key, 'No records entered yet.');
    list.forEach((item, index) => {
      const path = `${key}[${index}]`;
      if (!isObject(item)) { error('RECORD', path, 'Expected a record object.'); return; }
      if (!stableId(item.id)) error('ID', `${path}.id`, 'Use a stable lowercase ID with words separated by hyphens.');
      if (catalogs[key].has(item.id)) error('DUPLICATE_ID', `${path}.id`, `Duplicate ID: ${item.id}.`);
      else catalogs[key].set(item.id, item);
      if (!nonempty(item.name)) incomplete(`${path}.name`, 'A display name is missing.');
    });
  }
  const records = key => Array.isArray(db[key]) ? db[key].filter(isObject) : [];
  const checkIds = (list, catalog, path, { slot, empty = true } = {}) => {
    if (list === null || list === undefined) { incomplete(path, 'Choices have not been entered.'); return false; }
    if (!Array.isArray(list)) { error('CHOICES', path, 'Expected a list of IDs, or null for unknown data.'); return false; }
    if (!empty && !list.length) { incomplete(path, 'At least one choice must be confirmed.'); return false; }
    const seen = new Set();
    for (const id of list) {
      if (seen.has(id)) error('DUPLICATE_CHOICE', path, `Repeated choice: ${id}.`);
      seen.add(id);
      if (!stableId(id) || !catalog.has(id)) error('MISSING_REFERENCE', path, `Unknown ID: ${String(id)}.`);
      else if (slot && ![slot, 'any'].includes(catalog.get(id).slot)) error('WRONG_ATTACHMENT_SLOT', path, `${id} is not an attachment for ${slot}.`);
    }
    return true;
  };
  const checkOverrides = (value, path) => {
    if (value === undefined) return;
    if (!isObject(value)) { error('INVALID_OVERRIDE', path, 'Expected an object keyed by attachment slot.'); return; }
    fields(value, SLOTS, path);
    for (const [slot, change] of Object.entries(value)) {
      if (!SLOTS.includes(slot)) continue;
      if (change === null) continue;
      if (Array.isArray(change)) checkIds(change, catalogs.attachments, `${path}.${slot}`, { slot });
      else if (isObject(change)) {
        fields(change, ['add', 'remove'], `${path}.${slot}`);
        if (!Object.keys(change).length) error('INVALID_OVERRIDE', `${path}.${slot}`, 'Empty override; omit the slot to inherit.');
        for (const action of ['add', 'remove']) if (own(change, action)) {
          if (!Array.isArray(change[action])) error('INVALID_OVERRIDE', `${path}.${slot}.${action}`, 'Expected a list of attachment IDs.');
          else checkIds(change[action], catalogs.attachments, `${path}.${slot}.${action}`, { slot });
        }
      } else error('INVALID_OVERRIDE', `${path}.${slot}`, 'Use a replacement list, or add/remove lists.');
    }
  };

  for (const item of records('attachments')) {
    fields(item, ['id', 'name', 'slot', 'notes'], `attachments[${item.id}]`);
    if (!SLOTS.includes(item.slot) && !(item.id === 'none' && item.slot === 'any')) error('ATTACHMENT_SLOT', `attachments[${item.id}].slot`, 'Use optic, barrel, grip, or underbarrel; only none can use any.');
    if (item.id === 'none' && (item.slot !== 'any' || item.name !== 'No attachment')) error('NONE_CHOICE', 'attachments[none]', 'The reserved none entry must be named No attachment with slot any.');
  }
  for (const item of records('gadgets')) fields(item, ['id', 'name', 'notes'], `gadgets[${item.id}]`);
  for (const category of records('categories')) {
    const path = `categories[${category.id}].attachments`;
    fields(category, ['id', 'name', 'attachments', 'notes'], `categories[${category.id}]`);
    if (!isObject(category.attachments)) { incomplete(path, 'Enter attachment defaults, using null for unknown slots.'); continue; }
    fields(category.attachments, SLOTS, path);
    for (const slot of SLOTS) checkIds(category.attachments[slot], catalogs.attachments, `${path}.${slot}`, { slot });
  }
  for (const weapon of records('weapons')) {
    const path = `weapons[${weapon.id}]`;
    fields(weapon, ['id', 'name', 'category', 'slot', 'attachmentOverrides', 'notes'], path);
    if (!catalogs.categories.has(weapon.category)) error('MISSING_REFERENCE', `${path}.category`, `Unknown category: ${weapon.category}.`);
    if (!['primary', 'secondary'].includes(weapon.slot)) error('WEAPON_SLOT', `${path}.slot`, 'Use primary or secondary.');
    checkOverrides(weapon.attachmentOverrides, `${path}.attachmentOverrides`);
    // Validate exceptions even for weapons that no operator currently references.
    if (Array.isArray(db.weapons) && Array.isArray(db.categories)) resolve(db, null, weapon.id, report);
  }

  const candidates = [];
  for (const op of records('operators')) {
    const start = issues.length;
    const path = `operators[${op.id}]`;
    fields(op, ['id', 'name', 'side', 'primary', 'secondary', 'gadgets', 'attachmentOverrides', 'verification', 'notes'], path);
    if (!nonempty(op.name)) incomplete(`${path}.name`, 'Operator name is missing.');
    if (!['attack', 'defense'].includes(op.side)) error('SIDE', `${path}.side`, 'Use attack or defense.');
    const inventory = [];
    for (const slot of ['primary', 'secondary']) {
      if (checkIds(op[slot], catalogs.weapons, `${path}.${slot}`, { empty: false })) {
        inventory.push(...op[slot]);
        for (const id of op[slot]) {
          const weapon = catalogs.weapons.get(id);
          if (weapon && weapon.slot !== slot) error('WRONG_WEAPON_SLOT', `${path}.${slot}`, `${id} belongs in ${weapon.slot}.`);
        }
      }
    }
    checkIds(op.gadgets, catalogs.gadgets, `${path}.gadgets`, { empty: false });
    if (op.attachmentOverrides !== undefined) {
      if (!isObject(op.attachmentOverrides)) error('INVALID_OVERRIDE', `${path}.attachmentOverrides`, 'Expected overrides keyed by an available weapon ID.');
      else for (const [id, changes] of Object.entries(op.attachmentOverrides)) {
        if (!inventory.includes(id)) error('UNAVAILABLE_WEAPON', `${path}.attachmentOverrides.${id}`, 'This operator does not have that weapon.');
        checkOverrides(changes, `${path}.attachmentOverrides.${id}`);
      }
    }
    for (const id of inventory) {
      const weapon = catalogs.weapons.get(id);
      if (!weapon) continue;
      const category = catalogs.categories.get(weapon.category);
      if (!nonempty(weapon.name) || !nonempty(category?.name)) incomplete(`${path}.${id}`, 'Referenced weapon/category needs a display name.');
      if (!Array.isArray(db.categories)) continue;
      const slots = resolve(db, op, id, report);
      for (const slot of SLOTS) {
        if (slots[slot] === null) incomplete(`${path}.${id}.${slot}`, 'Effective attachment choices are unknown.');
        else for (const attachmentId of slots[slot]) if (!nonempty(catalogs.attachments.get(attachmentId)?.name)) incomplete(`${path}.${id}.${slot}`, `Attachment ${attachmentId} needs a display name.`);
      }
    }
    for (const id of Array.isArray(op.gadgets) ? op.gadgets : []) if (!nonempty(catalogs.gadgets.get(id)?.name)) incomplete(`${path}.gadgets`, `Gadget ${id} needs a display name.`);

    const verification = op.verification;
    fields(verification, ['status', 'patch', 'checkedOn', 'checkedBy', 'evidence', 'weaponsChecked', 'fingerprint'], `${path}.verification`);
    if (!isObject(verification) || !['draft', 'needs-review', 'verified'].includes(verification.status)) {
      incomplete(`${path}.verification.status`, 'Set draft, needs-review, or verified.');
    } else if (verification.status !== 'verified') {
      report('warning', 'UNVERIFIED', `${path}.verification.status`, 'This operator is excluded until manually verified.');
    } else {
      if (!verificationIsCurrent(db, op)) report('warning', 'STALE_CONTENT', `${path}.verification.fingerprint`, 'Needs review: equipment or verification details changed, or this record has no content fingerprint. Recheck and confirm it in the editor.');
      if (!nonempty(version?.patch) || verification.patch !== version.patch) report('warning', 'STALE_PATCH', `${path}.verification.patch`, 'Manual verification must match the dataset target patch.');
      const date = verification.checkedOn;
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) incomplete(`${path}.verification.checkedOn`, 'Enter the valid calendar date of the manual check (YYYY-MM-DD).');
      if (!nonempty(verification.checkedBy)) incomplete(`${path}.verification.checkedBy`, 'Record who performed the manual check (a nickname is fine).');
      if (!Array.isArray(verification.evidence) || !verification.evidence.length || !verification.evidence.every(nonempty)) incomplete(`${path}.verification.evidence`, 'Record manual-check notes or evidence references.');
      const checked = verification.weaponsChecked;
      if (!Array.isArray(checked) || checked.length !== inventory.length || new Set(checked).size !== checked.length || !inventory.every(id => checked.includes(id))) {
        incomplete(`${path}.verification.weaponsChecked`, 'List every equipped primary/secondary option whose attachment menus were manually checked for this operator.');
      }
    }
    if (issues.length === start && verification?.status === 'verified') candidates.push(op);
  }
  const errors = issues.some(issue => issue.severity === 'error');
  const eligibleOperators = !errors && version?.status === 'ready' && nonempty(version?.patch) ? candidates : [];
  return { issues, eligibleOperators };
}

export function assertValidEquipmentDatabase(db) {
  const report = inspectEquipmentDatabase(db);
  const errors = report.issues.filter(issue => issue.severity === 'error');
  if (errors.length) throw new Error(`Invalid database: ${errors.map(issue => `${issue.path}: ${issue.message}`).join('; ')}`);
  return report;
}
