import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Renderer (хром браузера) собирается Vite. Electron-main собирается отдельно через tsc.
// base: './' — чтобы в проде ассеты грузились по относительным путям из file://.
export default defineConfig({
  root: resolve(__dirname, 'src'),
  base: './',
  plugins: [react()],
  // Без exclude transformers.js не может динамически грузить WASM-файлы onnxruntime-web.
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
