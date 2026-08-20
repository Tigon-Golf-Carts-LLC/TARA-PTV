/**
 * serve-dist.ts — serves dist/ exactly the way GitHub Pages does, so that
 * `npm run preview` exercises the real deploy artifact:
 *
 *   • files are served verbatim, no rewriting
 *   • "/foo/" resolves to "/foo/index.html"
 *   • anything unmatched falls back to 404.html with a 404 status
 *   • the site is mounted under BASE_PATH, like a project site
 *
 * There is no API, no proxy and no SPA rewrite — if a URL works here it works
 * on Pages.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import { BASE_PREFIX, DIRS } from './lib/config.js';

const PORT = Number(process.env.PORT) || 4173;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonld': 'application/ld+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.kml': 'application/vnd.google-earth.kml+xml',
  '.geojson': 'application/geo+json',
  '.webmanifest': 'application/manifest+json',
};

export function resolveFile(urlPath: string): string | null {
  let rel = urlPath.split('?')[0].split('#')[0];
  if (BASE_PREFIX && rel.startsWith(BASE_PREFIX)) rel = rel.slice(BASE_PREFIX.length) || '/';
  try {
    rel = decodeURIComponent(rel);
  } catch {
    /* keep the raw path */
  }
  const abs = path.join(DIRS.dist, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!abs.startsWith(DIRS.dist)) return null; // path traversal guard
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  const indexFile = path.join(abs, 'index.html');
  if (fs.existsSync(indexFile)) return indexFile;
  return null;
}

export function createServer() {
  return http.createServer((req, res) => {
    const file = resolveFile(req.url ?? '/');
    if (file) {
      res.writeHead(200, {
        'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-cache',
      });
      fs.createReadStream(file).pipe(res);
      return;
    }
    const notFound = path.join(DIRS.dist, '404.html');
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(fs.existsSync(notFound) ? fs.readFileSync(notFound) : 'Not found');
  });
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  if (!fs.existsSync(DIRS.dist)) {
    console.error('[preview] dist/ does not exist — run `npm run build` first.');
    process.exit(1);
  }
  createServer().listen(PORT, '0.0.0.0', () => {
    console.log(`[preview] serving dist/ at http://localhost:${PORT}${BASE_PREFIX}/`);
  });
}
