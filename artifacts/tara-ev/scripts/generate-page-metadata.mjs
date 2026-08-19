#!/usr/bin/env node
/**
 * Refresh route metadata from each page's visible heading, copy, and imagery.
 *
 * The generated routes.json is the single source of truth used by:
 * - the React runtime during client-side navigation
 * - Vite's development HTML middleware
 * - the production pre-renderer
 *
 * Run after adding or materially rewriting content:
 *   node scripts/generate-page-metadata.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const artifactDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentDir = path.join(artifactDir, 'public', 'content');
const routesPath = path.join(contentDir, 'routes.json');
const checkMode = process.argv.includes('--check');
const BRAND = 'TARA Personal Transportation Vehicles';
const FALLBACK_IMAGE = '/images/og-image.png';
const HOME_TITLE = 'TARA Personal Transportation Vehicles';
const HOME_DESCRIPTION =
  'Lithium-powered personal transportation vehicles designed for neighborhoods, golf courses, resorts, and communities.';

const namedEntities = {
  amp: '&',
  apos: "'",
  gt: '>',
  hellip: '…',
  laquo: '“',
  ldquo: '“',
  lsquo: '‘',
  lt: '<',
  mdash: '—',
  middot: '·',
  nbsp: ' ',
  ndash: '–',
  quot: '"',
  raquo: '”',
  rdquo: '”',
  rsquo: '’',
};

function decodeEntities(value) {
  return String(value)
    .replace(/&#(\d+);/g, (_match, value) =>
      String.fromCodePoint(Number.parseInt(value, 10)),
    )
    .replace(/&#x([\da-f]+);/gi, (_match, value) =>
      String.fromCodePoint(Number.parseInt(value, 16)),
    )
    .replace(/&([a-z]+);/gi, (match, name) => namedEntities[name.toLowerCase()] ?? match);
}

function plainText(value) {
  return decodeEntities(
    String(value)
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/([’'])\s+s\b/g, '$1s')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanHeading(value) {
  const preserveUppercase = new Set([
    'EEC',
    'EZGO',
    'FAQs',
    'GCSAA',
    'GPS',
    'HARMONY',
    'LSV',
    'PGA',
    'PTV',
    'TARA',
    'TURFMAN',
  ]);
  const heading = plainText(value)
    .replace(/\s+([?!:;,.])/g, '$1')
    .replace(/\bSatety\b/gi, 'Safety')
    .replace(/\bMainitenance\b/gi, 'Maintenance')
    .replace(/\bTechncal\b/gi, 'Technical')
    .replace(/\bVarranty\b/gi, 'Warranty')
    .replace(/\bLifeted\b/gi, 'Lifted')
    .replace(/\bTransportion\b/gi, 'Transportation')
    .replace(/\b[A-Z]{4,}\b/g, (word) =>
      preserveUppercase.has(word)
        ? word
        : `${word.charAt(0)}${word.slice(1).toLowerCase()}`,
    )
    .replace(/\s*[|–—-]\s*TARA(?:\s+Personal Transportation Vehicles)?$/i, '');
  if (!heading) return BRAND;
  if (heading === heading.toUpperCase() && /[A-Z]/.test(heading)) {
    return heading
      .toLowerCase()
      .replace(/\b\p{L}/gu, (letter) => letter.toUpperCase())
      .replace(/\bPtv\b/g, 'PTV')
      .replace(/\bFaqs\b/g, 'FAQs')
      .replace(/\bGps\b/g, 'GPS')
      .replace(/\bEec\b/g, 'EEC');
  }
  return heading;
}

function extractHeading(html, routePath, currentTitle) {
  const catalogRoot = routePath.match(/^\/news_catalog\/(news|industry|company)\/$/);
  if (catalogRoot) {
    const labels = {
      company: 'TARA PTV Company News',
      industry: 'TARA PTV Industry News',
      news: 'TARA PTV News Articles',
    };
    return labels[catalogRoot[1]];
  }
  const newsPagination = routePath.match(/^\/news\/page\/(\d+)\/$/);
  if (newsPagination) return `TARA PTV News — Page ${newsPagination[1]}`;
  const categoryPagination = routePath.match(
    /^\/news_catalog\/(news|industry|company)\/page\/(\d+)\/$/,
  );
  if (categoryPagination) {
    const category = {
      company: 'Company',
      industry: 'Industry',
      news: 'News Articles',
    }[categoryPagination[1]];
    return `TARA PTV ${category} — Page ${categoryPagination[2]}`;
  }

  for (const level of [1, 2]) {
    for (const match of html.matchAll(new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)<\\/h${level}>`, 'gi'))) {
      const heading = cleanHeading(match[1]).replace(/\.$/, '');
      if (!heading) continue;
      if (
        routePath === '/technical-support/' &&
        /^Frequently Asked Questions$/i.test(heading)
      ) {
        return 'Technical Support FAQs';
      }
      return heading;
    }
  }

  return cleanHeading(currentTitle);
}

function buildTitle(routePath, heading) {
  if (routePath === '/') return HOME_TITLE;
  if (heading.toLowerCase().includes('tara personal transportation vehicles')) {
    return heading;
  }
  const longBrandTitle = `${heading} | ${BRAND}`;
  return longBrandTitle.length <= 68 ? longBrandTitle : `${heading} | TARA PTV`;
}

function contentRegion(html) {
  let region = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, ' ')
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, ' ')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' ');

  const mainMatch = region.match(/<(?:main|section)\b[^>]*class=["'][^"']*\bmain\b[^"']*["'][^>]*>([\s\S]*)/i);
  if (mainMatch) region = mainMatch[1];
  return region;
}

function extractParagraphs(html) {
  const region = contentRegion(html);
  const paragraphs = [];

  for (const match of region.matchAll(/<(?:p|div)\b[^>]*>([\s\S]*?)<\/(?:p|div)>/gi)) {
    const text = plainText(match[1])
      .replace(/^(?:Home|News|Blog)\b(?:\s*\/\s*)?/i, '')
      .replace(/\s*\bby admin on \d{2}-\d{2}-\d{2}\b/gi, ' ')
      .replace(/\s+As a professional manufacturer\b[\s\S]*$/i, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length < 45) continue;
    if (/^(?:copyright|all rights reserved|follow us|contact us|read more)/i.test(text)) {
      continue;
    }
    if (/0% financing options for up to 36 months/i.test(text)) continue;
    if (/^A TARA Personal Transportation Vehicle \(PTV\) is more than a golf cart/i.test(text)) {
      continue;
    }
    paragraphs.push(text);
  }

  return [...new Set(paragraphs)];
}

function truncateDescription(value, maxLength = 158) {
  const clean = value
    .replace(/\s+/g, ' ')
    .replace(/\s+([?!:;,.])/g, '$1')
    .trim();
  if (clean.length <= maxLength) return clean;
  const candidate = clean.slice(0, maxLength - 1);
  const lastBoundary = Math.max(
    candidate.lastIndexOf('. '),
    candidate.lastIndexOf('? '),
    candidate.lastIndexOf('! '),
  );
  if (lastBoundary >= 105) return candidate.slice(0, lastBoundary + 1);
  const lastSpace = candidate.lastIndexOf(' ');
  return `${candidate.slice(0, lastSpace > 105 ? lastSpace : maxLength - 1).replace(/[,:;–—-]+$/, '')}…`;
}

function extractDescription(html, heading, routePath) {
  if (routePath === '/') return HOME_DESCRIPTION;

  const paragraphs = extractParagraphs(html);
  const paragraph = paragraphs[0] ?? `Explore ${heading} from ${BRAND}.`;
  const normalizedHeading = heading.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const normalizedParagraph = paragraph.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const headingWords = normalizedHeading
    .split(' ')
    .filter((word) => word.length > 3 && !['tara', 'with', 'from', 'what', 'your'].includes(word))
    .slice(0, 2);
  const paragraphIncludesHeading =
    headingWords.length > 0 && headingWords.every((word) => normalizedParagraph.includes(word));

  let description = paragraphIncludesHeading
    ? paragraph
    : `${heading}${/[.!?]$/.test(heading) ? '' : '.'} ${paragraph}`;

  if (description.length < 105) {
    description += ` Learn more from ${BRAND}.`;
  }
  return truncateDescription(description);
}

function extractImage(html, routePath) {
  if (routePath === '/') return FALLBACK_IMAGE;

  const region = contentRegion(html);
  const skip = /(?:logo|favicon|menu-image|single_icon|banner_\d+_icon|loading|spinner|arrow|avatar|qrcode|qr-code|placeholder|\/block\.)/i;

  for (const match of region.matchAll(/<img\b[^>]*\bsrc=["']([^"']+\.(?:avif|webp|jpe?g|png))["'][^>]*>/gi)) {
    const [tag, source] = match;
    if (skip.test(tag) || skip.test(source)) continue;
    if (source.startsWith('/images/') || source.startsWith('/uploads/')) {
      return source;
    }
  }

  return FALLBACK_IMAGE;
}

function ensureUniqueMetadata(routes) {
  const titleCounts = new Map();
  const descriptionCounts = new Map();

  for (const [routePath, route] of Object.entries(routes)) {
    if (!route.file) continue;
    const titleKey = route.title.toLowerCase();
    const titleCount = titleCounts.get(titleKey) ?? 0;
    titleCounts.set(titleKey, titleCount + 1);
    if (titleCount > 0) {
      const label = routePath
        .replace(/^\/|\/$/g, '')
        .split('/')
        .pop()
        .replace(/-product$/, ' product details')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
      route.title = `${route.title.replace(/\s+\|\s+TARA(?: PTV| Personal Transportation Vehicles)?$/i, '')} — ${label} | TARA PTV`;
    }

    const descriptionKey = route.description.toLowerCase();
    const descriptionCount = descriptionCounts.get(descriptionKey) ?? 0;
    descriptionCounts.set(descriptionKey, descriptionCount + 1);
    if (descriptionCount > 0) {
      route.description = truncateDescription(
        `${route.description.replace(/[.…]+$/, '')} View page ${descriptionCount + 1} on TARA PTV.`,
      );
    }
  }
}

function validateMetadata(routes) {
  const errors = [];
  const pages = Object.entries(routes).filter(([, route]) => route.file);
  const seenTitles = new Map();
  const seenDescriptions = new Map();
  const danglingTitle = /\b(?:a|an|and|as|at|by|for|from|in|of|on|or|the|to|with|where)$/i;
  const misspelling = /\b(?:Satety|Mainitenance|Techncal|Varranty|Lifeted|Transportion)\b/i;

  for (const [routePath, route] of pages) {
    for (const field of ['title', 'description', 'image', 'imageAlt']) {
      if (!route[field]?.trim()) errors.push(`${routePath}: missing ${field}`);
    }

    const contentPath = path.join(contentDir, route.file);
    if (!fs.existsSync(contentPath)) {
      errors.push(`${routePath}: missing content file ${route.file}`);
    }
    if (route.image?.startsWith('/')) {
      const imagePath = path.join(artifactDir, 'public', route.image.replace(/^\//, ''));
      if (!fs.existsSync(imagePath)) errors.push(`${routePath}: missing image ${route.image}`);
    }

    const titleKey = route.title.toLowerCase();
    if (seenTitles.has(titleKey)) {
      errors.push(`${routePath}: duplicate title with ${seenTitles.get(titleKey)}`);
    }
    seenTitles.set(titleKey, routePath);

    const descriptionKey = route.description.toLowerCase();
    if (seenDescriptions.has(descriptionKey)) {
      errors.push(
        `${routePath}: duplicate description with ${seenDescriptions.get(descriptionKey)}`,
      );
    }
    seenDescriptions.set(descriptionKey, routePath);

    const titleCore = route.title
      .replace(/\s+\|\s+TARA(?: PTV| Personal Transportation Vehicles)?$/i, '')
      .trim();
    if (danglingTitle.test(titleCore)) {
      errors.push(`${routePath}: title ends with a dangling word: "${route.title}"`);
    }
    if (misspelling.test(`${route.title} ${route.description} ${route.imageAlt}`)) {
      errors.push(`${routePath}: metadata contains a known spelling error`);
    }
  }

  const home = routes['/'];
  if (home?.title !== HOME_TITLE) errors.push('/: homepage title does not match');
  if (home?.description !== HOME_DESCRIPTION) {
    errors.push('/: homepage description does not match');
  }
  if (home?.image !== FALLBACK_IMAGE) errors.push('/: homepage image does not match');

  if (errors.length) {
    throw new Error(`Metadata validation failed:\n- ${errors.join('\n- ')}`);
  }

  return pages.length;
}

function registerNewsRoutes(routes) {
  routes['/news/'] ??= {
    file: 'news.html',
    title: 'TARA PTV News',
    description: '',
    bodyClass: '',
  };

  for (const file of fs.readdirSync(contentDir)) {
    const pagination = file.match(/^news__page__(\d+)\.html$/);
    if (pagination) {
      const pageNumber = pagination[1];
      const legacyPath = `/news/page__${pageNumber}/`;
      const canonicalPath = `/news/page/${pageNumber}/`;
      const legacyRoute = routes[legacyPath];
      routes[canonicalPath] = {
        file,
        title: legacyRoute?.title ?? `TARA PTV News — Page ${pageNumber}`,
        description: legacyRoute?.description ?? '',
        bodyClass: legacyRoute?.bodyClass ?? '',
      };
      routes[legacyPath] = { redirect: canonicalPath };
      continue;
    }

    const catalog = file.match(
      /^news_catalog__(news|industry|company)(?:__page__(\d+))?\.html$/,
    );
    if (!catalog) continue;
    const [, category, pageNumber] = catalog;
    const categoryLabel = category.charAt(0).toUpperCase() + category.slice(1);
    const routePath = pageNumber
      ? `/news_catalog/${category}/page/${pageNumber}/`
      : `/news_catalog/${category}/`;
    routes[routePath] ??= {
      file,
      title: pageNumber
        ? `TARA PTV ${categoryLabel} — Page ${pageNumber}`
        : `${categoryLabel} | TARA PTV`,
      description: '',
      bodyClass: '',
    };
  }

  routes[
    '/news/a-complete-analysis-of-lsvs-what-are-low-speed-%e2%80%8b%e2%80%8bvehicles/'
  ] = {
    redirect:
      '/news/a-complete-analysis-of-lsvs-what-are-low-speed-%E2%80%8B%E2%80%8Bvehicles/',
  };
  routes[
    '/news/golf-course-a-deep-dive-into-design-experience-and-nationwide-rankings/'
  ] = {
    redirect:
      '/news/golf-course-a-deep-dive-into-design-experience-and-global-rankings/',
  };
  routes[
    '/news/tournament-season-starts-with-the-fleet/golf-cart-fleet-during-tournament-season/'
  ] = {
    redirect: '/news/tournament-season-starts-with-the-fleet/',
  };
}

function main() {
  const original = fs.readFileSync(routesPath, 'utf8');
  const routes = JSON.parse(original);
  registerNewsRoutes(routes);
  let updated = 0;

  for (const [routePath, route] of Object.entries(routes)) {
    if (!route.file) continue;
    const contentPath = path.join(contentDir, route.file);
    if (!fs.existsSync(contentPath)) {
      throw new Error(`Missing content for ${routePath}: ${route.file}`);
    }

    const html = fs.readFileSync(contentPath, 'utf8');
    const heading = extractHeading(html, routePath, route.title);
    route.title = buildTitle(routePath, heading);
    route.description = extractDescription(html, heading, routePath);
    route.image = extractImage(html, routePath);
    route.imageAlt = routePath === '/' ? 'TARA PTV icon' : `${heading} — TARA PTV`;
    updated++;
  }

  ensureUniqueMetadata(routes);
  const validated = validateMetadata(routes);
  const output = `${JSON.stringify(routes, null, 2)}\n`;

  if (checkMode) {
    if (output !== original) {
      throw new Error(
        'Page metadata is stale or generation is not idempotent. Run "pnpm run metadata:generate".',
      );
    }
    console.log(`Validated metadata for ${validated} pages; generation is idempotent.`);
    return;
  }

  fs.writeFileSync(routesPath, output);
  console.log(`Updated and validated metadata for ${updated} pages in ${routesPath}`);
}

main();