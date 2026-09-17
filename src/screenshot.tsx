// Карточка снимка вкладки — точка входа вью (см. electron/ScreenshotManager.ts).
// Карточка, оформление и редактор лежат в src/screenshot/: иначе один файл перерос бы
// порог храповика, а жест Ctrl+Shift+S / Ctrl+S обязан остаться тонким.
import { StrictMode } from 'react';
import ReactDOM from 'react-dom/client';
import { StandaloneLanguageProvider } from './i18n';
import './styles/global.css';
import { installOverlayReveal } from './overlayReveal';
import { ScreenshotRoot } from './screenshot/Root';

declare global {
  interface Window {
    screenshotOverlay: {
      onShot: (cb: (dataUrl: string) => void) => () => void;
      onSaveRequest: (cb: () => void) => () => void;
      save: (dataUrl: string) => Promise<string | null>;
      copy: (dataUrl: string) => void;
      reveal: (file: string) => void;
      close: () => void;
      reportHeight: (px: number) => void;
      setMode: (mode: 'card' | 'edit') => void;
      captureWindow: () => Promise<{
        width: number; height: number;
        layers: { url: string; x: number; y: number; w: number; h: number }[];
      } | null>;
      pickElement: () => Promise<{
        raw: string; frac: { x: number; y: number; w: number; h: number };
      } | null>;
    };
  }
}

installOverlayReveal();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StandaloneLanguageProvider><ScreenshotRoot /></StandaloneLanguageProvider>
  </StrictMode>,
);
