import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    open: true,
    host: true,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'https://cets.alanh.uk',
        changeOrigin: true,
        secure: true
      },
      '/ws': {
        target: 'wss://cets.alanh.uk',
        ws: true,
        changeOrigin: true,
        secure: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'antd-vendor': ['antd', '@ant-design/icons'],
          'chart-vendor': ['recharts'],
          'scan-vendor': ['@zxing/browser', 'qrcode']
        }
      }
    }
  }
})
