import path from 'path';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import type { Plugin, ViteDevServer } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? '/';
const canonicalOrigin = 'https://taraptv.com';

const DEV_REDIRECTS: Record<string, string> = {
  // Percent-encoding case duplicate: lowercase hex → uppercase canonical.
  // Matched against the raw request URL before any decoding.
  '/news/a-complete-analysis-of-lsvs-what-are-low-speed-%e2%80%8b%e2%80%8bvehicles/':
    '/news/a-complete-analysis-of-lsvs-what-are-low-speed-%E2%80%8B%E2%80%8Bvehicles/',
  '/explorer-2-2-product/': '/explorer-2-2-golf-cart-product/',
  '/horizon-4-product/': '/horizon-4-golf-cart-product/',
  '/horizon-6-product/': '/horizon-6-golf-cart-product/',
  '/lander-4-product/': '/lander-4-golf-cart-product/',
  '/lander-6-product/': '/lander-6-golf-cart-product/',
  '/spirit-plus-product/': '/spirit-plus-fleet-golf-cart-product/',
  '/t3-2-2-product/': '/t3-2-2-golf-cart-product/',
  '/t3-22-product/': '/t3-2-2-golf-cart-product/',
  '/t3-2-2-lifted-product/': '/t3-2-2-lifted-golf-cart-product/',
  '/t3-22-lifted-product/': '/t3-2-2-lifted-golf-cart-product/',
  '/varranty-terms/': '/warranty-terms/',
  '/mainitenance-support/': '/maintenance-support/',
  '/techncal-support/': '/technical-support/',
};
const absoluteOgUrls = () => ({
  name: 'absolute-og-urls',
  apply: 'build' as const,
  transformIndexHtml(html: string) {
    return html.replace(
      /(<meta\s+property="og:(?:image|url)"\s+content=")(\/[^"]*)(")/g,
      (_m, pre, path, post) => `${pre}${canonicalOrigin}${path}${post}`,
    );
  },
});

// ─── Per-route metadata helpers (shared by dev middleware + prerender) ─────────

function escHtml(str: string) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function injectRouteMeta(
  shellHtml: string,
  routePath: string,
  routeMeta: RouteMeta,
  contentHtml: string,
  origin: string,
): string {
  const canonicalUrl = `${origin}${routePath}`;
  const absoluteImage = routeMeta.image.startsWith('http')
    ? routeMeta.image
    : `${origin}${routeMeta.image}`;

  let html = shellHtml;
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escHtml(routeMeta.title)}</title>`);
  html = html.replace(
    /<meta\s+name="title"[^>]*\/?>/i,
    `<meta name="title" content="${escHtml(routeMeta.title)}" />`,
  );
  html = html.replace(
    /<meta\s+name="description"[^>]*\/?>/i,
    `<meta name="description" content="${escHtml(routeMeta.description)}" />`,
  );
  html = html.replace(
    /<meta\s+name="image"[^>]*\/?>/i,
    `<meta name="image" content="${absoluteImage}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:title"[^>]*\/?>/i,
    `<meta property="og:title" content="${escHtml(routeMeta.title)}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:description"[^>]*\/?>/i,
    `<meta property="og:description" content="${escHtml(routeMeta.description)}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:image"[^>]*\/?>/i,
    `<meta property="og:image" content="${absoluteImage}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:image:alt"[^>]*\/?>/i,
    `<meta property="og:image:alt" content="${escHtml(routeMeta.imageAlt)}" />`,
  );
  html = html.replace(
    /<meta\s+name="twitter:title"[^>]*\/?>/i,
    `<meta name="twitter:title" content="${escHtml(routeMeta.title)}" />`,
  );
  html = html.replace(
    /<meta\s+name="twitter:description"[^>]*\/?>/i,
    `<meta name="twitter:description" content="${escHtml(routeMeta.description)}" />`,
  );
  html = html.replace(
    /<meta\s+name="twitter:image"[^>]*\/?>/i,
    `<meta name="twitter:image" content="${absoluteImage}" />`,
  );
  html = html.replace(
    /<meta\s+name="twitter:image:alt"[^>]*\/?>/i,
    `<meta name="twitter:image:alt" content="${escHtml(routeMeta.imageAlt)}" />`,
  );
  html = html.replace(
    /<link\s+rel="canonical"[^>]*\/?>/i,
    `<link rel="canonical" href="${canonicalUrl}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:url"[^>]*\/?>/i,
    `<meta property="og:url" content="${canonicalUrl}" />`,
  );
  // Embed page content for crawlers
  html = html.replace(
    '<div id="root"></div>',
    `<div id="root" data-prerendered="1">${contentHtml}</div>`,
  );
  return html;
}

