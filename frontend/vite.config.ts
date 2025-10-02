import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      allowedHosts: ['claude.gmac.io'],
      port: 47285,
      proxy: {
        '/api': 'http://localhost:43829'
      }
    },
    define: {
      'import.meta.env.VITE_API_URL': JSON.stringify(
        mode === 'production'
          ? 'https://api.claude.gmac.io'
          : 'http://localhost:43829'
      )
    }
  }
})
