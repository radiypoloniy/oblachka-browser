import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// Renderer (хром браузера) собирается Vite. Electron-main собирается отдельно через tsc.
// base: './' — чтобы в проде ассеты грузились по относительным путям из file://.
export default defineConfig({
  root: resolve(__dirname, 'src'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/index.html'),
        // Временный мост ручной проверки перевода (EuroLLM/node-llama-cpp) — за флагом
        // OBLAKO_TRANSLATE_TEST=1, сносится без следа.
        translatetest: resolve(__dirname, 'src/translatetest.html'),
        // Боевой поповер перевода выделения — отдельная WebContentsView поверх контента,
        // создаётся лениво (TranslatePopoverManager.ts), не при старте браузера.
        translatepopover: resolve(__dirname, 'src/translatepopover.html'),
        // Правая AI-панель — отдельная WebContentsView поверх контента (см. AiPanelManager.ts),
        // тоже создаётся лениво, на первое открытие кнопкой AI в тулбаре.
        aipanel: resolve(__dirname, 'src/aipanel.html'),
        // FindBar (Ctrl+F) — отдельная WebContentsView поверх контента (см. FindBarManager.ts),
        // создаётся лениво на первый Ctrl+F, не при старте браузера.
        findbar: resolve(__dirname, 'src/findbar.html'),
        // Поповер паролей — отдельная WebContentsView поверх контента (см. PasswordPopoverManager.ts),
        // тот же нативный слой, что FindBar/SuggestDropdown.
        passwordpopover: resolve(__dirname, 'src/passwordpopover.html'),
        // Поповер VPN-пилюли — та же техника (см. VpnPopoverManager.ts).
        vpnpopover: resolve(__dirname, 'src/vpnpopover.html'),
        // Тестовая вью дропдауна подсказок омнибокса (заход 2/5 переезда с chrome-DOM, см.
        // SuggestDropdownManager.ts) — статичный список, не боевая пока.
        suggestdropdown: resolve(__dirname, 'src/suggestdropdown.html'),
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
