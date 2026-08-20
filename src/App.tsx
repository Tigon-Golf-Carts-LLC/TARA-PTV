import { useEffect, useState } from 'react';

import { injectStructuredData } from './structuredData';
import {
  BASE,
  SITE,
  type RouteMeta,
  isRedirect,
  loadRoutes,
  lookupRoute,
  normalizePath,
  url,
} from './site';

const SITE_ORIGIN = `https://${SITE.domain}`;

/** Wire the product colour list to the vehicle image slides (one per colour). */
function initProductColorPicker(root: HTMLElement) {
  const slides = root.querySelectorAll<HTMLElement>('.pro_img .swiper-slide');
  const colors = root.querySelectorAll<HTMLElement>('.pro_color li');
  if (slides.length === 0) return;

  const select = (idx: number) => {
    slides.forEach((s, i) => s.classList.toggle('color-active', i === idx));
    colors.forEach((c, i) => c.classList.toggle('color-active', i === idx));
  };
  select(0);
  colors.forEach((li, i) => li.addEventListener('click', () => select(i)));
}

/** Per-route <head> tags. Prerendered pages already carry these; this keeps
 *  them correct after a client-side navigation. */
function applyHead(path: string, meta: RouteMeta) {
  document.title = meta.title;
  injectStructuredData(path, meta.title);

  const canonicalUrl = `${SITE_ORIGIN}${url(path)}`;
  const imageUrl = meta.image.startsWith('http') ? meta.image : `${SITE_ORIGIN}${meta.image}`;

  const setMeta = (attribute: 'name' | 'property', key: string, content: string) => {
    const selector = `meta[${attribute}="${key}"]`;
    let element = document.querySelector<HTMLMetaElement>(selector);
    if (!element) {
      element = document.createElement('meta');
      element.setAttribute(attribute, key);
      document.head.appendChild(element);
    }
    element.setAttribute('content', content);
  };

  let canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.setAttribute('rel', 'canonical');
    document.head.appendChild(canonical);
  }
  canonical.setAttribute('href', canonicalUrl);

  setMeta('name', 'title', meta.title);
  setMeta('name', 'description', meta.description);
  setMeta('name', 'image', imageUrl);
  setMeta('property', 'og:title', meta.title);
  setMeta('property', 'og:description', meta.description);
  setMeta('property', 'og:image', imageUrl);
  setMeta('property', 'og:image:alt', meta.imageAlt);
  setMeta('property', 'og:url', canonicalUrl);
  setMeta('name', 'twitter:title', meta.title);
  setMeta('name', 'twitter:description', meta.description);
  setMeta('name', 'twitter:image', imageUrl);
  setMeta('name', 'twitter:image:alt', meta.imageAlt);
}

const FINANCING_CTA = `
  <div class="tfc-inner">
    <div class="tfc-rate">
      <span class="tfc-rate-num">0<sup>%</sup></span>
      <span class="tfc-rate-label">APR Financing</span>
    </div>
    <div class="tfc-copy">
      <p class="tfc-kicker">&#9733; Limited-Time Offer</p>
      <h2 class="tfc-title">0% Financing on TARA PTV Golf Carts</h2>
      <p class="tfc-sub">Drive home your TARA today &mdash; 0% financing options for up to <strong>36 months</strong>.</p>
    </div>
    <div class="tfc-action">
      <a class="tfc-button" href="${url('/financing/')}">Get 0% Financing &#8594;</a>
      <span class="tfc-note">On approved credit</span>
    </div>
  </div>`;

