import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { root } from './compile.mjs';

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
export async function createServer(config, port = 8787) {
  const webRoot = path.join(root, 'web');
  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(request.headers.host)) { response.writeHead(403); response.end(); return; }
    try {
      const url = new URL(request.url, `http://127.0.0.1:${port}`);
      if (url.pathname === '/api/config' || url.pathname === '/api/config.json') {
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.end(request.method === 'HEAD' ? undefined : JSON.stringify(config)); return;
      }
      const filename = url.pathname === '/vendor/ethers.js'
        ? path.join(root, 'node_modules/ethers/dist/ethers.umd.min.js')
        : path.resolve(webRoot, `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
      if (url.pathname !== '/vendor/ethers.js' && !filename.startsWith(webRoot + path.sep)) { response.writeHead(403); response.end(); return; }
      const content = await fs.readFile(filename);
      response.setHeader('Content-Type', mime[path.extname(filename)] || 'application/octet-stream');
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch { response.writeHead(404); response.end('Not found'); }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}
