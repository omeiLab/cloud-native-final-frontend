const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
    exclude: ['e2e/**', 'dist/**', 'node_modules/**'],
    setupFiles: [],
    globals: true
  }
});