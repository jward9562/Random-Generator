import { SIDES } from '../domain/compatibility.js';

export const SIDE_STORAGE_KEY = 'siege-loadout.side';

export function createController({ generate, storage, onChange = () => {} }) {
  let selectedSide = 'attack';
  try {
    const saved = storage?.getItem(SIDE_STORAGE_KEY);
    if (SIDES.includes(saved)) selectedSide = saved;
  } catch { /* Storage is optional; generation still works in restricted browsers. */ }
  let state = { selectedSide, result: null, busy: false, error: null };
  const publish = (change) => { state = { ...state, ...change }; onChange(state); };
  return {
    get state() { return state; },
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
        const result = await generate(state.selectedSide);
        publish({ result, busy: false });
      } catch (error) {
        publish({ busy: false, error: error instanceof Error ? error.message : 'Generation failed.' });
      }
    },
  };
}