const FOOTER_LINKS: Array<[string, Array<[string, string]>]> = [
  [
    'Vehicles',
    [
      ['/t1-series/', 'T1 Golf Cart PTV Series'],
      ['/t2-series/', 'T2 Utility Golf Cart PTV Series'],
      ['/t3-series/', 'T3 Street Legal PTV Series'],
      ['/fleet-golf-carts/', 'Fleet Golf Carts'],
      ['/accessories/', 'Accessories'],
    ],
  ],
  [
    'Popular Models',
    [
      ['/harmony-fleet-golf-cart-product/', 'Harmony'],
      ['/spirit-pro-fleet-golf-cart-product/', 'Spirit Pro'],
      ['/spirit-plus-fleet-golf-cart-product/', 'Spirit Plus'],
      ['/roadster-2-2-golf-cart-product/', 'Roadster 2+2'],
      ['/explorer-2-2-golf-cart-product/', 'Explorer 2+2'],
      ['/turfman-700-utility-vehicle-product/', 'Turfman 700'],
      ['/t3-2-2-golf-cart-product/', 'T3 2+2'],
    ],
  ],
  [
    'Support',
    [
      ['/technical-support/', 'Technical Support'],
      ['/maintenance-support/', 'Maintenance'],
      ['/warranty-terms/', 'Warranty Terms'],
      ['/safety-information/', 'Safety Information'],
      ['/recall-information/', 'Recall Information'],
      ['/emergency-response-guides/', 'Emergency Guides'],
      ['/faqs/', 'FAQs'],
      ['/financing/', 'Financing'],
    ],
  ],
  [
    'Company',
    [
      ['/', 'Home'],
      ['/about-us/', 'About Us'],
      ['/cases/', 'Customer Cases'],
      ['/blog/', 'Blog'],
      ['/contact/', 'Contact'],
      ['/search/', 'Search'],
    ],
  ],
];

function footerHtml(): string {
  const columns = FOOTER_LINKS.map(
    ([heading, links]) =>
      `<div class="tf-col"><h4>${heading}</h4>` +
      links.map(([href, label]) => `<a href="${url(href)}">${label}</a>`).join('') +
      `</div>`,
  ).join('');

  return `
    <div class="tf-inner">
      <div class="tf-col tf-brand">
        <img src="${url(SITE.logo)}" alt="TARA Personal Transportation Vehicles"
             width="240" height="80" loading="lazy" decoding="async" />
        <p>TARA Personal Transportation Vehicles &mdash; sales, service, and support for electric golf carts, PTVs, and utility vehicles.</p>
        <p class="tf-disclaimer">We are an independent, authorized dealership selling TARA vehicles. We are not TARA, the manufacturer.</p>
        <a class="tf-phone" href="${SITE.phoneHref}">&#9742; ${SITE.phone}</a>
        <a class="tf-email" href="mailto:${SITE.email}">&#9993; ${SITE.email}</a>
      </div>
      ${columns}
    </div>
    <div class="tf-bottom">
      <span>&copy; ${new Date().getFullYear()} <a href="https://tigongolfcarts.com/tara-ev" target="_blank" rel="sponsored noopener noreferrer">TARA Personal Transportation Vehicles</a>. All rights reserved.</span>
      <span class="tf-legal">
        <a href="${url('/privacy-policy/')}">Privacy Policy</a>
        <a href="${url('/terms-and-conditions/')}">Terms &amp; Conditions</a>
      </span>
    </div>`;
}

/** Site chrome that is appended to every page: financing CTA, footer, call button. */
function decorate(container: HTMLElement) {
  if (!container.querySelector('#tara-financing-cta')) {
    const cta = document.createElement('section');
    cta.id = 'tara-financing-cta';
    cta.innerHTML = FINANCING_CTA;
    container.appendChild(cta);
  }

  if (!container.querySelector('#tara-footer')) {
    const footer = document.createElement('footer');
    footer.id = 'tara-footer';
    footer.innerHTML = footerHtml();
    container.appendChild(footer);
  }

  if (!document.getElementById('tara-call-now')) {
    const call = document.createElement('a');
    call.id = 'tara-call-now';
    call.href = SITE.phoneHref;
    call.innerHTML = '<span class="call-icon">&#9742;</span> Call Now';
    call.setAttribute('aria-label', `Call TARA at ${SITE.phone}`);
    document.body.appendChild(call);
  }
}

