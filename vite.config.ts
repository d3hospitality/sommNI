import { defineConfig } from 'vite'

export default defineConfig({
  base: '/sommNI/',
  server: {
    port: 5186,
    strictPort: true,
  },
  build: { rollupOptions: { output: { manualChunks: { account: ['@supabase/supabase-js'] } } } },
})