import { clientBoundary } from './scripts/client-boundary.mjs'
import { defineConfig, loadEnv } from 'vite'
import { resolveAccountProject } from './src/account-project'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_WL_');
  resolveAccountProject(env.VITE_WL_SUPABASE_URL || undefined, env.VITE_WL_SUPABASE_KEY || undefined);
  return {
    base: '/sommNI/',
    plugins: [clientBoundary()],
    server: {
      port: 5186,
      strictPort: true,
      proxy: { '/api/bottle-cutout': { target: 'http://127.0.0.1:5196', changeOrigin: true, rewrite: () => '/cutout' }, '/api': { target: 'https://sommni-api.vercel.app', changeOrigin: true } },
    },
    build: { rollupOptions: { input: env.VITE_WL_FREE_BETA === 'true' ? { app: 'index.html' } : { app: 'index.html', account: 'account.html' }, output: { manualChunks: { account: ['@supabase/supabase-js'] } } } },
  };
})