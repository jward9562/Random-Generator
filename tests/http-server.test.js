import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createAppServer } from '../server/http-server.js';
import { createLoadoutService } from '../server/loadout-service.js';
import { RandomOrgClient } from '../server/random-org-client.js';
import { BitBuffer } from '../server/bit-buffer.js';
import { mockDatabase } from '../src/data/mock-database.js';
import { requestLoadout } from '../src/ui/remote-generator.js';
import { createController } from '../src/ui/controller.js';
import { readApiKey } from '../server/config.js';
import { readFile, mkdir, writeFile, rm } from 'node:fs/promises';

async function localServer(t, service) {
  const server = createAppServer({ service });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, post: (body, headers = {}) => fetch(`${base}/api/generate`, {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  }) };
}

test('static pages never generate; private files and unrelated browser origins are blocked', async t => {
  let calls = 0;
  const { base, post } = await localServer(t, { generate: async () => { calls += 1; return {}; } });
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self'/);
  const validationModule = await fetch(base + '/src/domain/equipment-v2.js');
  assert.equal(validationModule.status, 200);
  assert.match(validationModule.headers.get('content-type'), /text\/javascript/);
  assert.equal((await fetch(base + '/database/real/metadata.json')).status, 404);
  assert.equal((await fetch(base + '/server/equipment-files.js')).status, 404);
  assert.equal(calls, 0);
  for (const path of ['/.env', '/.env.example', '/server/config.js', '/server/random-org-client.js', '/.git/config', '/src/random/local-provider.js', '/src/../server/config.js']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  assert.equal((await post({ side: 'attack' }, { Origin: 'https://example.org' })).status, 403);
  assert.equal((await post({ side: 'attack' }, { Origin: 'null' })).status, 403);
  const invalidHostStatus = await new Promise((resolve, reject) => {
    const req = request(base, { headers: { Host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end();
  });
  assert.equal(invalidHostStatus, 403);
  assert.equal((await post({ side: 'attack' }, { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post({ side: 'wrong' })).status, 400);
  assert.equal((await fetch(base + '/api/generate')).status, 405);
  assert.equal(calls, 0);
});

test('HTTP integration uses the buffered provider and preserves results on failed replenishment', async t => {
  const secret = '00000000-0000-0000-0000-000000000000';
  let calls = 0;
  let now = Date.now();
  const client = new RandomOrgClient({ apiKey: secret, now: () => now, fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body);
    if (++calls > 1) throw new Error(`transport could include ${secret}`);
    return Response.json({ jsonrpc: '2.0', id: request.id, result: { random: { data: ['00'.repeat(request.params.size / 8)] }, bitsUsed: request.params.size, bitsLeft: 10000, requestsLeft: 99, advisoryDelay: 1000 } });
  } });
  // Small injected block exercises exhaustion quickly; production uses 8192 bits.
  const buffer = new BitBuffer(() => client.fetchBlock(64));
  const { base } = await localServer(t, createLoadoutService(mockDatabase, buffer));
  const controller = createController({ generate: side => requestLoadout(side, (path, options) => fetch(base + path, { ...options, headers: { ...options.headers, Origin: base } })) });
  assert.equal(calls, 0);
  await controller.generateAll();
  assert.equal(controller.state.result.randomness.source, 'RANDOM.ORG');
  assert.equal(calls, 1);
  now += 2000;
  let previous;
  for (let run = 0; run < 20 && !controller.state.error; run += 1) {
    previous = controller.state.result;
    await controller.generateAll();
  }
  assert.ok(controller.state.error);
  assert.equal(controller.state.result, previous);
  assert.equal(calls, 2);
  assert.equal(buffer.stats.bitsConsumed, 64);
  assert.ok(!JSON.stringify(controller.state).includes(secret));
});

test('unexpected server errors never expose error details', async t => {
  const { post } = await localServer(t, { generate: () => { throw new Error('SECRET MUST NOT APPEAR'); } });
  const response = await post({ side: 'attack' });
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('SECRET MUST NOT APPEAR'));
});

test('missing configuration returns a useful error without any outgoing call', async t => {
  const client = new RandomOrgClient({ apiKey: '', fetchImpl: () => assert.fail('must not call RANDOM.ORG') });
  const { post } = await localServer(t, createLoadoutService(mockDatabase, new BitBuffer(() => client.fetchBlock())));
  const response = await post({ side: 'attack' });
  assert.match((await response.json()).error.message, /Add it to .env/);
});

test('browser adapter rejects unavailable server and unrecognized provenance', async () => {
  await assert.rejects(() => requestLoadout('attack', () => { throw new Error('offline'); }), /local server is unavailable/);
  await assert.rejects(() => requestLoadout('attack', async () => Response.json({ result: { randomness: { source: 'local' } } })), /invalid loadout/);
});

test('config supports environment precedence and a project-local file without displaying the key', async t => {
  const directory = new URL('../.local/config-test/', import.meta.url);
  const file = new URL('fixture.env', directory);
  await mkdir(directory, { recursive: true });
  t.after(async () => { await rm(file, { force: true }); });
  await writeFile(file, 'RANDOM_ORG_API_KEY=file-fixture\n');
  assert.equal(await readApiKey({ env: {}, file }), 'file-fixture');
  assert.equal(await readApiKey({ env: { RANDOM_ORG_API_KEY: 'environment-fixture' }, file }), 'environment-fixture');
  assert.equal(await readApiKey({ env: { RANDOM_ORG_API_KEY: '' }, file }), '');
  assert.equal(await readApiKey({ env: {}, file: new URL('missing.env', directory) }), '');
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.ok(!source.includes('void controller.generateAll()'));
  assert.ok(!source.includes('LocalRandomProvider'));
});
