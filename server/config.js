import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { PublicError } from './errors.js';

export async function readApiKey({ env = process.env, file = new URL('../.env', import.meta.url) } = {}) {
  if (Object.hasOwn(env, 'RANDOM_ORG_API_KEY')) return env.RANDOM_ORG_API_KEY.trim();
  try {
    const config = parseEnv(await readFile(file, 'utf8'));
    return (config.RANDOM_ORG_API_KEY || '').trim();
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw new PublicError('CONFIG', 'Could not read .env. Check the local configuration file and restart the server.');
  }
}
