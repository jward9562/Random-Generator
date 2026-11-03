import { EQUIPMENT_SLOTS, previewAttachments } from '/src/domain/equipment-v2.js';
import { createEditorModel, operatorState } from '/model.js';

const $ = id => document.getElementById(id);
const titles = { operators: 'Operators', weapons: 'Weapons', categories: 'Categories', attachments: 'Attachments', gadgets: 'Gadgets', dataset: 'Dataset' };
let model, section = 'operators', selected = -1, savedIds = {}, saving = false;
const modes = new Map();
const node = (tag, text, className = '') => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; el.className = className; return el; };
function button(text, action, className = '') { const el = node('button', text, className); el.type = 'button'; el.onclick = action; return el; }
function message(text, success = false) { $('message').hidden = !text; $('message').textContent = text; $('message').className = success ? 'success' : ''; }
function field(label, control, help) {
  const el = node('label', undefined, 'field'); el.append(node('span', label), control);
  if (help) el.append(node('p', help, 'hint')); return el;
}
function input(value, action, type = 'text') {
  const el = document.createElement('input'); el.type = type; el.value = value ?? '';
  el.addEventListener('input', () => { action(el.value); changed(); }); return el;
}
function textarea(value, action) {
  const el = document.createElement('textarea'); el.value = value ?? '';
  el.addEventListener('input', () => { action(el.value); changed(); }); return el;
}
function select(value, options, action) {
  const el = document.createElement('select');
  for (const [id, label] of options) { const option = node('option', label); option.value = id; el.append(option); }
  el.value = value ?? ''; el.onchange = () => { action(el.value); changed(); renderForm(); }; return el;
}
function check(text, checked, action) {
  const label = node('label', undefined, 'check'); const el = document.createElement('input'); el.type = 'checkbox'; el.checked = checked;
  el.onchange = () => { action(el.checked); changed(); renderForm(); }; label.append(el, node('span', text)); return label;
}
function panel(title) { const el = node('div', undefined, 'panel'); el.append(node('h3', title)); return el; }
function changed() { model.change(); message(''); summary(); renderList(); }
function summary() {
  $('save-state').textContent = saving ? 'Saving…' : model.dirty ? 'Unsaved changes' : 'All changes saved';
  $('save').disabled = saving; $('reload').disabled = saving; $('new').disabled = saving;
  const report = model.report;
  const errors = report.issues.filter(issue => issue.severity === 'error').length;
  $('validation-title').textContent = `Database checks: ${errors} errors · ${report.issues.length - errors} review notes · ${report.eligibleOperators.length} eligible operators`;
  $('issues').replaceChildren(...report.issues.map(issue => { const p = node('p', undefined, 'issue'); p.append(node('strong', `${issue.severity === 'error' ? 'Fix' : 'Review'}: `), node('span', `${issue.path} — ${issue.message}`)); return p; }));
  if (!report.issues.length) $('issues').append(node('p', 'No validation issues.'));
  const tag = $('operator-state'); if (tag && section === 'operators' && model.database.operators[selected]) tag.textContent = operatorState(model.database, model.database.operators[selected]);
  if ($('review-status') && section === 'operators' && model.database.operators[selected]?.verification) $('review-status').value = model.database.operators[selected].verification.status;
}
function renderList() {
  $('section-title').textContent = titles[section]; $('new').hidden = section === 'dataset'; $('search').parentElement.hidden = section === 'dataset';
  const query = $('search').value.toLowerCase(); const list = $('records'); list.replaceChildren();
  if (section === 'dataset') { list.append(node('p', 'Set the patch you are recording and keep the dataset in draft until you are ready.', 'hint')); return; }
  model.database[section].forEach((record, index) => {
    if (!`${record.name} ${record.id}`.toLowerCase().includes(query)) return;
    const el = button(record.name || 'Unnamed record', () => { selected = index; modes.clear(); renderList(); renderForm(); }, 'record');
    el.setAttribute('aria-current', String(index === selected));
    el.append(node('small', section === 'operators' ? `${record.side === 'attack' ? 'Attack' : 'Defense'} · ${operatorState(model.database, record)}` : record.id)); list.append(el);
  });
  if (!list.childElementCount) list.append(node('p', 'No records yet. Choose + New to start.', 'empty'));
}
function describe(values) {
  if (values === null || values === undefined) return 'Unknown — not checked';
  if (!values.length) return 'Unavailable slot';
  return values.map(id => model.database.attachments.find(item => item.id === id)?.name ?? `Missing: ${id}`).join(', ');
}
function slotControls(container, owner, slotKey, base, effective, labelPrefix, inherit, beforeChange = () => {}) {
  const grid = node('div', undefined, 'slots');
  for (const slot of EQUIPMENT_SLOTS) {
    const fieldset = node('fieldset', undefined, 'slot'); fieldset.append(node('legend', slot[0].toUpperCase() + slot.slice(1)));
    const map = owner[slotKey] ?? {};
    const has = Object.hasOwn(map, slot); const val = map[slot];
    const modeKey = `${labelPrefix}-${slot}`;
    let mode = modes.get(modeKey) ?? (!has && inherit ? 'inherit' : val === null || val === undefined ? 'unknown' : Array.isArray(val) && val.length === 0 ? 'unavailable' : 'choices');
    const options = [...(inherit ? [['inherit', 'Inherit from previous level']] : []), ['unknown', 'Unknown — not checked'], ['unavailable', 'Unavailable slot'], ['choices', 'Choose specific attachments']];
    const dropdown = select(mode, options, next => {
      beforeChange();
      modes.set(modeKey, next); owner[slotKey] ??= {};
      if (next === 'inherit') delete owner[slotKey][slot];
      else if (next === 'unknown') owner[slotKey][slot] = null;
      else if (next === 'unavailable') owner[slotKey][slot] = [];
      else owner[slotKey][slot] = Array.isArray(effective?.[slot]) && effective[slot].length ? [...effective[slot]] : null;
    });
    fieldset.append(field(`${slot} availability`, dropdown));
    if (inherit) fieldset.append(node('p', `Inherited: ${describe(base?.[slot])}`, 'hint'));
    if (mode === 'choices') {
      const choices = node('div', undefined, 'choices');
      const current = Array.isArray(val) ? val : Array.isArray(effective?.[slot]) ? effective[slot] : [];
      for (const attachment of model.database.attachments.filter(item => item.slot === slot || item.slot === 'any')) {
        choices.append(check(attachment.name || attachment.id, current.includes(attachment.id), enabled => {
          beforeChange();
          const next = enabled ? [...new Set([...current, attachment.id])] : current.filter(id => id !== attachment.id);
          owner[slotKey] ??= {}; owner[slotKey][slot] = next.length ? next : null;
        }));
      }
      fieldset.append(choices);
      if (!choices.childElementCount) fieldset.append(node('p', 'Add attachments in the Attachments section first.', 'hint'));
      if (!current.length) fieldset.append(node('p', 'No choice selected: this is saved as unknown. Select No attachment if that is the observed choice.', 'hint warning'));
    }
    fieldset.append(node('p', `Effective: ${describe(effective?.[slot])}`, 'effective'));
    grid.append(fieldset);
  }
  container.append(grid);
}
function inventory(op, key, title, catalog) {
  const box = panel(title);
  box.append(check('Not entered yet', op[key] === null, value => { op[key] = value ? null : []; if (key !== 'gadgets') cleanOperator(op); }));
  if (op[key] !== null) {
    for (const item of catalog) box.append(check(item.name || item.id, op[key]?.includes(item.id), enabled => {
      op[key] = enabled ? [...new Set([...(op[key] ?? []), item.id])] : (op[key] ?? []).filter(id => id !== item.id);
      if (key !== 'gadgets') cleanOperator(op);
    }));
    if (!catalog.length) box.append(node('p', `Add shared ${key === 'gadgets' ? 'gadgets' : 'weapons'} in their section first.`, 'hint'));
  }
  return box;
}
function cleanOperator(op) {
  const ids = [...(op.primary ?? []), ...(op.secondary ?? [])];
  for (const id of Object.keys(op.attachmentOverrides ?? {})) if (!ids.includes(id)) delete op.attachmentOverrides[id];
  if (op.verification?.weaponsChecked) op.verification.weaponsChecked = op.verification.weaponsChecked.filter(id => ids.includes(id));
}
function renderForm() {
  const form = $('form'); form.replaceChildren();
  if (section === 'dataset') {
    const data = model.database.dataVersion; form.append(node('h2', 'Dataset settings'));
    form.append(node('p', model.database.dataVersion.kind === 'mock' ? 'Fictional practice database. This is not verified Siege data.' : 'Real-data workspace. Do not enter guessed equipment or copied fictional verification.', 'hint'));
    form.append(field('Dataset revision', input(data.id, value => { data.id = value; })), field('Target patch', input(data.patch, value => { data.patch = value.trim() || null; }), 'Enter the patch you are checking. Changing it requires operators to be reviewed again.'), field('Dataset readiness', select(data.status, [['draft', 'Draft — not eligible for generation'], ['ready', 'Ready — only verified operators eligible']], value => { data.status = value; })));
    form.append(node('p', 'Setting Ready does not activate this database in the generator.', 'hint')); return;
  }
  const record = model.database[section][selected];
  if (!record) { form.append(node('h2', `Manage ${titles[section].toLowerCase()}`), node('p', 'Select a record on the left, or choose + New. Save drafts as you work; verify an operator only after checking its inventory and every attachment menu in-game.', 'empty')); return; }
  const heading = node('h2', `Edit ${titles[section].toLowerCase().replace(/ies$/, 'y').replace(/s$/, '')}`);
  if (section === 'operators') { const tag = node('span', operatorState(model.database, record), 'tag'); tag.id = 'operator-state'; heading.append(tag); }
  form.append(heading);
  const row = node('div', undefined, 'row');
  let autoId = record.id.startsWith('new-') && !savedIds[section]?.has(record.id);
  const idInput = input(record.id, value => { autoId = false; record.id = value; }); idInput.disabled = savedIds[section]?.has(record.id);
  const name = input(record.name, value => {
    record.name = value;
    if (!idInput.disabled && autoId) {
      const proposed = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (proposed && !model.database[section].some(item => item !== record && item.id === proposed)) { record.id = proposed; idInput.value = proposed; }
    }
  });
  row.append(field('Display name', name), field('Stable ID', idInput, 'Lowercase words separated by hyphens. Locked after the first save.')); form.append(row);
  if (section === 'attachments') {
    const slot = select(record.slot, [...EQUIPMENT_SLOTS.map(id => [id, id[0].toUpperCase() + id.slice(1)]), ...(record.id === 'none' ? [['any', 'No attachment — any slot']] : [])], value => { record.slot = value; });
    slot.disabled = record.id === 'none'; form.append(field('Attachment type', slot));
  }
  if (section === 'categories') slotControls(form, record, 'attachments', null, record.attachments, record.id, false);
  if (section === 'weapons') {
    const fields = node('div', undefined, 'row');
    fields.append(field('Weapon category', select(record.category, [['', 'Select a category'], ...model.database.categories.map(item => [item.id, item.name || item.id])], value => { record.category = value; })), field('Equipment slot', select(record.slot, [['primary', 'Primary weapon'], ['secondary', 'Secondary weapon']], value => { record.slot = value; })));
    form.append(fields, node('p', 'Inherited options are a starting point. Review this weapon individually; inherited options do not verify any operator.', 'hint'));
    const base = model.database.categories.find(item => item.id === record.category)?.attachments;
    slotControls(form, record, 'attachmentOverrides', base, previewAttachments(model.database, null, record.id).choices, record.id, true);
  }
  if (section === 'operators') {
    form.append(field('Side', select(record.side, [['attack', 'Attack'], ['defense', 'Defense']], value => { record.side = value; })));
    const inv = node('div', undefined, 'row');
    inv.append(inventory(record, 'primary', 'Primary weapons', model.database.weapons.filter(item => item.slot === 'primary')), inventory(record, 'secondary', 'Secondary weapons', model.database.weapons.filter(item => item.slot === 'secondary'))); form.append(inv, inventory(record, 'gadgets', 'Secondary gadgets', model.database.gadgets));
    for (const id of [...(record.primary ?? []), ...(record.secondary ?? [])]) {
      const weapon = model.database.weapons.find(item => item.id === id); if (!weapon) continue;
      const box = panel(`${weapon.name} · operator-specific choices`);
      box.append(node('p', 'Inherited from the shared weapon. Use exceptions only for this operator. Review these menus in-game even if another operator uses this weapon.', 'hint'));
      const wrapper = { overrides: record.attachmentOverrides?.[id] ?? {} };
      slotControls(box, wrapper, 'overrides', previewAttachments(model.database, null, id).choices, previewAttachments(model.database, record, id).choices, `${record.id}-${id}`, true, () => {
        record.attachmentOverrides ??= {}; record.attachmentOverrides[id] = wrapper.overrides;
      });
      form.append(box);
    }
    const review = panel('Manual verification'); const v = record.verification ??= { status: 'draft' };
    review.append(node('p', 'Verification belongs to this operator and this exact equipment configuration. Changes invalidate it, including edits made outside this editor.', 'hint'));
    const reviewStatus = select(v.status === 'verified' ? 'verified' : v.status, [['draft', 'Draft'], ['needs-review', 'Needs review'], ...(v.status === 'verified' ? [['verified', 'Verified — content fingerprint matches']] : [])], value => { v.status = value; });
    reviewStatus.id = 'review-status'; review.append(field('Review status', reviewStatus));
    const reviewRow = node('div', undefined, 'row');
    reviewRow.append(field('Checked by', input(v.checkedBy, value => { v.checkedBy = value; })), field('Date checked', input(v.checkedOn, value => { v.checkedOn = value || null; }, 'date'))); review.append(reviewRow);
    review.append(field('Patch checked', input(v.patch, value => { v.patch = value || null; }), `Must match the Dataset target patch: ${model.database.dataVersion.patch ?? 'not set'}`), field('Evidence / check notes', textarea((v.evidence ?? []).join('\n'), value => { v.evidence = value.split('\n').filter(line => line.trim()); }), 'For example: checked both weapons and all gadget choices in operator selection. One note per line.'));
    for (const id of [...(record.primary ?? []), ...(record.secondary ?? [])]) review.append(check(`I checked every attachment menu for ${model.database.weapons.find(item => item.id === id)?.name ?? id} on this operator`, v.weaponsChecked?.includes(id), enabled => { v.weaponsChecked = enabled ? [...new Set([...(v.weaponsChecked ?? []), id])] : (v.weaponsChecked ?? []).filter(item => item !== id); }));
    const confirmation = node('label', undefined, 'check'); const confirmInput = document.createElement('input'); confirmInput.type = 'checkbox'; confirmation.append(confirmInput, node('span', 'I have checked the complete inventory and gadgets in-game for this patch.')); review.append(confirmation);
    review.append(button('Confirm manual verification', () => {
      if (!confirmInput.checked) { message('Confirm that you checked the complete inventory and gadgets before verifying.'); return; }
      try { model.confirm(record.id); summary(); renderList(); renderForm(); message('Verification recorded in your edits. Choose Save changes to write it to disk.', true); }
      catch (error) { summary(); message(error.message); }
    }, 'primary')); form.append(review);
  }
  form.append(field('Notes (optional)', textarea(record.notes, value => { record.notes = value; })));
}
function newRecord() {
  const singular = { operators: 'operator', weapons: 'weapon', categories: 'category', attachments: 'attachment', gadgets: 'gadget' }[section];
  let n = 1; while (model.database[section].some(item => item.id === `new-${singular}-${n}`)) n++;
  const record = { id: `new-${singular}-${n}`, name: '' };
  if (section === 'operators') Object.assign(record, { side: 'attack', primary: null, secondary: null, gadgets: null, verification: { status: 'draft', patch: null, checkedBy: null, checkedOn: null, evidence: [], weaponsChecked: [] } });
  if (section === 'weapons') Object.assign(record, { category: model.database.categories[0]?.id ?? '', slot: 'primary', attachmentOverrides: {} });
  if (section === 'categories') record.attachments = Object.fromEntries(EQUIPMENT_SLOTS.map(slot => [slot, null]));
  if (section === 'attachments') record.slot = 'optic';
  model.database[section].push(record); selected = model.database[section].length - 1; $('search').value = ''; modes.clear(); changed(); renderForm();
}
async function load() {
  try {
    const response = await fetch('/api/database'); const body = await response.json(); if (!response.ok) throw new Error(body.error);
    model = createEditorModel(body); savedIds = Object.fromEntries(Object.keys(titles).filter(key => key !== 'dataset').map(key => [key, new Set(body.database[key].map(record => record.id))]));
    document.querySelector('footer').textContent = body.workspace === 'practice' ? 'Fictional practice copy in .local · Real database untouched · No RANDOM.ORG requests' : 'Local computer only · Saves to database/real/ · No API keys or RANDOM.ORG requests';
    selected = -1; modes.clear(); message(''); summary(); renderList(); renderForm();
    if (body.database.dataVersion.kind === 'mock') message('Fictional practice dataset — for editor testing only. These are not verified Siege records.', true);
  } catch (error) { message(error.message || 'Could not load the editor.'); }
}
for (const [id, title] of Object.entries(titles)) $('tabs').append(button(title, () => { section = id; selected = -1; modes.clear(); $('search').value = ''; for (const el of $('tabs').children) el.setAttribute('aria-pressed', String(el.textContent === title)); renderList(); renderForm(); }));
$('tabs').firstChild.setAttribute('aria-pressed', 'true');
$('new').onclick = newRecord; $('search').oninput = renderList;
$('reload').onclick = () => { if (!model?.dirty || window.confirm('Discard unsaved edits and reload the files? Export an unsaved copy first if you need to keep them.')) void load(); };
$('export').onclick = () => {
  if (!model) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(model.database, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'equipment-unsaved-copy.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('save').onclick = async () => {
  if (!model || saving) return;
  if (model.report.issues.some(issue => issue.severity === 'error')) { message('Fix the errors in Database checks before saving. Your edits are still here.'); $('validation').open = true; return; }
  saving = true; summary(); $('form').inert = true; $('tabs').inert = true;
  try {
    const response = await fetch('/api/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(model.payload()) });
    const body = await response.json(); if (!response.ok) throw new Error([body.error, ...(body.issues ?? []).map(issue => `${issue.path}: ${issue.message}`)].join('\n'));
    model.saved(body); for (const key of Object.keys(savedIds)) savedIds[key] = new Set(body.database[key].map(record => record.id));
    modes.clear(); renderList(); renderForm(); message('Saved to the local JSON files. The generator has not been changed.', true);
  } catch (error) { message(`${error.message || 'Save failed.'}\nYour unsaved edits are still available. If the server stopped, restart it; export a copy before reloading.`); }
  finally { saving = false; $('form').inert = false; $('tabs').inert = false; summary(); }
};
window.addEventListener('beforeunload', event => { if (model?.dirty) { event.preventDefault(); event.returnValue = ''; } });
// The reserved No attachment identity is explicit and never added to every slot.
$('tabs').addEventListener('click', () => {
  if (section === 'attachments' && !model.database.attachments.some(item => item.id === 'none')) {
    $('form').prepend(button('Add the “No attachment” choice', () => { model.database.attachments.push({ id: 'none', name: 'No attachment', slot: 'any' }); selected = model.database.attachments.length - 1; changed(); renderForm(); }));
  }
});
void load();
