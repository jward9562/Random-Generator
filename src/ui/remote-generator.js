export async function requestLoadout(side, fetchImpl = globalThis.fetch) {
  let response;
  let body;
  try {
    response = await fetchImpl('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ side }), signal: AbortSignal.timeout(20000),
    });
    body = await response.json();
  } catch {
    throw new Error('The local server is unavailable or the request timed out. Check that Start-Prototype.cmd is running, then try again.');
  }
  if (!response.ok) throw new Error(body.error?.message || 'Generation failed. Try again shortly.');
  if (!body.result || !['RANDOM.ORG', 'none-required'].includes(body.result.randomness?.source)) {
    throw new Error('The local server returned an invalid loadout. Restart the server and try again.');
  }
  return body.result;
}
