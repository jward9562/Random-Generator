import { ATTACHMENT_SLOTS, availableOperators, resolveAttachments, validateDatabase } from './compatibility.js';
import { choose } from '../random/selection.js';

export async function generateLoadout(database, side, provider) {
  validateDatabase(database);
  const operator = await choose(availableOperators(database, side), provider);
  async function weaponFor(slot) {
    const id = await choose(operator[slot], provider);
    const compatibility = resolveAttachments(database, operator, id);
    const attachments = {};
    for (const slotName of ATTACHMENT_SLOTS) {
      const valid = compatibility[slotName];
      attachments[slotName] = valid.length ? await choose(valid, provider) : null;
    }
    return { id, attachments };
  }
  // Build privately; callers receive a complete result or an error, never a partial loadout.
  const primary = await weaponFor('primary');
  const secondary = await weaponFor('secondary');
  const gadgetId = await choose(operator.gadgets, provider);
  return { side, operatorId: operator.id, primary, secondary, gadgetId, dataVersion: { ...database.dataVersion } };
}
