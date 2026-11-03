import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { PublicError } from './errors.js';

const publicFiles = new Set([
  '/index.html', '/styles.css', '/src/app.js', '/src/data/mock-database.js',
  '/src/domain/compatibility.js', '/src/ui/controller.js', '/src/ui/remote-generator.js',
]);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function createAppServer({ service, root = new URL('../', import.meta.url) }) {
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    try {
      // Strict Host + Origin checks protect the local key/quota from other websites.
      const port = server.address().port;
      const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
      if (!hosts.includes(req.headers.host)) throw new PublicError('HOST', 'Use the local application address.', 403);
      const path = new URL(req.url, `http://${req.headers.host}`).pathname;
      if (path === '/api/generate') {
        if (req.method !== 'POST') throw new PublicError('METHOD', 'Use Generate All to request a loadout.', 405);
        if (req.headers.origin !== `http://${req.headers.host}` || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) {
          throw new PublicError('ORIGIN', 'Open the application locally to generate a loadout.', 403);
        }
        if (req.headers['content-type'] !== 'application/json') throw new PublicError('CONTENT', 'Expected a JSON request.', 415);
        let body = '';
        for await (const chunk of req) {
          body += chunk;
          if (Buffer.byteLength(body) > 256) throw new PublicError('BODY', 'The request is too large.', 413);
        }
        let input;
        try { input = JSON.parse(body); } catch { throw new PublicError('BODY', 'The loadout request was invalid.', 400); }
        if (!input || Object.keys(input).length !== 1 || !['attack', 'defense'].includes(input.side)) throw new PublicError('SIDE', 'Choose Attack or Defense.', 400);
        const result = await service.generate(input.side);
        json(res, 200, { result });
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw new PublicError('METHOD', 'Method not allowed.', 405);
      const file = path === '/' ? '/index.html' : path;
      if (!publicFiles.has(file)) throw new PublicError('NOT_FOUND', 'Not found.', 404);
      const body = await readFile(new URL(`.${file}`, root));
      res.writeHead(200, { 'Content-Type': `${types[extname(file)]}; charset=utf-8` });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      const safe = error instanceof PublicError ? error : new PublicError('INTERNAL', 'The local server could not complete the loadout. Try again or restart the server.');
      json(res, safe.status, { error: { code: safe.code, message: safe.message } });
    }
  });
  server.requestTimeout = 20000;
  return server;
}
