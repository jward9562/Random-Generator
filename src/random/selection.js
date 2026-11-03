const UINT32_RANGE = 2 ** 32;

// Provider contract: async nextUint32() -> integer in [0, 2^32).
// Uniform input words + rejection of the incomplete tail = unbiased indices.
export async function choose(items, provider) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('No valid choices available.');
  if (items.length === 1) return items[0];
  const limit = UINT32_RANGE - (UINT32_RANGE % items.length);
  for (let attempt = 0; attempt < 1024; attempt += 1) {
    const value = await provider.nextUint32();
    if (!Number.isInteger(value) || value < 0 || value >= UINT32_RANGE) throw new Error('Random provider returned an invalid 32-bit value.');
    if (value < limit) return items[value % items.length];
  }
  throw new Error('Random provider exceeded the rejection limit.');
}