/** Re-run the cloned theme's jQuery behaviour (menus, sliders, tabs). */
function runThemeScripts(container: HTMLElement) {
  const siteScript = document.createElement('script');
  siteScript.src = `${BASE}js/jquery.min_index.js`;
  siteScript.async = false;
  siteScript.onload = () => {
    // The theme binds on DOMContentLoaded / load, both of which fired before
    // the page content existed — replay them once the bundle is ready.
    document.dispatchEvent(new Event('DOMContentLoaded'));
    window.dispatchEvent(new Event('load'));
  };
  document.body.appendChild(siteScript);

  if (document.getElementById('fin-price')) {
    const finScript = document.createElement('script');
    finScript.src = `${BASE}js/financing.js`;
    document.body.appendChild(finScript);
  }

  initProductColorPicker(container);
  // Route-level code split: the search module is only pulled in when a page
  // actually carries the theme's search box.
  if (container.querySelector('form[data-static-search]')) {
    void import('./search').then((m) => m.wireSearchForms(container));
  }
}

/** Mount the static contact form wherever the page asks for it. */
function mountContactForm(container: HTMLElement, path: string) {
  let mount = container.querySelector<HTMLElement>('#tara-inquiry-form');
  if (!mount && path === '/contact/') {
    mount = document.createElement('div');
    mount.id = 'tara-inquiry-form';
    const article = container.querySelector('article') ?? container.firstElementChild;
    article?.appendChild(mount);
  }
  // Route-level code split: the form module only ships to pages that use it.
  if (mount) void import('./contactForm').then((m) => m.renderContactForm(mount!));
}

/**
 * The page markup lives in `#page`, OUTSIDE the React root, so that the HTML
 * written by the prerenderer survives React mounting. React itself only owns
 * the small status / not-found UI in `#root`.
 */
function pageContainer(): HTMLElement {
  let el = document.getElementById('page');
  if (!el) {
    el = document.createElement('div');
    el.id = 'page';
    document.body.insertBefore(el, document.getElementById('root'));
  }
  return el;
}

export default function App() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'notfound'>(
    window.__TARA__ ? 'ready' : 'loading',
  );

  useEffect(() => {
    let cancelled = false;
    const container = pageContainer();

    function activate(path: string, meta: RouteMeta) {
      applyHead(path, meta);
      if (meta.bodyClass) document.body.className = meta.bodyClass;
      decorate(container);
      mountContactForm(container, path);
      runThemeScripts(container);
      setStatus('ready');
    }

    async function load() {
      const path = normalizePath(window.location.pathname);

      // 1. Prerendered page: the HTML and its metadata are already here.
      //    No fetch of any kind is issued.
      const inlined = window.__TARA__;
      if (inlined && inlined.path === path) {
        activate(path, inlined.route);
        return;
      }

      // 2. Static search page — rendered entirely client-side.
      if (path === '/search/') {
        const q = new URLSearchParams(window.location.search).get('q') ?? '';
        const { renderSearchPage } = await import('./search');
        await renderSearchPage(container, q);
        document.title = q ? `Search: ${q} | ${SITE.name}` : `Search | ${SITE.name}`;
        decorate(container);
        setStatus('ready');
        return;
      }

      // 3. Fallback (404.html serving a deep link): resolve from the snapshot.
      try {
        const routes = await loadRoutes();
        const entry = lookupRoute(routes, path);
        if (!entry) {
          if (!cancelled) setStatus('notfound');
          return;
        }
        if (isRedirect(entry)) {
          window.location.replace(url(entry.redirect));
          return;
        }
        const res = await fetch(`${BASE}content/${encodeURIComponent(entry.file)}`);
        if (!res.ok) {
          if (!cancelled) setStatus('notfound');
          return;
        }
        const html = await res.text();
        if (cancelled) return;
        container.innerHTML = html;
        activate(path, entry);
      } catch (err) {
        console.error(err);
        if (!cancelled) setStatus('notfound');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      {status === 'loading' && (
        <div style={{ padding: '80px 20px', textAlign: 'center' }}>Loading…</div>
      )}
      {status === 'notfound' && (
        <div className="tara-404" style={{ padding: '80px 20px', textAlign: 'center' }}>
          <h1>Page not found</h1>
          <p>We couldn&rsquo;t find that page.</p>
          <p>
            <a href={url('/')}>Back to the home page</a> &middot;{' '}
            <a href={url('/search/')}>Search the site</a> &middot;{' '}
            <a href={SITE.phoneHref}>Call {SITE.phone}</a>
          </p>
        </div>
      )}
    </>
  );
}
