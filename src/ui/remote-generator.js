import { ATTACHMENT_SLOTS } from '../domain/compatibility.js';

const named = value => typeof value === 'string' && value.trim().length > 0;
function validSummary(value) {
  return value && ['mock', 'real'].includes(value.mode) && named(value.label)
    && ['ready', 'draft', 'unavailable'].includes(value.status)
    && ['attack', 'defense'].every(side => Number.isSafeInteger(value.counts?.[side]) && value.counts[side] >= 0)
    && value.totalEligible === value.counts.attack + value.counts.defense;
}
export async function requestLoadout(side, fetchImpl = globalThis.fetch, dataset = 'mock') {
  let response;
  let body;
  try {
    response = await fetchImpl('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ side, dataset }), signal: AbortSignal.timeout(20000),
    });
    body = await response.json();
  } catch {
    throw new Error('The local server is unavailable or the request timed out. Check that Start-Prototype.cmd is running, then try again.');
  }
  if (!response.ok) {
    const error = new Error(body.error?.message || 'Generation failed. Try again shortly.');
    if (validSummary(body.dataset)) error.dataset = body.dataset;
    throw error;
  }
  const result = body.result;
  const display = result?.display;
  if (!result || result.side !== side || !validSummary(result.dataset) || result.dataset.mode !== dataset
    || !named(display?.operator) || !named(display?.gadget)
    || !['primary', 'secondary'].every(slot => named(display?.[slot]?.name) && ATTACHMENT_SLOTS.every(attachment => display[slot].attachments?.[attachment] === null || named(display[slot].attachments?.[attachment])))
    || !['RANDOM.ORG', 'none-required'].includes(result.randomness?.source)) {
    throw new Error('The local server returned an invalid loadout. Restart the server and try again.');
  }
  return body.result;
}

export async function requestDatasets(fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl('/api/datasets', { signal: AbortSignal.timeout(10000) });
    const body = await response.json();
    if (!response.ok || !Array.isArray(body.datasets) || !body.datasets.every(validSummary) || !['mock', 'real'].every(mode => body.datasets.some(item => item.mode === mode))) throw new Error();
    return Object.fromEntries(body.datasets.map(item => [item.mode, item]));
  } catch {
    throw new Error('Dataset information is unavailable. Check that Start-Prototype.cmd is running, then reselect a dataset or reload the page.');
  }
}
