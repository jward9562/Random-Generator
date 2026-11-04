import { generateLoadout } from '../src/domain/generate-loadout.js';
import { SIDES } from '../src/domain/compatibility.js';
import { PublicError } from './errors.js';
import { createDatasets, requireEligibleSide, displayLoadout } from './datasets.js';

export function createLoadoutService(database, provider, options = {}) {
  let busy = false;
  const datasets = createDatasets(database, options);
  return {
    describeDatasets: () => datasets.describe(),
    async generate(side, mode = 'mock') {
      if (!SIDES.includes(side)) throw new PublicError('SIDE', 'Choose Attack or Defense.', 400);
      if (busy) throw new PublicError('BUSY', 'Another loadout is being generated. Try again when it finishes.', 409);
      busy = true;
      const before = provider.stats.bitsConsumed;
      let snapshot;
      try {
        snapshot = await datasets.load(mode);
        requireEligibleSide(snapshot.summary, side);
        const result = await generateLoadout(snapshot.database, side, provider);
        const consumed = provider.stats.bitsConsumed - before;
        return { ...result, dataset: snapshot.summary, display: displayLoadout(snapshot.database, result), randomness: { source: consumed > 0 ? 'RANDOM.ORG' : 'none-required', method: consumed > 0 ? 'generateBlobs' : null, bitsConsumed: consumed } };
      } catch (error) {
        if (error instanceof PublicError && snapshot) error.dataset = snapshot.summary;
        throw error;
      } finally {
        busy = false;
      }
    },
  };
}
