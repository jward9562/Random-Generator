import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { EditorError } from './editor-store.js';

const assets = {
  '/': ['editor/index.html', 'text/html'],
  '/editor.css': ['editor/editor.css', 'text/css'],
  '/editor.js': ['editor/editor.js', 'text/javascript'],
  '/model.js': ['editor/model.js', 'text/javascript'],
  '/src/domain/equipment-v2.js': ['src/domain/equipment-v2.js', 'text/javascript'],
  '/src/domain/verification.js': ['src/domain/verification.js', 'text/javascript'],
};
export function createEditorServer(store, { practice = false } = {}) {
  const server = createServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    try {
      const port = server.address().port;
      if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) throw new EditorError('Use the local editor address.', 403);
      const origin = `http://${req.headers.host}`;
      if ((req.headers.origin && req.headers.origin !== origin) || (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) throw new EditorError('This editor accepts requests only from its own local page.', 403);
      const path = new URL(req.url, origin).pathname;
      if (path === '/api/database' && req.method === 'GET') { send(200, { ...await store.load(), workspace: practice ? 'practice' : 'real' }); return; }
      if (path === '/api/save' && req.method === 'POST') {
        if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') throw new EditorError('Save from the local editor page using JSON.', 403);
        let bytes = 0; const chunks = [];
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 4 * 1024 * 1024) throw new EditorError('This save is too large.', 413); chunks.push(chunk); }
        let input;
        try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new EditorError('The save request was not valid JSON.'); }
        if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['database', 'revision', 'verifyIds'].includes(key))) throw new EditorError('Invalid save request.');
        send(200, await store.save(input)); return;
      }
      if (req.method === 'GET' && Object.hasOwn(assets, path)) {
        const [file, type] = assets[path];
        const content = await readFile(new URL(`../${file}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); res.end(content); return;
      }
      throw new EditorError('Not found.', 404);
    } catch (error) {
      send(error instanceof EditorError ? error.status : 500, { error: error instanceof EditorError ? error.message : 'Could not load or save the database. Check the JSON files with Validate-Database.cmd and consult the editor guide.', issues: error instanceof EditorError ? error.issues : [] });
    }
  });
  server.requestTimeout = 15000;
  return server;
}
