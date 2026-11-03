import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEquipmentDirectory } from '../server/equipment-files.js';
import { inspectEquipmentDatabase } from '../src/domain/equipment-v2.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const folder = resolve(root, args.find(arg => !arg.startsWith('--')) || 'database/real');
const inside = relative(root, folder);
try {
  if (inside.startsWith('..') || isAbsolute(inside)) throw new Error('Choose a data folder inside this project.');
  if (args.some(arg => arg.startsWith('--') && arg !== '--strict')) throw new Error('Supported option: --strict');
  const database = await loadEquipmentDirectory(folder);
  const { issues, eligibleOperators } = inspectEquipmentDatabase(database);
  console.log(`Data check: ${relative(root, folder)} (${database.dataVersion?.kind ?? 'unknown'} data)`);
  for (const issue of issues) console.log(`${issue.severity.toUpperCase()} [${issue.code}] ${issue.path}: ${issue.message}`);
  for (const side of ['attack', 'defense']) console.log(`Eligible ${side}: ${eligibleOperators.filter(op => op.side === side).length}`);
  const errors = issues.filter(issue => issue.severity === 'error').length;
  console.log(`${errors} error(s), ${issues.length - errors} warning(s). The active app dataset has not been changed.`);
  process.exitCode = errors || (strict && (issues.length || !eligibleOperators.length)) ? 1 : 0;
} catch (error) {
  console.error(`Data check failed: ${error.message}`);
  process.exitCode = 1;
}
