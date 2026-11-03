export const ATTACHMENT_SLOTS = Object.freeze(['optic', 'barrel', 'grip', 'underbarrel']);
export const SIDES = Object.freeze(['attack', 'defense']);

// Each override replaces the entire list for that slot. Missing keys inherit.
// [] means the slot is unavailable; ['none'] means available with no attachment only.
export function resolveAttachments(database, operator, weaponId) {
  const weapon = database.weapons[weaponId];
  if (!weapon || ![...operator.primary, ...operator.secondary].includes(weaponId)) {
    throw new Error('Weapon is not available to this operator.');
  }
  const resolved = {
    ...database.categories[weapon.category],
    ...weapon.attachmentOverrides,
    ...operator.attachmentOverrides?.[weaponId],
  };
  return Object.fromEntries(ATTACHMENT_SLOTS.map(slot => [slot, [...resolved[slot]]]));
}

export function availableOperators(database, side) {
  if (!SIDES.includes(side)) throw new Error('Choose attack or defense.');
  return database.operators.filter(operator => operator.side === side);
}

export function validateDatabase(db) {
  const assert = (condition, message) => { if (!condition) throw new Error(`Invalid database: ${message}`); };
  const owns = (object, id) => Object.hasOwn(object, id);
  const choices = (list, catalog, label, allowEmpty = false) => {
    assert(Array.isArray(list) && (allowEmpty || list.length > 0), `${label} must be a choice list`);
    assert(new Set(list).size === list.length, `${label} contains duplicates`);
    assert(list.every(id => typeof id === 'string' && owns(catalog, id)), `${label} contains an unknown ID`);
  };
  const overrides = (value, label, complete = false) => {
    assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
    assert(Object.keys(value).every(slot => ATTACHMENT_SLOTS.includes(slot)), `${label} has an unknown attachment slot`);
    if (complete) assert(ATTACHMENT_SLOTS.every(slot => owns(value, slot)), `${label} must define every attachment slot`);
    for (const [slot, ids] of Object.entries(value)) choices(ids, db.attachments, `${label}.${slot}`, true);
  };
  assert(db?.schemaVersion === 1, 'unsupported schema version');
  assert(typeof db.dataVersion?.id === 'string' && db.dataVersion.id.length > 0, 'dataVersion.id is required');
  assert(['mock', 'verified'].includes(db.dataVersion.kind), 'dataVersion.kind is required');
  assert(db.dataVersion.kind === 'mock' ? db.dataVersion.verifiedPatch === null : typeof db.dataVersion.verifiedPatch === 'string' && db.dataVersion.verifiedPatch.trim().length > 0, 'verified patch must match data kind');
  for (const key of ['attachments', 'categories', 'weapons', 'gadgets']) {
    assert(db[key] && typeof db[key] === 'object' && !Array.isArray(db[key]), `${key} catalog is required`);
  }
  for (const catalog of [db.attachments, db.weapons, db.gadgets]) {
    for (const item of Object.values(catalog)) assert(typeof item?.name === 'string' && item.name.trim().length > 0, 'catalog entries need names');
  }
  for (const [id, category] of Object.entries(db.categories)) overrides(category, id, true);
  for (const [id, weapon] of Object.entries(db.weapons)) {
    assert(owns(db.categories, weapon.category), `${id} has unknown category`);
    assert(['primary', 'secondary'].includes(weapon.slot), `${id} has invalid weapon slot`);
    if (weapon.attachmentOverrides !== undefined) overrides(weapon.attachmentOverrides, id);
  }
  assert(Array.isArray(db.operators), 'operators must be an array');
  const ids = new Set();
  for (const op of db.operators) {
    assert(typeof op.id === 'string' && op.id.length > 0 && !ids.has(op.id), 'operator IDs must be unique');
    ids.add(op.id);
    assert(typeof op.name === 'string' && op.name.trim().length > 0 && SIDES.includes(op.side), 'invalid operator name or side');
    for (const slot of ['primary', 'secondary']) {
      choices(op[slot], db.weapons, `${op.id}.${slot}`);
      assert(op[slot].every(id => db.weapons[id].slot === slot), `${op.id} has a weapon in the wrong slot`);
    }
    choices(op.gadgets, db.gadgets, `${op.id}.gadgets`);
    if (op.attachmentOverrides !== undefined) {
      assert(op.attachmentOverrides && typeof op.attachmentOverrides === 'object' && !Array.isArray(op.attachmentOverrides), 'invalid operator overrides');
      for (const [weaponId, value] of Object.entries(op.attachmentOverrides)) {
        assert([...op.primary, ...op.secondary].includes(weaponId), `${op.id} overrides an unavailable weapon`);
        overrides(value, `${op.id}.${weaponId}`);
      }
    }
  }
  return db;
}
