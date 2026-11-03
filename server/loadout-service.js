import { generateLoadout } from '../src/domain/generate-loadout.js';
import { SIDES } from '../src/domain/compatibility.js';
import { PublicError } from './errors.js';

export function createLoadoutService(database, provider) {
  let busy = false;
  return {
    async generate(side) {
      if (!SIDES.includes(side)) throw new PublicError('SIDE', 'Choose Attack or Defense.', 400);
      if (busy) throw new PublicError('BUSY', 'Another loadout is being generated. Try again when it finishes.', 409);
      busy = true;
      const before = provider.stats.bitsConsumed;
      try {
        const result = await generateLoadout(database, side, provider);
        const consumed = provider.stats.bitsConsumed - before;
        return { ...result, randomness: { source: consumed > 0 ? 'RANDOM.ORG' : 'none-required', method: consumed > 0 ? 'generateBlobs' : null, bitsConsumed: consumed } };
      } finally {
        busy = false;
      }
    },
  };
}
