import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const vendorChunks = [
  ['react-vendor', ['react', 'react-dom', 'react-router-dom']],
  ['antd-vendor', ['antd']],
  ['antd-icons', ['@ant-design/icons']],
  ['chart-vendor', ['recharts']],
  ['scan-vendor', ['@zxing/browser', 'qrcode']]
]

const getManualChunk = (id) => {
  const normalizedId = id.replace(/\\/g, '/')
  if (!normalizedId.includes('/node_modules/')) {
    return undefined
  }

  const matchesPackage = (packageName) => (
    normalizedId.includes(`/node_modules/${packageName}/`) ||
    normalizedId.endsWith(`/node_modules/${packageName}`)
  )

  const chunk = vendorChunks.find(([, packageNames]) => packageNames.some(matchesPackage))
  return chunk?.[0]
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: false,
      open: true,
      host: true,
      allowedHosts: true
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      chunkSizeWarningLimit: 1250,
      rollupOptions: {
        output: {
          manualChunks: getManualChunk
        }
      }
    }
  }
})
