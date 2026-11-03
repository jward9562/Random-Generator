// Provider contract: async nextBits(k) -> uniform integer in [0, 2^k).
// Read only the bits needed for this range; reject values outside the range.
export async function choose(items, provider) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('No valid choices available.');
  if (items.length === 1) return items[0];
  const bits = Math.ceil(Math.log2(items.length));
  for (let attempt = 0; attempt < 1024; attempt += 1) {
    const value = await provider.nextBits(bits);
    if (!Number.isInteger(value) || value < 0 || value >= 2 ** bits) throw new Error('Random provider returned an invalid bit value.');
    if (value < items.length) return items[value];
  }
  throw new Error('Random provider exceeded the rejection limit.');
}
