import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { RandomOrgClient, BLOCK_BITS, RANDOM_ORG_URL } from '../server/random-org-client.js';

// Deliberately invalid account identity, used ONLY with injected transports.
const apiKey = '00000000-0000-0000-0000-000000000000';
function success(request, overrides = {}) {
  return Response.json({ jsonrpc: '2.0', id: request.id, result: {
    random: { data: ['ab'.repeat(request.params.size / 8)] },
    bitsUsed: request.params.size, bitsLeft: 100000, requestsLeft: 99, advisoryDelay: 0, ...overrides,
  } });
}
function fixture(handler = request => success(request)) {
  let now = Date.parse('2026-11-03T12:00:00Z');
  const requests = [];
  const client = new RandomOrgClient({ apiKey, now: () => now, fetchImpl: async (url, options) => {
    assert.equal(url, RANDOM_ORG_URL);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.equal(options.redirect, 'error');
    const request = JSON.parse(options.body);
    requests.push(request);
    return handler(request, requests.length);
  } });
  return { client, requests, advance: milliseconds => { now += milliseconds; } };
}

test('uses release 4 generateBlobs with fresh 8192-bit hex blocks', async () => {
  const f = fixture();
  const block = await f.client.fetchBlock();
  assert.equal(block.length, 1024);
  assert.equal(block[0], 0xab);
  assert.deepEqual(f.requests[0], { jsonrpc: '2.0', method: 'generateBlobs', params: { apiKey, n: 1, size: BLOCK_BITS, format: 'hex' }, id: 1 });
  await f.client.fetchBlock();
  assert.equal(f.requests[1].id, 2);
});

test('advisory delay blocks new calls without sleeping or automatically retrying', async () => {
  const f = fixture(request => success(request, { advisoryDelay: 2000 }));
  await f.client.fetchBlock();
  await assert.rejects(() => f.client.fetchBlock(), /Try again in 2 seconds/);
  assert.equal(f.requests.length, 1);
  f.advance(2000);
  await f.client.fetchBlock();
  assert.equal(f.requests.length, 2);
});

test('known bit allowance shrinks the next block and request exhaustion stops calls until UTC reset', async () => {
  const f = fixture((request, count) => success(request, { bitsLeft: count === 1 ? 23 : 7, requestsLeft: count === 1 ? 1 : 0 }));
  await f.client.fetchBlock();
  assert.equal((await f.client.fetchBlock()).length, 2);
  assert.equal(f.requests[1].params.size, 16);
  await assert.rejects(() => f.client.fetchBlock(), /daily allowance/);
  assert.equal(f.requests.length, 2);
  f.advance(24 * 60 * 60 * 1000);
  await f.client.fetchBlock();
  assert.equal(f.requests[2].params.size, BLOCK_BITS);
});

test('HTTP Retry-After and failure backoff suppress repeated requests', async () => {
  const f = fixture((request, count) => count === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '90' } }) : success(request));
  await assert.rejects(() => f.client.fetchBlock(), /limiting requests/);
  f.advance(5000);
  await assert.rejects(() => f.client.fetchBlock(), /85 seconds/);
  assert.equal(f.requests.length, 1);
  f.advance(85000);
  await f.client.fetchBlock();
});

test('Retry-After HTTP-date is respected', async () => {
  const f = fixture(() => new Response('', { status: 503, headers: { 'Retry-After': 'Tue, 03 Nov 2026 12:02:00 GMT' } }));
  await assert.rejects(() => f.client.fetchBlock(), /could not serve/);
  await assert.rejects(() => f.client.fetchBlock(), /120 seconds/);
  assert.equal(f.requests.length, 1);
});

test('RPC key, quota, credit and service errors are sanitized', async () => {
  for (const code of [400, 401, 402, 403, 404, 405, 503, 506, 101, -32603]) {
    const f = fixture(request => Response.json({ jsonrpc: '2.0', id: request.id, error: { code, message: `sensitive ${apiKey}`, data: [8192, 0] } }));
    await assert.rejects(() => f.client.fetchBlock(), error => !error.message.includes(apiKey) && error.code !== undefined);
    await assert.rejects(() => f.client.fetchBlock());
    assert.equal(f.requests.length, 1);
    if ([402, 403].includes(code)) {
      f.advance(60000);
      await assert.rejects(() => f.client.fetchBlock(), /daily allowance/);
      assert.equal(f.requests.length, 1);
    }
  }
});

test('bit quota rejection with a remaining allowance permits a smaller later refill', async () => {
  const f = fixture((request, count) => count === 1
    ? Response.json({ jsonrpc: '2.0', id: request.id, error: { code: 403, data: [8192, 100] } })
    : success(request));
  await assert.rejects(() => f.client.fetchBlock(), /allowance/);
  f.advance(5000);
  await f.client.fetchBlock();
  assert.equal(f.requests[1].params.size, 96);
});

test('malformed and mismatched responses are rejected before entering the buffer', async () => {
  const variants = [
    request => Response.json({ jsonrpc: '2.0', id: request.id + 1, result: {} }),
    request => Response.json({ jsonrpc: '1.0', id: request.id, result: {} }),
    request => success(request, { random: { data: ['ab'] } }),
    request => success(request, { random: { data: ['z'.repeat(request.params.size / 4)] } }),
    request => success(request, { bitsUsed: 0 }),
    request => success(request, { advisoryDelay: -1 }),
    request => success(request, { requestsLeft: null }),
    () => new Response(`not json ${apiKey}`),
    () => new Response('x'.repeat(65537)),
  ];
  for (const handler of variants) {
    const f = fixture(handler);
    await assert.rejects(() => f.client.fetchBlock(), error => !error.message.includes(apiKey));
    assert.equal(f.requests.length, 1);
  }
});

test('transport errors and timeouts are sanitized and never retried automatically', async () => {
  const f = fixture(() => { throw new Error(`request contains ${apiKey}`); });
  await assert.rejects(() => f.client.fetchBlock(), error => error.code === 'NETWORK' && !error.message.includes(apiKey));
  await assert.rejects(() => f.client.fetchBlock(), /paused/);
  assert.equal(f.requests.length, 1);
  let calls = 0;
  const client = new RandomOrgClient({ apiKey, timeoutMs: 10, fetchImpl: async (_url, { signal }) => {
    calls += 1;
    await delay(100, undefined, { signal });
  } });
  await assert.rejects(() => client.fetchBlock(), /timed out/);
  assert.equal(calls, 1);
});

test('missing or malformed keys cause no HTTP request', async () => {
  for (const key of ['', 'not-a-key']) {
    const client = new RandomOrgClient({ apiKey: key, fetchImpl: () => { assert.fail('must not contact network'); } });
    await assert.rejects(() => client.fetchBlock(), /key/i);
  }
});