// ─── Dev middleware: serves per-route pre-rendered HTML ───────────────────────

type RouteMeta = {
  file: string;
  title: string;
  description: string;
  image: string;
  imageAlt: string;
  bodyClass: string;
};
type RouteRedirect = { redirect: string };
type Routes = Record<string, RouteMeta | RouteRedirect>;

const spaMetaMiddleware = (): Plugin => ({
  name: 'spa-meta-middleware',
  apply: 'serve' as const,
  configureServer(server: ViteDevServer) {
    const artifactDir = path.resolve(import.meta.dirname);
    const publicContentDir = path.join(artifactDir, 'public', 'content');
    const routesPath = path.join(publicContentDir, 'routes.json');

    server.middlewares.use(async (req, res, next) => {
      // Only intercept HTML navigation requests (not assets)
      const accept = req.headers['accept'] ?? '';
      if (!accept.includes('text/html')) return next();

      let reqPath = req.url?.split('?')[0] ?? '/';
      // Strip base path prefix so we match routes.json keys
      const base = basePath.replace(/\/$/, '');
      if (base && reqPath.startsWith(base)) {
        reqPath = reqPath.slice(base.length) || '/';
      }
      if (reqPath !== '/' && !reqPath.endsWith('/')) reqPath += '/';

      // Don't intercept Vite internal requests
      if (reqPath.startsWith('/@') || reqPath.startsWith('/node_modules/')) {
        return next();
      }

      let routes: Routes;
      try {
        routes = JSON.parse(fs.readFileSync(routesPath, 'utf8'));
      } catch {
        return next();
      }

      const meta = routes[reqPath];
      if (!meta) return next();
      if ('redirect' in meta || !meta.file) return next();

      const contentFile = path.join(publicContentDir, meta.file);
      if (!fs.existsSync(contentFile)) return next();

      try {
        const contentHtml = fs.readFileSync(contentFile, 'utf8');
        // Get the shell HTML from Vite's index transform pipeline
        let shellHtml = fs.readFileSync(
          path.join(artifactDir, 'index.html'),
          'utf8',
        );
        // Run Vite's own HTML transforms (so script tags are correct)
        shellHtml = await server.transformIndexHtml(reqPath, shellHtml);

        const pageHtml = injectRouteMeta(
          shellHtml,
          reqPath,
          meta,
          contentHtml,
          canonicalOrigin,
        );

        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(pageHtml);
      } catch {
        return next();
      }
    });
  },
});

// ─── Post-build pre-renderer ─────────────────────────────────────────────────

const prerenderPlugin = (): Plugin => ({
  name: 'prerender-routes',
  apply: 'build' as const,
  closeBundle() {
    const prerenderScript = path.resolve(import.meta.dirname, 'scripts', 'prerender.mjs');
    if (!fs.existsSync(prerenderScript)) {
      // Hard failure — the prerender script is required for production builds.
      throw new Error('[prerender] prerender.mjs not found — cannot generate per-route HTML.');
    }
    const outDir = path.resolve(import.meta.dirname, 'dist', 'public');
    // Use the *built* index.html as the shell so generated pages reference
    // Vite's hashed /assets/index-*.js bundles, not the TS source entry.
    const shellHtml = path.join(outDir, 'index.html');
    const originArg = canonicalOrigin;
    // Let execFileSync throw on non-zero exit — this propagates prerender
    // failures as a build error so broken output is never silently shipped.
    execFileSync(
      process.execPath,
      [
        prerenderScript,
        '--shellHtml', shellHtml,
        '--outDir', outDir,
        '--origin', originArg,
      ],
      { stdio: 'inherit' },
    );
  },
});

export default defineConfig({
  base: basePath,
  plugins: [
    redirectPlugin(),
    absoluteOgUrls(),
    spaMetaMiddleware(),
    prerenderPlugin(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});

function redirectPlugin() {
  const handler = (
    server: import('vite').ViteDevServer | import('vite').PreviewServer,
  ) => {
    server.middlewares.use((req, res, next) => {
      const raw = req.url?.split('?')[0] ?? '/';
      // Strip base path prefix so lookup keys always start with '/'.
      const stripped =
        basePath !== '/' && raw.startsWith(basePath.replace(/\/$/, ''))
          ? raw.slice(basePath.replace(/\/$/, '').length) || '/'
          : raw;
      const normalized =
        !stripped.includes('.') && !stripped.endsWith('/')
          ? stripped + '/'
          : stripped;
      const target = DEV_REDIRECTS[normalized];
      if (target) {
        res.writeHead(301, { Location: target });
        res.end();
        return;
      }
      next();
    });
  };
  return {
    name: 'canonical-redirects',
    configureServer: handler,
    configurePreviewServer: handler,
  };
}
