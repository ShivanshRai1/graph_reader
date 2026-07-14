import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
  ],
  server: {
    proxy: {
      // Mirror Netlify /do-api → DigitalOcean for local failover testing
      '/do-api': {
        target: 'http://165.22.212.92:8010',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/do-api/, ''),
      },
      '/rc-ladder-proxy': {
        target: 'http://165.22.212.92:8020',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/rc-ladder-proxy/, ''),
      },
    },
  },
})
