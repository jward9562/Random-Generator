import { readApiKey } from '../server/config.js';
import { RandomOrgClient } from '../server/random-org-client.js';
import { BitBuffer } from '../server/bit-buffer.js';
import { createLoadoutService } from '../server/loadout-service.js';
import { createAppServer } from '../server/http-server.js';
import { mockDatabase } from '../src/data/mock-database.js';
import { PublicError } from '../server/errors.js';
const port = Number(process.env.PORT || 4173);
try {
  const client = new RandomOrgClient({ apiKey: await readApiKey() });
  const provider = new BitBuffer(() => client.fetchBlock());
  const server = createAppServer({ service: createLoadoutService(mockDatabase, provider) });
  server.on('error', () => {
    console.error('Could not start the local server. Check whether the port is already in use.');
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => console.log(`Local prototype: http://127.0.0.1:${port}\nPress Ctrl+C to stop. RANDOM.ORG is contacted only when Generate All needs more bits.`));
} catch (error) {
  console.error(error instanceof PublicError ? error.message : 'Could not start the local server. Check the configuration.');
  process.exitCode = 1;
}
