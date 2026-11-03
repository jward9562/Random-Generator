import { open, readFile, unlink, realpath, lstat, mkdir, mkdtemp, cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { EditorStore } from '../server/editor-store.js';
import { createEditorServer } from '../server/editor-http.js';

// Fixed workspace, no browser-provided paths, no .env or RANDOM.ORG imports.
const practice = process.argv.slice(2).includes('--practice');
let directory = fileURLToPath(new URL('../database/real/', import.meta.url));
let lockPath;
let ownsLock = false;
async function release() { if (ownsLock) { await unlink(lockPath).catch(() => {}); ownsLock = false; } }
try {
  if (process.argv.slice(2).some(arg => arg !== '--practice')) throw new Error('Only --practice is supported; custom filesystem paths are not accepted.');
  if (practice) {
    const base = fileURLToPath(new URL('../.local/', import.meta.url)).replace(/[\\/]$/, '');
    await mkdir(base, { recursive: true });
    if ((await realpath(base)).toLowerCase() !== base.toLowerCase()) throw new Error('The practice workspace cannot be a linked path.');
    directory = await mkdtemp(join(base, 'editor-practice-'));
    await cp(new URL('../database/example/', import.meta.url), directory, { recursive: true });
  }
  lockPath = join(directory, '.editor-session.lock');
  if ((await realpath(directory)).toLowerCase() !== directory.replace(/[\\/]$/, '').toLowerCase()) throw new Error('The editor requires an ordinary database/real directory, not a linked path.');
  try {
    const lock = await open(lockPath, 'wx'); await lock.writeFile(String(process.pid)); await lock.close(); ownsLock = true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if ((await lstat(lockPath)).isSymbolicLink()) throw new Error('The editor lock cannot be a linked file.');
    const pid = Number(await readFile(lockPath, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Editor lock needs manual inspection. See docs/editor-guide.md.');
    let alive = true;
    try { process.kill(pid, 0); } catch (check) { if (check.code === 'ESRCH') alive = false; }
    if (alive) throw new Error('An editor is already running. Use its browser page or close it before starting another.');
    await unlink(lockPath);
    const lock = await open(lockPath, 'wx'); await lock.writeFile(String(process.pid)); await lock.close(); ownsLock = true;
  }
  const store = new EditorStore(directory);
  await store.load(); // Recover any interrupted save before serving the editor.
  const port = practice ? 4175 : 4174;
  const server = createEditorServer(store, { practice });
  server.on('error', async () => { console.error(`Could not start editor on port ${port}. Close the other process using that port.`); await release(); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Database editor: http://127.0.0.1:${port}\n${practice ? 'Fictional practice copy in .local; real data is untouched.' : 'Edits only database/real/.'} No RANDOM.ORG calls. Press Ctrl+C to stop.`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => { await release(); process.exit(0); }));
} catch (error) { console.error(`Editor could not start: ${error.message}`); await release(); process.exitCode = 1; }
