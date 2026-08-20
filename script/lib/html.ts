/**
 * Shared HTML rewriting helpers used by the build scripts.
 *
 * All of these run at BUILD time over the page mirror in `content-src/`;
 * nothing here executes in the browser.
 */
import { BASE_PREFIX, CONTACT } from './config.js';

/** Attributes whose value is a URL that must honour the configured base path. */
const URL_ATTRS = [
  'href',
  'src',
  'data-src',
  'data-original',
  'data-lazy-src',
  'poster',
  'action',
];

const ATTR_RE = new RegExp(
  `\\s(${URL_ATTRS.join('|')})=(["'])(/(?!/)[^"']*)\\2`,
  'gi',
);

const SRCSET_RE = /\ssrcset=(["'])([^"']*)\1/gi;
const CSS_URL_RE = /url\(\s*(['"]?)(\/(?!\/)[^)'"]*)\1\s*\)/gi;

/** Prefix every root-absolute URL in a chunk of HTML with the base path. */
export function applyBasePath(html: string): string {
  if (!BASE_PREFIX) return html;
  let out = html.replace(ATTR_RE, (_m, attr, q, url) => ` ${attr}=${q}${BASE_PREFIX}${url}${q}`);
  out = out.replace(SRCSET_RE, (_m, q, value) => {
    const rewritten = value
      .split(',')
      .map((part: string) => {
        const trimmed = part.trim();
        if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return trimmed;
        return BASE_PREFIX + trimmed;
      })
      .join(', ');
    return ` srcset=${q}${rewritten}${q}`;
  });
  out = out.replace(CSS_URL_RE, (_m, q, url) => `url(${q}${BASE_PREFIX}${url}${q})`);
  return out;
}

/** Rewrite every legacy email address and phone number to the dealership's. */
export function applyContactDetails(html: string): string {
  let out = html;

  // mailto: links (including empty ones) → dealership inbox.
  // The lookbehind stops the pattern from firing inside a longer identifier.
  out = out.replace(/(?<![A-Za-z])mailto:[^"'?\s>]*/gi, `mailto:${CONTACT.email}`);
  // Any bare address on a taraptv.com / taragolfcart.com domain in the copy
  out = out.replace(
    /\b[A-Za-z0-9._%+-]+@(?:taraptv\.com|taragolfcart\.com|tara-ev\.com)\b/gi,
    CONTACT.email,
  );

  // Visible phone numbers in the copy. Matches 844-844-3432, (844) 844-3432,
  // 844.844.3432, +1 844 844 3432 … and normalises them all. This runs BEFORE
  // the tel: pass, which then re-normalises the hrefs it just touched.
  out = out.replace(
    /(?:\+?1[\s.\-]?)?\(?8\s?4\s?4\)?[\s.\-]?8\s?4\s?4[\s.\-]?3\s?4\s?3\s?2/g,
    CONTACT.phoneDisplay,
  );

  // tel: links → single canonical E.164 number.
  // Guarded on both sides: without the lookbehind this matched `nextEl: '…'`
  // inside the vendored jQuery bundle, and without the digit requirement it
  // matched any `…tel:` property name.
  out = out.replace(/(?<![A-Za-z])tel:\s*\+?[0-9][0-9()\-.\s]{6,}/gi, CONTACT.phoneHref);

  return out;
}

/**
 * Replace the original site's server-side search form (`/search.php`, which
 * needs PHP) with a form the static search page handles client-side.
 */
export function replaceSearchForms(html: string): string {
  return html
    .replace(/(<form[^>]*\s)action=(["'])\/search\.php\2/gi, '$1action="/search/" data-static-search="1"')
    .replace(/(<input[^>]*\sname=)(["'])(?:keywords|s|q)\2/gi, '$1"q"');
}

/** Mark every image as lazy/async-decoded. The optimiser later adds the
 *  intrinsic width/height and the responsive srcset. */
export function markLazyImages(html: string): string {
  return html.replace(/<img\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi, (_m, attrs: string) => {
    // Drop the XHTML self-closing slash so appended attributes land inside
    // the tag rather than after it.
    let a = attrs.replace(/\s*\/\s*$/, '');
    if (!/\bloading=/i.test(a)) a += ' loading="lazy"';
    if (!/\bdecoding=/i.test(a)) a += ' decoding="async"';
    return `<img${a}>`;
  });
}

/**
 * Markup the client asked to have deleted site-wide. It is stripped again
 * here so a stale mirror file can never reintroduce it.
 */
const FORBIDDEN = [
  { name: 'mautic form', re: /<div[^>]*class=["'][^"']*mauticform[\s\S]*?<\/div>\s*<\/div>/gi },
  { name: 'inquiry-form-wrap', re: /<section class="inquiry-form-wrap"[\s\S]*?<\/section>/gi },
  { name: 'right_nav', re: /<ul class="right_nav"[\s\S]*?<\/ul>/gi },
  { name: 'inquiry-pop-bd', re: /<div class="inquiry-pop-bd"[\s\S]*?<\/div>\s*<\/div>/gi },
  { name: 'whatsapp widget', re: /<div[^>]*id=["']whatsapp(?:Main)?["'][\s\S]*?<\/div>/gi },
  { name: 'legacy web-footer', re: /<footer class="web-footer"[\s\S]*?<\/footer>/gi },
];

export function stripForbidden(html: string): { html: string; removed: string[] } {
  let out = html;
  const removed: string[] = [];
  for (const { name, re } of FORBIDDEN) {
    if (re.test(out)) {
      removed.push(name);
      out = out.replace(re, '');
    }
    re.lastIndex = 0;
  }
  return { html: out, removed };
}

/**
 * The mirror still carries absolute self-links (https://www.taraptv.com/…).
 * Turn them into base-path-relative links so they keep working under a
 * project-site BASE_PATH and never leave the deployed origin.
 */
export function relativizeSelfLinks(html: string): string {
  return html.replace(/https?:\/\/(?:www\.)?tara(?:ptv|golfcart)\.com(?=[/"'\s>])/gi, '');
}

/** Crude but sufficient tag-stripper for building the search index. */
export function toPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function escHtml(str: unknown): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function escXml(str: unknown): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
