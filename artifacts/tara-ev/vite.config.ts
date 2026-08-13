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

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

// In the deployment build environment REPLIT_DOMAINS holds the production
// domain(s); in the dev workspace it holds the temporary .replit.dev domain.
// Social crawlers require an absolute og:image URL, so at production build
// time we prefix relative og:image/og:url values with the published origin.
const publishedDomain = process.env.REPLIT_DOMAINS?.split(',')[0]?.trim();

const absoluteOgUrls = () => ({
  name: 'absolute-og-urls',
  apply: 'build' as const,
  transformIndexHtml(html: string) {
    if (!publishedDomain) return html;
    const origin = `https://${publishedDomain}`;
    return html.replace(
      /(<meta\s+property="og:(?:image|url)"\s+content=")(\/[^"]*)(")/g,
      (_m, pre, path, post) => `${pre}${origin}${path}${post}`,
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

function extractDescription(html: string): string {
  const cleaned = html
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const pMatches = [...cleaned.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
  for (const m of pMatches) {
    const text = m[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (text.length < 50 || text.includes(' / ')) continue;
    return text.length > 158 ? text.slice(0, 157) + '…' : text;
  }
  const fallback = cleaned.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return fallback.length > 158 ? fallback.slice(0, 157) + '…' : fallback;
}

function extractOgImage(html: string): string {
  const SKIP = /logo|favicon|menu-image|icon/i;
  for (const m of html.matchAll(/src=["']([^"']+\.(?:webp|jpg|jpeg|png))["']/gi)) {
    const src = m[1];
    if (SKIP.test(src)) continue;
    if (src.startsWith('/images/') || src.startsWith('/uploads/')) return src;
  }
  return '/images/og-image.png';
}

function injectRouteMeta(
  shellHtml: string,
  routePath: string,
  routeTitle: string,
  contentHtml: string,
  origin: string,
): string {
  const description = extractDescription(contentHtml);
  const ogImage = extractOgImage(contentHtml);
  const canonicalUrl = `${origin}${routePath}`;
  const absoluteOgImage = ogImage.startsWith('http') ? ogImage : `${origin}${ogImage}`;

  let html = shellHtml;
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escHtml(routeTitle)}</title>`);
  html = html.replace(
    /<meta\s+name="description"[^>]*\/?>/i,
    `<meta name="description" content="${escHtml(description)}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:title"[^>]*\/?>/i,
    `<meta property="og:title" content="${escHtml(routeTitle)}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:description"[^>]*\/?>/i,
    `<meta property="og:description" content="${escHtml(description)}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:image"[^>]*\/?>/i,
    `<meta property="og:image" content="${absoluteOgImage}" />`,
  );
  const canonicalBlock = [
    `  <link rel="canonical" href="${canonicalUrl}" />`,
    `  <meta property="og:url" content="${canonicalUrl}" />`,
  ].join('\n');
  html = html.replace('</head>', `${canonicalBlock}\n</head>`);
  // Embed page content for crawlers
  html = html.replace(
    '<div id="root"></div>',
    `<div id="root" data-prerendered="1">${contentHtml}</div>`,
  );
  return html;
}

// ─── Dev middleware: serves per-route pre-rendered HTML ───────────────────────

type RouteMeta = { file: string; title: string; bodyClass: string };
type Routes = Record<string, RouteMeta>;

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

        const devOrigin = req.headers.host
          ? `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host}`
          : 'http://localhost';

        const pageHtml = injectRouteMeta(
          shellHtml,
          reqPath,
          meta.title,
          contentHtml,
          devOrigin,
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
    const originArg = publishedDomain
      ? `https://${publishedDomain}`
      : 'https://taranev.com';
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
