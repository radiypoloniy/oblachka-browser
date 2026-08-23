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
        // Поповер быстрого поиска (Ctrl+E) — отдельная WebContentsView поверх контента
        // (см. SearchPopoverManager.ts), тоже лениво, на первое нажатие.
        searchpopover: resolve(__dirname, 'src/searchpopover.html'),
        // Поповер паролей — отдельная WebContentsView поверх контента (см. PasswordPopoverManager.ts),
        // тот же нативный слой, что FindBar/SuggestDropdown.
        passwordpopover: resolve(__dirname, 'src/passwordpopover.html'),
        // Поповер автозаполнения адресов/карт — та же техника (см. AutofillPopoverManager.ts).
        autofillpopover: resolve(__dirname, 'src/autofillpopover.html'),
        // Поповер загрузок у кнопки тулбара — та же техника (см. DownloadsPopoverManager.ts).
        downloadspopover: resolve(__dirname, 'src/downloadspopover.html'),
        clipboardpopover: resolve(__dirname, 'src/clipboardpopover.html'),
        // Поповер сведений о сайте у замочка в омнибоксе (см. SitePopoverManager.ts).
        sitepopover: resolve(__dirname, 'src/sitepopover.html'),
        // Запрос разрешения сайта (камера/гео/…) — та же техника (см. PermissionPopoverManager.ts).
        permissionpopover: resolve(__dirname, 'src/permissionpopover.html'),
        // Тестовая вью дропдауна подсказок омнибокса (заход 2/5 переезда с chrome-DOM, см.
        // SuggestDropdownManager.ts) — статичный список, не боевая пока.
        suggestdropdown: resolve(__dirname, 'src/suggestdropdown.html'),
        dropzones: resolve(__dirname, 'src/dropzones.html'),
        // Карточка снимка вкладки (Ctrl+Shift+S) — та же техника (см. ScreenshotManager.ts).
        screenshot: resolve(__dirname, 'src/screenshot.html'),
        // Временный стенд лиц часов (B1). Сносится вместе с невыбранными вариантами.
        clockstand: resolve(__dirname, 'src/clockstand.html'),
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
