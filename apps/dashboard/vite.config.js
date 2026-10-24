import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  server: {
    proxy: {
      '/api':     { target: 'http://127.0.0.1:8090', changeOrigin: true },
      '/grafana': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    }
  },
  define: {
    __BUILD_TIME__: JSON.stringify(Date.now()),
  },
})
