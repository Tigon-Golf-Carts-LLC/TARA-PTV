import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

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

export default defineConfig({
  base: basePath,
  plugins: [
    absoluteOgUrls(),
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
