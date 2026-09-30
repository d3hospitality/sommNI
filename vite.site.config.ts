import { resolve } from 'node:path';
import { defineConfig } from 'vite';
export default defineConfig({
  root: 'site', envDir: '..', publicDir: 'public', base: '/',
  // Keep Vite's caches inside THIS worktree (node_modules may be shared elsewhere).
  cacheDir: '.vite-site',
  server: { port: 5187, strictPort: true },
  plugins: [{ name: 'site-clean-urls', configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && /^\/(link|privacypolicy|terms)(\?|$)/.test(req.url)) req.url = req.url.replace(/^(\/[^?]+)/, '$1.html');
      next();
    });
  } }],
  build: { outDir: '../dist-site', emptyOutDir: true, rollupOptions: { input: {
    index: resolve(__dirname, 'site/index.html'), link: resolve(__dirname, 'site/link.html'),
    privacy: resolve(__dirname, 'site/privacypolicy.html'), terms: resolve(__dirname, 'site/terms.html'),
  } } },
});
