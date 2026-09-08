import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGateway } from './gateway.mjs';

const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const port = Number(process.env.MANDATE_WEB_PORT || 8082);
const origin = `http://localhost:${port}`;
const gateway = createGateway({ origin });
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
await stat(resolve(root, 'index.html')).catch(() => { throw new Error('Build the web app first with npm run web:build.'); });
http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store');
  if (req.headers.host !== `localhost:${port}`) { res.writeHead(403); res.end('Use ' + origin); return; }
  try {
    const url = new URL(req.url, origin);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      const chunks = []; let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 128 * 1024) { res.writeHead(413); res.end(); return; }
        chunks.push(chunk);
      }
      const request = new Request(url, { method: req.method, headers: req.headers, ...(!['GET','HEAD'].includes(req.method) ? { body: Buffer.concat(chunks) } : {}) });
      const response = await gateway(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const pathname = decodeURIComponent(url.pathname);
    let file = resolve(root, '.' + pathname);
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep) && file !== root) { res.writeHead(404); res.end(); return; }
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) {
      if (extname(pathname)) { res.writeHead(404); res.end(); return; }
      file = resolve(root, 'index.html');
    }
    const content = await readFile(file);
    res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch { res.writeHead(500); res.end('Unable to serve the local app.'); }
}).listen(port, '127.0.0.1', () => console.log(`Mandate web is ready at ${origin}\nLocal preview only. Connected to the existing hosted agent.`));
