import { SIDES } from '../domain/compatibility.js';

export const SIDE_STORAGE_KEY = 'siege-loadout.side';

export function createController({ generate, loadDatasets, storage, onChange = () => {} }) {
  let selectedSide = 'attack';
  try {
    const saved = storage?.getItem(SIDE_STORAGE_KEY);
    if (SIDES.includes(saved)) selectedSide = saved;
  } catch { /* Storage is optional; generation still works in restricted browsers. */ }
  let state = { selectedSide, selectedDataset: 'mock', datasets: {}, datasetError: null, loadingDatasets: false, result: null, busy: false, error: null };
  let metadataRequest = 0;
  const publish = (change) => { state = { ...state, ...change }; onChange(state); };
  async function refreshDatasets() {
    if (!loadDatasets) return;
    const request = ++metadataRequest;
    publish({ loadingDatasets: true, datasetError: null });
    try {
      const datasets = await loadDatasets();
      if (request === metadataRequest) publish({ datasets, loadingDatasets: false });
    } catch (error) {
      if (request === metadataRequest) publish({ datasets: {}, loadingDatasets: false, datasetError: error.message });
    }
  }
  function updateDataset(summary) {
    // A completed generation is newer than any metadata read started before it.
    ++metadataRequest;
    return { loadingDatasets: false, ...(summary ? { datasetError: null, datasets: { ...state.datasets, [summary.mode]: summary } } : {}) };
  }
  return {
    get state() { return state; },
    refreshDatasets,
    selectDataset(dataset) {
      if (!['mock', 'real'].includes(dataset)) throw new Error('Invalid dataset.');
      if (state.busy) return;
      publish({ selectedDataset: dataset, error: null });
      return refreshDatasets();
    },
    selectSide(side) {
      if (!SIDES.includes(side)) throw new Error('Invalid side.');
      if (state.busy) return;
      try { storage?.setItem(SIDE_STORAGE_KEY, side); } catch { /* Best-effort persistence. */ }
      publish({ selectedSide: side, error: null });
    },
    async generateAll() {
      if (state.busy) return;
      publish({ busy: true, error: null });
      try {
        const result = await generate(state.selectedSide, state.selectedDataset);
        publish({ ...updateDataset(result.dataset), result, busy: false });
      } catch (error) {
        publish({ ...updateDataset(error?.dataset), busy: false, error: error instanceof Error ? error.message : 'Generation failed.' });
      }
    },
  };
}
