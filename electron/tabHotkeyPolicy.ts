import type { WebContents } from 'electron';

// ⚠️ Список должен совпадать с DISPUTED в sandboxed preload-content.ts. Импортировать его оттуда
// нельзя: sandboxed preload не поддерживает require() относительных модулей.
const DISPUTED_BY_CODE: Readonly<Record<string, string>> = {
  KeyF: 'find', KeyE: 'quick', KeyD: 'bookmark', KeyR: 'reload', KeyH: 'history',
};

export function disputedPageAction(code: string): string | undefined {
  return DISPUTED_BY_CODE[code];
}

/** Подхватываем спорный хоткей сверху лишь тогда, когда он застрял в чужом iframe. */
export function disputedKeyStuckInFrame(wc: WebContents): boolean {
  try {
    const focused = wc.focusedFrame;
    if (!focused || !focused.parent) return false;
    // Кадрам своего origin оставляем клавиши редактора — у них может быть своя обработка.
    return focused.origin !== wc.mainFrame.origin;
  } catch {
    // Кадр мог умереть между нажатием и проверкой.
    return false;
  }
}
