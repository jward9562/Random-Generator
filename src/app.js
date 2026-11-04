import { ATTACHMENT_SLOTS } from './domain/compatibility.js';
import { requestLoadout, requestDatasets } from './ui/remote-generator.js';
import { createController } from './ui/controller.js';

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
    entry.append(element('dt', '', slot === 'underbarrel' ? 'Underbarrel' : slot[0].toUpperCase() + slot.slice(1)), element('dd', '', weapon.attachments[slot] === null ? 'Not available' : weapon.attachments[slot]));
    attachments.append(entry);
  }
  return card(number, label, weapon.name, attachments);
}
let displayedResult;
function render(state) {
  $('random-source').textContent = state.result?.randomness?.source === 'RANDOM.ORG'
    ? 'Displayed loadout: RANDOM.ORG true randomness'
    : state.result ? 'Displayed loadout: fixed choices · no random bits needed' : 'RANDOM.ORG · not used yet';
  document.body.dataset.side = state.selectedSide;
  for (const side of ['attack', 'defense']) {
    $(side).setAttribute('aria-pressed', String(side === state.selectedSide));
    $(side).disabled = state.busy;
  }
  const active = state.datasets[state.selectedDataset];
  const real = state.selectedDataset === 'real';
  $('dataset').value = state.selectedDataset;
  $('dataset').disabled = state.busy;
  $('dataset-label').textContent = real ? 'REAL-DATA PREVIEW' : 'MOCK DATA';
  $('dataset-notice').textContent = state.datasetError || (state.loadingDatasets ? 'Checking current dataset…' : active?.error?.message || (real ? 'Only complete, manually verified operators for the target patch.' : 'Fictional operators & equipment for testing. No Siege patch verified.'));
  $('operator-count').textContent = state.loadingDatasets ? 'Checking eligible operators…' : active ? `${active.counts[state.selectedSide]} eligible ${sideName(state.selectedSide)} operators · ${active.totalEligible} total · ${active.status === 'ready' ? 'Ready' : active.status === 'draft' ? 'Draft' : 'Unavailable'}` : 'Eligible operator count unavailable';
  $('data-version').textContent = `Active: ${active?.label ?? (real ? 'Real-data preview' : 'Fictional mock')} / ${active?.id ?? 'unavailable'} / Patch: ${active?.patch ?? (real ? 'unknown' : 'unverified')}`;
  $('generate').disabled = state.busy;
  $('generate').textContent = state.busy ? 'Generating…' : 'Generate All ↻';
  $('loadout').setAttribute('aria-busy', String(state.busy));
  $('error').hidden = !state.error;
  $('error').textContent = state.error ? `Could not generate: ${state.error} ${state.result ? 'Your previous loadout is still shown.' : 'Try Generate All again.'}` : '';
  const resultMode = state.result?.dataset.mode;
  $('result-side').textContent = state.result ? `${sideName(state.result.side)} / ${resultMode === 'real' ? 'REAL PREVIEW' : 'MOCK'}` : 'NO RESULT';
  const mismatch = state.result && (state.result.side !== state.selectedSide || resultMode !== state.selectedDataset || (active && (active.id !== state.result.dataset.id || active.patch !== state.result.dataset.patch)));
  $('status').textContent = state.busy ? 'Generating a complete loadout…' : mismatch ? `Showing your previous ${sideName(state.result.side)} / ${state.result.dataset.label} loadout. Generate All to use the current selection.` : state.result ? 'Ready. Equip from top to bottom.' : 'Choose a side and generate a loadout.';
  if (state.result && state.result !== displayedResult) {
    const result = state.result;
    const fragment = document.createDocumentFragment();
    fragment.append(card('01', 'OPERATOR', result.display.operator, element('p', 'operator-detail', `${sideName(result.side)} · ${resultMode === 'real' ? `Real-data preview · Patch ${result.dataset.patch}` : 'Fictional test operator'} · ${result.dataset.id}`)), weaponCard('02', 'PRIMARY WEAPON', result.display.primary), weaponCard('03', 'SECONDARY WEAPON', result.display.secondary), card('04', 'SECONDARY GADGET', result.display.gadget));
    $('loadout').replaceChildren(fragment);
    displayedResult = result;
  }
}
let storage;
try { storage = window.localStorage; } catch { /* Optional browser persistence. */ }
const controller = createController({ generate: (side, dataset) => requestLoadout(side, globalThis.fetch, dataset), loadDatasets: requestDatasets, storage, onChange: render });
$('dataset').addEventListener('change', event => controller.selectDataset(event.target.value));
$('attack').addEventListener('click', () => controller.selectSide('attack'));
$('defense').addEventListener('click', () => controller.selectSide('defense'));
$('generate').addEventListener('click', () => controller.generateAll());
render(controller.state);
void controller.refreshDatasets();
