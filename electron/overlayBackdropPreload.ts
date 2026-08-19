// Приёмник размытой подложки на стороне поповера (см. electron/overlayBackdrop.ts).
//
// ⚠️ Живёт в PRELOAD, а не в React-коде карточки, и это экономия, а не хитрость: поповеров восемь,
// у каждого своя точка входа и свой бандл, и протаскивать снимок через contextBridge → props →
// стиль пришлось бы восемь раз. Preload же имеет прямой доступ к тому же DOM (contextIsolation
// разделяет миры JS, а не документы), поэтому кладёт снимок в CSS-переменную корня — и любая
// карточка забирает его декларативно, одной строкой в стилях (см. .popover-card в global.css).
//
// ⚠️ Работает только там, где preload НЕ песочный (`sandbox: false`) — у всех наших поповеров так
// и есть. Для гостевых страниц это было бы недопустимо, но здесь вью наша собственная.
import { ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';

const VAR = '--overlay-backdrop';

export function installOverlayBackdrop(): void {
  ipcRenderer.on(IPC.OVERLAY_BACKDROP, (_e, dataUrl: string | null) => {
    try {
      const root = document.documentElement;
      if (!root) return;
      // ⚠️ Кавычки обязательны: data-URL содержит символы, на которых `url(...)` без кавычек
      // разваливается, и тогда переменная просто не применится — молча, без ошибки в консоли.
      root.style.setProperty(VAR, dataUrl ? `url("${dataUrl}")` : 'none');
    } catch {
      // документ ещё не готов — следующий снимок приедет через миг
    }
  });
}
