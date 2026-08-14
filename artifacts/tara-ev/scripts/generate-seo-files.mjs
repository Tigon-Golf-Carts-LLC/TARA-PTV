#!/usr/bin/env node
/**
 * Generates the extended SEO/AI discovery file suite under public/
 * from the canonical sitemaps (sitemap-pages.xml, sitemap-news.xml, sitemap-images.xml).
 * Re-run after adding/removing pages: node scripts/generate-seo-files.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUB = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const SITE = 'https://taraptv.com';
const BRAND = 'TARA Personal Transportation Vehicles';
const PHONE = '+1-844-844-3432';
const EMAIL = 'info@taraptv.com';
const TODAY = new Date().toISOString().slice(0, 10);
const NOW = new Date().toISOString();

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const lastmods = new Map();
const locs = (file) => [...readFileSync(join(PUB, file), 'utf8').matchAll(/<url>[\s\S]*?<loc>([^<]+)<\/loc>(?:[\s\S]*?<lastmod>([^<]+)<\/lastmod>)?[\s\S]*?<\/url>/g)]
  .map((m) => { if (m[2]) lastmods.set(m[1], m[2]); return m[1]; });
const lastmodOf = (u) => lastmods.get(u) || TODAY;

const pages = locs('sitemap-pages.xml');
const news = locs('sitemap-news.xml');
const blogPosts = news.filter((u) => u.includes('/blog/') && u !== `${SITE}/blog/`);
const newsPosts = news.filter((u) => u.includes('/news/'));
const productPages = pages.filter((u) => /-product\/$/.test(u));
const seriesPages = pages.filter((u) => /\/(t1|t2|t3)-series\/$|fleet-golf-carts\/$/.test(u));

const titleFromUrl = (u) =>
  (u.replace(SITE, '').replace(/\/$/, '').split('/').pop() || 'Home')
    .split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    .replace(/\b(2 2)\b/g, '2+2');

const write = (name, content) => {
  const p = join(PUB, name);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content.trimStart());
  console.log('wrote', name);
};

const urlset = (urls, { freq = 'monthly', prio = '0.7', extraNs = '', mapUrl = null } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${extraNs}>
${urls.map((u) => `  <url>
    <loc>${esc(u)}</loc>
    <lastmod>${lastmodOf(u)}</lastmod>
    <changefreq>${freq}</changefreq>
    <priority>${u === SITE + '/' ? '1.0' : prio}</priority>${mapUrl ? mapUrl(u) : ''}
  </url>`).join('\n')}
</urlset>
`;

/* ---- derivative sitemaps ---- */
write('sitemap-blog.xml', urlset([`${SITE}/blog/`, ...blogPosts], { freq: 'weekly', prio: '0.6' }));
write('sitemap-brands.xml', urlset(seriesPages, { freq: 'weekly', prio: '0.9' }));
write('post-sitemap.xml', urlset([...blogPosts, ...newsPosts], { freq: 'weekly', prio: '0.6' }));
write('page-sitemap.xml', urlset(pages, { freq: 'monthly', prio: '0.7' }));
write('category-sitemap.xml', urlset(seriesPages.concat(`${SITE}/accessories/`), { freq: 'weekly', prio: '0.8' }));
write('tag-sitemap.xml', urlset([`${SITE}/t1-series/`, `${SITE}/t2-series/`, `${SITE}/t3-series/`, `${SITE}/blog/`, `${SITE}/accessories/`], { freq: 'weekly', prio: '0.5' }));
write('author-sitemap.xml', urlset([`${SITE}/about-us/`], { freq: 'yearly', prio: '0.3' }));
write('mobile-sitemap.xml', urlset(pages, {
  freq: 'weekly', prio: '0.8',
  extraNs: '\n        xmlns:mobile="http://www.google.com/schemas/sitemap-mobile/1.0"',
  mapUrl: () => '\n    <mobile:mobile/>',
}));
write('xhtml-sitemap.xml', urlset(pages, {
  freq: 'monthly', prio: '0.7',
  extraNs: '\n        xmlns:xhtml="http://www.w3.org/1999/xhtml"',
  mapUrl: (u) => `\n    <xhtml:link rel="alternate" hreflang="en-US" href="${esc(u)}"/>`,
}));
write('hreflang-sitemap.xml', urlset(pages, {
  freq: 'monthly', prio: '0.7',
  extraNs: '\n        xmlns:xhtml="http://www.w3.org/1999/xhtml"',
  mapUrl: (u) => `\n    <xhtml:link rel="alternate" hreflang="en" href="${esc(u)}"/>\n    <xhtml:link rel="alternate" hreflang="x-default" href="${esc(u)}"/>`,
}));
write('dynamic-sitemap.xml', urlset([...pages, ...news], { freq: 'weekly', prio: '0.7' }));
write('urllist.xml', urlset([...pages, ...news], { freq: 'weekly', prio: '0.5' }));
write('geo-sitemap.xml', urlset([`${SITE}/`, `${SITE}/contact/`, `${SITE}/about-us/`], { freq: 'monthly', prio: '0.8' }));
write('events-sitemap.xml', urlset([`${SITE}/blog/`, `${SITE}/cases/`], { freq: 'weekly', prio: '0.5' }));

