import { PublicError } from './errors.js';

export const RANDOM_ORG_URL = 'https://api.random.org/json-rpc/4/invoke';
export const BLOCK_BITS = 8192;
const nonnegativeInteger = value => Number.isSafeInteger(value) && value >= 0;
const utcDay = milliseconds => new Date(milliseconds).toISOString().slice(0, 10);

// Transport and quota state are private. Never log requests, keys, or raw errors.
export class RandomOrgClient {
  #apiKey;
  #fetch;
  #now;
  #timeoutMs;
  #id = 0;
  #notBefore = 0;
  #failures = 0;
  #quotaDay;
  #bitsLeft = null;
  #requestsLeft = null;

  constructor({ apiKey, fetchImpl = globalThis.fetch, now = Date.now, timeoutMs = 15000 } = {}) {
    this.#apiKey = apiKey || '';
    this.#fetch = fetchImpl;
    this.#now = now;
    this.#timeoutMs = timeoutMs;
  }

  async fetchBlock(requestedBits = BLOCK_BITS) {
    if (!this.#apiKey) throw new PublicError('KEY_MISSING', 'RANDOM.ORG key is not configured. Add it to .env on this computer and restart the server.');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(this.#apiKey)) {
      throw new PublicError('KEY_INVALID', 'The RANDOM.ORG key format is invalid. Check .env and restart the server.');
    }
    if (!Number.isInteger(requestedBits) || requestedBits < 8 || requestedBits > BLOCK_BITS || requestedBits % 8) {
      throw new PublicError('BLOCK_SIZE', 'The random block size is invalid.');
    }
    const now = this.#now();
    if (this.#quotaDay !== utcDay(now)) {
      this.#quotaDay = utcDay(now);
      this.#bitsLeft = this.#requestsLeft = null;
    }
    if (now < this.#notBefore) {
      throw new PublicError('WAIT', `RANDOM.ORG refill is paused. Try again in ${Math.ceil((this.#notBefore - now) / 1000)} seconds.`);
    }
    if (this.#requestsLeft === 0 || (this.#bitsLeft !== null && this.#bitsLeft < 8)) {
      throw new PublicError('QUOTA', 'RANDOM.ORG daily allowance is exhausted. Try after the next UTC midnight or check your API dashboard.');
    }
    const size = this.#bitsLeft === null ? requestedBits : Math.min(requestedBits, Math.floor(this.#bitsLeft / 8) * 8);
    const id = ++this.#id;
    try {
      const response = await this.#fetch(RANDOM_ORG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(this.#timeoutMs),
        body: JSON.stringify({ jsonrpc: '2.0', method: 'generateBlobs', params: { apiKey: this.#apiKey, n: 1, size, format: 'hex' }, id }),
      });
      const retryAfter = response.headers.get('retry-after');
      if (retryAfter !== null) {
        const seconds = /^\d+(\.\d+)?$/.test(retryAfter) ? Number(retryAfter) : null;
        const until = seconds !== null ? this.#now() + seconds * 1000 : Date.parse(retryAfter);
        if (Number.isFinite(until)) this.#notBefore = Math.max(this.#notBefore, until);
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new PublicError('HTTP', response.status === 429 ? 'RANDOM.ORG is limiting requests. Wait before trying again.' : 'RANDOM.ORG could not serve the request. Try again later.');
      }
      // Limit response size and keep the timeout active while reading its body.
      const chunks = [];
      let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > 65536) throw new PublicError('RESPONSE', 'RANDOM.ORG returned an invalid response. Try again later.');
        chunks.push(chunk);
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (payload?.jsonrpc !== '2.0' || payload.id !== id || (Object.hasOwn(payload, 'result') === Object.hasOwn(payload, 'error'))) {
        throw new PublicError('RESPONSE', 'RANDOM.ORG returned an invalid response. Try again later.');
      }
      if (payload.error) throw this.#rpcError(payload.error);
      const result = payload.result;
      if (nonnegativeInteger(result?.advisoryDelay)) this.#notBefore = Math.max(this.#notBefore, this.#now() + result.advisoryDelay);
      if (!nonnegativeInteger(result?.advisoryDelay) || !nonnegativeInteger(result.bitsLeft) || !nonnegativeInteger(result.requestsLeft) || result.bitsUsed !== size) {
        throw new PublicError('RESPONSE', 'RANDOM.ORG returned invalid usage information. Try again later.');
      }
      this.#quotaDay = utcDay(this.#now());
      this.#bitsLeft = result.bitsLeft;
      this.#requestsLeft = result.requestsLeft;
      const blobs = result.random?.data;
      if (!Array.isArray(blobs) || blobs.length !== 1 || typeof blobs[0] !== 'string' || blobs[0].length !== size / 4 || !/^[0-9a-f]+$/i.test(blobs[0])) {
        throw new PublicError('RESPONSE', 'RANDOM.ORG returned an invalid random block. Try again later.');
      }
      this.#failures = 0;
      return Buffer.from(blobs[0], 'hex');
    } catch (error) {
      this.#failures += 1;
      const backoff = Math.min(60000, 5000 * 2 ** Math.min(this.#failures - 1, 4));
      this.#notBefore = Math.max(this.#notBefore, this.#now() + backoff);
      if (error instanceof PublicError) throw error;
      // Raw transport/JSON errors can contain request details. Never pass them on.
      throw new PublicError('NETWORK', 'RANDOM.ORG could not be reached, timed out, or returned unreadable data. Check your connection and try again shortly.');
    }
  }

  #rpcError(error) {
    if ([400, 401, 404, 405].includes(error.code)) {
      return new PublicError('KEY_REJECTED', 'RANDOM.ORG rejected the API key. Check that it is correct, running, and enabled for the Basic API, then restart the server.');
    }
    if (error.code === 402) this.#requestsLeft = 0;
    if (error.code === 403) {
      const remaining = error.data?.[1];
      this.#bitsLeft = nonnegativeInteger(remaining) ? remaining : 0;
    }
    if ([402, 403].includes(error.code)) return new PublicError('QUOTA', 'RANDOM.ORG has insufficient daily allowance. Try later or check your API dashboard.');
    if ([503, 506].includes(error.code)) return new PublicError('CREDIT', 'RANDOM.ORG reports insufficient account credit. Check your API dashboard.');
    return new PublicError('SERVICE', 'RANDOM.ORG could not generate a random block. Try again later.');
  }
}
