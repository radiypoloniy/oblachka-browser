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
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        // Изолированный стенд Фазы 1 (WebGPU на кириллице) — не часть боевого чрома,
        // грузится отдельным окном только при OBLAKO_GPU_TEST=1.
        gputest: resolve(__dirname, 'src/gputest.html'),
        // Временный мост ручной проверки перевода (EuroLLM/node-llama-cpp) — за флагом
        // OBLAKO_TRANSLATE_TEST=1, сносится без следа.
        translatetest: resolve(__dirname, 'src/translatetest.html'),
        // Боевой поповер перевода выделения — отдельная WebContentsView поверх контента,
        // создаётся лениво (TranslatePopoverManager.ts), не при старте браузера.
        translatepopover: resolve(__dirname, 'src/translatepopover.html'),
        // Правая AI-панель — отдельная WebContentsView поверх контента (см. AiPanelManager.ts),
        // тоже создаётся лениво, на первое открытие кнопкой AI в тулбаре.
        aipanel: resolve(__dirname, 'src/aipanel.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // COOP/COEP для dev-режима: те же заголовки что и в oblako-chrome://
    // → crossOriginIsolated=true → SAB → WASM-многопоточность в npm run dev тоже.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
});