// aliases required by the spec
write('news-sitemap.xml', readFileSync(join(PUB, 'sitemap-news.xml'), 'utf8'));
write('image-sitemap.xml', readFileSync(join(PUB, 'sitemap-images.xml'), 'utf8'));

/* ---- feeds ---- */
const rssItems = blogPosts.slice(0, 20).map((u) => `    <item>
      <title>${esc(titleFromUrl(u))}</title>
      <link>${esc(u)}</link>
      <guid isPermaLink="true">${esc(u)}</guid>
      <description>${esc(titleFromUrl(u))} — from the ${BRAND} blog.</description>
    </item>`).join('\n');
const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${BRAND} — Blog &amp; News</title>
    <link>${SITE}/blog/</link>
    <description>Latest news from Tara PTV Golf Carts: electric golf carts, utility vehicles, and street legal PTVs.</description>
    <language>en-us</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml"/>
${rssItems}
  </channel>
</rss>
`;
write('rss.xml', rss);
write('feed.xml', rss);
write('atom.xml', `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${BRAND} — Blog &amp; News</title>
  <link href="${SITE}/blog/"/>
  <link rel="self" href="${SITE}/atom.xml"/>
  <updated>${NOW}</updated>
  <id>${SITE}/</id>
  <author><name>${BRAND}</name><email>${EMAIL}</email></author>
${blogPosts.slice(0, 20).map((u) => `  <entry>
    <title>${esc(titleFromUrl(u))}</title>
    <link href="${esc(u)}"/>
    <id>${esc(u)}</id>
    <updated>${lastmodOf(u)}T00:00:00Z</updated>
    <summary>${esc(titleFromUrl(u))} — from the ${BRAND} blog.</summary>
  </entry>`).join('\n')}
</feed>
`);
write('podcast.xml', `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>${BRAND}</title>
    <link>${SITE}/</link>
    <language>en-us</language>
    <itunes:author>${BRAND}</itunes:author>
    <description>No podcast episodes are currently published. This feed is reserved for future ${BRAND} audio content.</description>
  </channel>
