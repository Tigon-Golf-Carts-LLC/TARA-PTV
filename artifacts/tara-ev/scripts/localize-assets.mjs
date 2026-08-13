// One-off: download remaining external assets referenced by content pages and rewrite URLs to local paths.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const pub = path.resolve(import.meta.dirname, '../public');
const contentDir = path.join(pub, 'content');
const files = readdirSync(contentDir).filter(f => f.endsWith('.html')).map(f => path.join(contentDir, f));
const cssFiles = readdirSync(path.join(pub, 'css')).filter(f => f.endsWith('.css')).map(f => path.join(pub, 'css', f));

const assetRe = /(?:https?:)?\/\/www\.taragolfcart\.com\/(?:uploads|wp-content)\/[^\s"'()<>]+?\.(?:css|jpg|jpeg|png|webp|gif|svg)(?:\?[^\s"'()<>]*)?/g;
const toAbs = (u) => (u.startsWith('//') ? 'https:' + u : u);

const urls = new Set();
for (const f of [...files, ...cssFiles]) {
  const t = readFileSync(f, 'utf8');
  for (const m of t.matchAll(assetRe)) urls.add(m[0]);
}
console.log('unique asset urls:', urls.size);

mkdirSync(path.join(pub, 'css/ext'), { recursive: true });
mkdirSync(path.join(pub, 'images/ext'), { recursive: true });

const map = new Map(); // url -> local path or null (failed)
let done = 0;
const list = [...urls];
const CONC = 12;
async function worker() {
  while (list.length) {
    const url = list.pop();
    const clean = url.split('?')[0];
    const ext = clean.slice(clean.lastIndexOf('.') + 1).toLowerCase();
    const isCss = ext === 'css';
    const base = decodeURIComponent(clean.split('/').pop()).replace(/[^A-Za-z0-9._-]/g, '_');
    const hash = createHash('md5').update(url).digest('hex').slice(0, 8);
    const name = `${hash}-${base}`;
    const rel = isCss ? `/css/ext/${name}` : `/images/ext/${name}`;
    const abs = path.join(pub, rel);
    try {
      if (!existsSync(abs)) {
        const res = await fetch(toAbs(url), { redirect: 'follow' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        writeFileSync(abs, Buffer.from(await res.arrayBuffer()));
      }
      map.set(url, rel);
    } catch (e) {
      console.log('FAIL', url, e.message);
      map.set(url, null);
    }
    if (++done % 100 === 0) console.log('progress', done);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));

let failed = 0, ok = 0;
for (const v of map.values()) v ? ok++ : failed++;
console.log({ ok, failed });

// Rewrite files
for (const f of [...files, ...cssFiles]) {
  let t = readFileSync(f, 'utf8');
  const orig = t;
  // Remove <link> tags pointing at failed CSS urls; replace successful urls.
  t = t.replace(/<link\b[^>]*href=["']((?:https?:)?\/\/www\.taragolfcart\.com[^"']+)["'][^>]*>\s*/g, (tag, url) => {
    if (!map.has(url)) return tag;
    const local = map.get(url);
    return local ? tag.replace(url, local) : '';
  });
  t = t.replace(assetRe, (url) => {
    const local = map.get(url);
    return local === undefined ? url : (local ?? '/images/ext/missing.svg');
  });
  if (t !== orig) writeFileSync(f, t);
}
console.log('rewrite complete');
