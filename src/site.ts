/**
 * Access to the build-time snapshot.
 *
 * Nothing here talks to an API. Prerendered pages carry their route metadata
 * and site config inline on `window.__TARA__`, so a normal page view makes
 * ZERO network requests for data. The fetch paths below only run on the
 * GitHub Pages 404 fallback (a deep link to a route that was not prerendered)
 * and for client-side navigation.
 */

export const BASE = import.meta.env.BASE_URL;

export type RouteMeta = {
  file: string;
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  bodyClass: string;
};
export type RouteRedirect = { redirect: string };
export type RouteEntry = RouteMeta | RouteRedirect;
export type Routes = Record<string, RouteEntry>;

export type SiteConfig = {
  name: string;
  domain: string;
  base: string;
  email: string;
  phone: string;
  phoneHref: string;
  logo: string;
  formEndpoint: string;
};

declare global {
  interface Window {
    __TARA__?: { path: string; route: RouteMeta; site: SiteConfig };
  }
}

/** Contact details, inlined at build time with a safe hard-coded default. */
export const SITE: SiteConfig = window.__TARA__?.site ?? {
  name: 'TARA Personal Transportation Vehicles',
  domain: 'taraptv.com',
  base: BASE,
  email: 'taradealership@gmail.com',
  phone: '1-844-844-3432',
  phoneHref: 'tel:+18448443432',
  logo: '/images/tara-ptv-logo.png',
  formEndpoint: '',
};

export const isRedirect = (e: RouteEntry): e is RouteRedirect => 'redirect' in e;

/**
 * Prefix a root-absolute site path with the deployed base path.
 * Idempotent: values coming out of the snapshot are already base-qualified,
 * so prefixing them a second time would produce "/repo/repo/…".
 */
export function url(p: string): string {
  if (/^(https?:|mailto:|tel:|data:|#)/.test(p)) return p;
  const prefix = BASE.replace(/\/$/, '');
  if (prefix && (p === prefix || p.startsWith(prefix + '/'))) return p;
  return prefix + (p.startsWith('/') ? p : '/' + p);
}

/** Strip the base path off a browser pathname and normalise the trailing slash. */
export function normalizePath(p: string): string {
  const prefix = BASE.replace(/\/$/, '');
  let path = p;
  if (prefix && path.startsWith(prefix)) path = path.slice(prefix.length) || '/';
  if (!path.startsWith('/')) path = '/' + path;
  if (path !== '/' && !path.endsWith('/') && !path.includes('.')) path += '/';
  return path;
}

let routesPromise: Promise<Routes> | null = null;

/** The route table, loaded once from the static snapshot. */
export function loadRoutes(): Promise<Routes> {
  routesPromise ??= fetch(`${BASE}data/routes.json`).then((r) => {
    if (!r.ok) throw new Error(`routes.json: HTTP ${r.status}`);
    return r.json() as Promise<Routes>;
  });
  return routesPromise;
}

/** Tolerates percent-encoding case differences between links and route keys. */
export function lookupRoute(routes: Routes, path: string): RouteEntry | null {
  if (routes[path]) return routes[path];
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    decoded = path;
  }
  for (const key of Object.keys(routes)) {
    try {
      if (decodeURIComponent(key) === decoded) return routes[key];
    } catch {
      /* skip malformed keys */
    }
  }
  return null;
}
