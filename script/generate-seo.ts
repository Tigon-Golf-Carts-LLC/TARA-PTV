/**
 * generate-seo.ts — emits sitemap.xml, the per-section sitemaps and
 * robots.txt from the build-time snapshot.
 *
 * Runs after fetch-data.ts (which stages `static/` into `public/`), so the
 * files written here deliberately overwrite the mirrored originals with
 * versions that point at the configured SITE_DOMAIN / BASE_PATH.
 */
import fs from 'node:fs';
import path from 'node:path';

import { BASE_PREFIX, DIRS, SITE_ORIGIN, absoluteUrl, logConfig } from './lib/config.js';
import { escXml } from './lib/html.js';

type Routes = Record<string, { file?: string; redirect?: string; title?: string; image?: string; imageAlt?: string }>;

const TODAY = new Date().toISOString().slice(0, 10);

function readJson<T>(name: string): T {
  return JSON.parse(fs.readFileSync(path.join(DIRS.publicData, name), 'utf8')) as T;
}

function urlset(entries: Array<{ loc: string; priority: number; changefreq: string; extra?: string }>): string {
  const body = entries
    .map(
      (e) =>
        `<url><loc>${escXml(e.loc)}</loc><lastmod>${TODAY}</lastmod>` +
        `<changefreq>${e.changefreq}</changefreq>` +
        `<priority>${e.priority.toFixed(1)}</priority>${e.extra ?? ''}</url>`,
    )
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" ` +
    `xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${body}</urlset>`
  );
}

function priorityFor(routePath: string): number {
  if (routePath === '/') return 1.0;
  if (/^\/(t[123]-series|accessories|contact|financing|fleet-golf-carts)\/$/.test(routePath)) return 0.9;
  if (routePath.includes('-product/')) return 0.8;
  if (routePath.startsWith('/news/') || routePath.startsWith('/blog/')) return 0.5;
  return 0.6;
}

function changefreqFor(routePath: string): string {
  if (routePath === '/') return 'daily';
  if (routePath.startsWith('/news/') || routePath.startsWith('/blog/')) return 'monthly';
  return 'weekly';
}

function main() {
  logConfig('generate-seo');

  const routes = readJson<Routes>('routes.json');
  const paths = Object.entries(routes)
    .filter(([, meta]) => !meta.redirect)
    .map(([p]) => p)
    .sort();

  const pagePaths = paths.filter((p) => !p.startsWith('/news/') && !(p.startsWith('/blog/') && p !== '/blog/'));
  const newsPaths = paths.filter((p) => p.startsWith('/news/') || (p.startsWith('/blog/') && p !== '/blog/'));
  const productPaths = paths.filter((p) => p.includes('-product/'));

  const toEntry = (p: string) => {
    const meta = routes[p];
    const extra = meta?.image
      ? `<image:image><image:loc>${escXml(absoluteUrl(meta.image))}</image:loc>` +
        `<image:title>${escXml(meta.imageAlt || meta.title || '')}</image:title></image:image>`
      : '';
    return { loc: absoluteUrl(p), priority: priorityFor(p), changefreq: changefreqFor(p), extra };
  };

  const files: Array<[string, string]> = [
    ['sitemap-pages.xml', urlset(pagePaths.map(toEntry))],
    ['sitemap-news.xml', urlset(newsPaths.map(toEntry))],
    ['sitemap-products.xml', urlset(productPaths.map(toEntry))],
  ];

  // sitemap.xml is a sitemap *index* pointing at the three section maps.
  const index =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">` +
    files
      .map(([name]) => `<sitemap><loc>${escXml(absoluteUrl('/' + name))}</loc><lastmod>${TODAY}</lastmod></sitemap>`)
      .join('') +
    `</sitemapindex>`;
  files.push(['sitemap.xml', index]);

  const robots = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /data/',
    '',
    '# AI crawlers — content is public, attribution appreciated.',
    'User-agent: GPTBot',
    'Allow: /',
    '',
    'User-agent: ClaudeBot',
    'Allow: /',
    '',
    `Sitemap: ${absoluteUrl('/sitemap.xml')}`,
    `Host: ${SITE_ORIGIN}${BASE_PREFIX}`,
    '',
  ].join('\n');
  files.push(['robots.txt', robots]);

  for (const [name, content] of files) {
    fs.writeFileSync(path.join(DIRS.public, name), content, 'utf8');
  }

  // Drop the mirrored duplicates of the sitemaps we now generate ourselves,
  // so crawlers are never served two conflicting copies of the same map.
  const staleMirrors = [
    'dynamic-sitemap.xml',
    'urllist.xml',
    'post-sitemap.xml',
    'news-sitemap.xml',
    'page-sitemap.xml',
    'sitemap-blog.xml',
    'xhtml-sitemap.xml',
    'hreflang-sitemap.xml',
    'mobile-sitemap.xml',
  ];
  let dropped = 0;
  for (const name of staleMirrors) {
    const p = path.join(DIRS.public, name);
    if (fs.existsSync(p)) {
      fs.rmSync(p);
      dropped++;
    }
  }

  console.log(
    `[generate-seo] wrote sitemap.xml (index) + ${files.length - 2} section map(s) and robots.txt ` +
      `for ${paths.length} URL(s); dropped ${dropped} stale mirrored sitemap(s).`,
  );
}

main();
