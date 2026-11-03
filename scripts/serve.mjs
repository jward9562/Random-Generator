import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
const server = createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    // Serve only public application files, never repository metadata or local secrets.
    if (!(pathname === '/' || pathname === '/index.html' || pathname === '/styles.css' || pathname.startsWith('/src/'))) {
      res.writeHead(404).end('Not found');
      return;
    }
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep) || !types[extname(file)]) {
      res.writeHead(404).end('Not found');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': `${types[extname(file)]}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404).end('Not found');
  }
});
server.on('error', (error) => {
  console.error(`Could not start local server: ${error.message}`);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => console.log(`Local prototype: http://127.0.0.1:${port}\nPress Ctrl+C to stop.`));
