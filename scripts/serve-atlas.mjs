// Static server for the atlas. The game is static files at this stage; this
// exists only because a browser will not fetch JSON from a file:// page.
//
// Separate from legacy/scripts/serve.mjs, which serves the retired game out of
// legacy/web/. Same shape, different root — not worth sharing a module for.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = new URL('../atlas/', import.meta.url).pathname;
const PORT = Number(process.env.PORT || 8140);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
};

createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = join(ROOT, normalize(path === '/' ? '/index.html' : path));
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] || 'application/octet-stream',
      // Never cache: pulling new code and being served the old map out of the
      // browser cache is a confusing five minutes.
      'cache-control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(PORT, () => console.log(`\n  Atlas at http://localhost:${PORT}/\n`));
