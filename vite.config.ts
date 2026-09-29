import { defineConfig } from 'vite'

export default defineConfig({
  base: '/sommNI/',
  server: {
    port: 5186,
    strictPort: true,
    proxy: { '/api': { target: 'https://sommni-api.vercel.app', changeOrigin: true } },
  },
  build: { rollupOptions: { output: { manualChunks: { account: ['@supabase/supabase-js'] } } } },
})