</rss>
`);

/* ---- product feeds ---- */
const products = productPages.map((u) => ({
  id: u.replace(SITE, '').replace(/\//g, '').replace(/-product$/, ''),
  title: `TARA ${titleFromUrl(u).replace(/ Product$/, '')}`,
  url: u,
}));
const feedItems = (extra) => products.map((p) => `    <item>
      <g:id>${esc(p.id)}</g:id>
      <g:title>${esc(p.title)}</g:title>
      <g:description>${esc(p.title)} — electric personal transportation vehicle from ${BRAND}. Contact ${PHONE} for current pricing and availability.</g:description>
      <g:link>${esc(p.url)}</g:link>
      <g:brand>TARA</g:brand>
      <g:condition>new</g:condition>
      <g:availability>in_stock</g:availability>
      <g:identifier_exists>no</g:identifier_exists>${extra}
    </item>`).join('\n');
const gfeed = (extra = '') => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${BRAND} Product Feed</title>
    <link>${SITE}/</link>
    <description>TARA electric golf carts, utility vehicles, and street legal PTVs available in the United States.</description>
${feedItems(extra)}
  </channel>
</rss>
`;
write('product_feed.xml', gfeed());
write('google-shopping-feed.xml', gfeed());
// No physical stores: local inventory feed intentionally has no items (feed requires registered store codes).
write('local-inventory-feed.xml', `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>${BRAND} Local Inventory Feed</title>
    <link>${SITE}/</link>
    <description>${BRAND} operates online nationwide in the United States with no physical retail stores; no local inventory items are published.</description>
  </channel>
</rss>
`);
write('data.xml', `<?xml version="1.0" encoding="UTF-8"?>
<business>
  <name>${BRAND}</name>
  <url>${SITE}</url>
  <telephone>${PHONE}</telephone>
  <email>${EMAIL}</email>
  <areaServed>United States</areaServed>
  <products>
${products.map((p) => `    <product><name>${esc(p.title)}</name><url>${esc(p.url)}</url></product>`).join('\n')}
  </products>
</business>
`);
write('api-feed.xml', `<?xml version="1.0" encoding="UTF-8"?>
<apiFeed version="1.0" generated="${NOW}">
  <business name="${esc(BRAND)}" url="${SITE}" phone="${PHONE}" email="${EMAIL}" areaServed="US"/>
  <endpoints>
    <endpoint type="sitemap" href="${SITE}/sitemap.xml"/>
    <endpoint type="products" href="${SITE}/product_feed.xml"/>
    <endpoint type="news" href="${SITE}/rss.xml"/>
    <endpoint type="llms" href="${SITE}/llms.txt"/>
  </endpoints>
</apiFeed>
`);

/* ---- location / geo data (US-wide online dealership — no physical stores) ---- */
const location = {
  name: BRAND,
  type: 'OnlineStore',
  url: SITE,
  telephone: PHONE,
  email: EMAIL,
  areaServed: 'United States',
  description: 'Independent, authorized US dealership for TARA electric golf carts, personal transportation vehicles, and utility vehicles. Serving customers nationwide.',
};
write('locations.json', JSON.stringify({ locations: [location] }, null, 2) + '\n');
write('locations.geojson', JSON.stringify({
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { name: BRAND, telephone: PHONE, url: SITE, areaServed: 'United States' },
    geometry: null, // online nationwide dealership; no physical location
  }],
}, null, 2) + '\n');
write('locations.kml', `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${BRAND}</name>
    <Placemark>
      <name>${BRAND} (nationwide US service)</name>
      <description>${esc(location.description)} Phone: ${PHONE}</description>
    </Placemark>
  </Document>
</kml>
`);
write('schema/all-locations.jsonld', JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'AutoDealer',
  name: BRAND,
  url: SITE,
  telephone: PHONE,
  email: EMAIL,
  areaServed: { '@type': 'Country', name: 'United States' },
  description: location.description,
  openingHours: 'Mo-Su 09:00-17:00',
}, null, 2) + '\n');

/* ---- sitemap index ---- */
const allSitemaps = [
  'sitemap-pages.xml', 'sitemap-news.xml', 'sitemap-images.xml', 'sitemap-blog.xml',
  'sitemap-brands.xml', 'news-sitemap.xml', 'image-sitemap.xml', 'post-sitemap.xml',
  'page-sitemap.xml', 'category-sitemap.xml', 'tag-sitemap.xml', 'author-sitemap.xml',
  'mobile-sitemap.xml', 'xhtml-sitemap.xml', 'hreflang-sitemap.xml', 'dynamic-sitemap.xml',
  'geo-sitemap.xml', 'events-sitemap.xml', 'urllist.xml',
];
write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allSitemaps.map((s) => `  <sitemap>
    <loc>${SITE}/${s}</loc>
    <lastmod>${TODAY}</lastmod>
  </sitemap>`).join('\n')}
</sitemapindex>
`);

console.log(`done: ${pages.length} pages, ${news.length} news/blog URLs, ${products.length} products`);
