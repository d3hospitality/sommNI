import { defineConfig, loadEnv } from 'vite'
import { resolveAccountProject } from './src/account-project'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_WL_');
  resolveAccountProject(env.VITE_WL_SUPABASE_URL || undefined, env.VITE_WL_SUPABASE_KEY || undefined);
  return {
    base: '/sommNI/',
    server: {
      port: 5186,
      strictPort: true,
      proxy: { '/api': { target: 'https://sommni-api.vercel.app', changeOrigin: true } },
    },
    build: { rollupOptions: { input: { app: 'index.html', account: 'account.html' }, output: { manualChunks: { account: ['@supabase/supabase-js'] } } } },
  };
})