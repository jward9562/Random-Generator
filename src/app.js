import { mockDatabase as database } from './data/mock-database.js';
import { ATTACHMENT_SLOTS, availableOperators } from './domain/compatibility.js';
import { LocalRandomProvider } from './random/local-provider.js';
import { createController } from './ui/controller.js';

const provider = new LocalRandomProvider();
const $ = id => document.getElementById(id);
const sideName = side => side === 'attack' ? 'Attack' : 'Defense';
function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function card(number, label, name, details) {
  const node = element('article', 'loadout-card');
  node.append(element('span', 'step', number));
  const content = element('div', 'card-content');
  content.append(element('p', 'eyebrow', label), element('h3', '', name));
  if (details) content.append(details);
  node.append(content);
  return node;
}
function weaponCard(number, label, weapon) {
  const attachments = element('dl', 'attachments');
  for (const slot of ATTACHMENT_SLOTS) {
    const entry = element('div', weapon.attachments[slot] === null ? 'unavailable' : '');
    entry.append(element('dt', '', slot === 'underbarrel' ? 'Underbarrel' : slot[0].toUpperCase() + slot.slice(1)), element('dd', '', weapon.attachments[slot] === null ? 'Not available' : database.attachments[weapon.attachments[slot]].name));
    attachments.append(entry);
  }
  return card(number, label, database.weapons[weapon.id].name, attachments);
}
let displayedResult;
function render(state) {
  document.body.dataset.side = state.selectedSide;
  for (const side of ['attack', 'defense']) {
    $(side).setAttribute('aria-pressed', String(side === state.selectedSide));
    $(side).disabled = state.busy;
  }
  $('operator-count').textContent = `${availableOperators(database, state.selectedSide).length} mock operators available`;
  $('generate').disabled = state.busy;
  $('generate').textContent = state.busy ? 'Generating…' : 'Generate All ↻';
  $('loadout').setAttribute('aria-busy', String(state.busy));
  $('error').hidden = !state.error;
  $('error').textContent = state.error ? `Could not generate: ${state.error} ${state.result ? 'Your previous loadout is still shown.' : 'Try Generate All again.'}` : '';
  $('result-side').textContent = state.result ? `${sideName(state.result.side)} / MOCK` : 'NO RESULT';
  const mismatch = state.result && state.result.side !== state.selectedSide;
  $('status').textContent = state.busy ? 'Generating a complete loadout…' : mismatch ? `Showing your previous ${sideName(state.result.side)} loadout. Generate All to use ${sideName(state.selectedSide)}.` : state.result ? 'Ready. Equip from top to bottom.' : 'Choose a side and generate a loadout.';
  if (state.result && state.result !== displayedResult) {
    const result = state.result;
    const operator = database.operators.find(op => op.id === result.operatorId);
    const fragment = document.createDocumentFragment();
    fragment.append(card('01', 'OPERATOR', operator.name, element('p', 'operator-detail', `${sideName(result.side)} · Fictional test operator`)), weaponCard('02', 'PRIMARY WEAPON', result.primary), weaponCard('03', 'SECONDARY WEAPON', result.secondary), card('04', 'SECONDARY GADGET', database.gadgets[result.gadgetId].name));
    $('loadout').replaceChildren(fragment);
    displayedResult = result;
  }
}
let storage;
try { storage = window.localStorage; } catch { /* Optional browser persistence. */ }
const controller = createController({ database, provider, storage, onChange: render });
$('attack').addEventListener('click', () => controller.selectSide('attack'));
$('defense').addEventListener('click', () => controller.selectSide('defense'));
$('generate').addEventListener('click', () => controller.generateAll());
$('random-source').textContent = provider.label;
$('data-version').textContent = `Data: ${database.dataVersion.id} / Patch: unverified`;
render(controller.state);
void controller.generateAll();
