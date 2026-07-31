// Чтение выделенного текста со страницы — для поповера быстрого поиска (Ctrl+E).
//
// Почему это отдельный модуль, а не одна строка executeJavaScript: тот выполняется ТОЛЬКО в
// верхнем фрейме, а выделение внутри iframe в getSelection() родителя не попадает вообще.
// Страницы, целиком собранные из фреймов, — не экзотика: Intercom (рабочий мессенджер) рисует
// в них весь интерфейс, и там поле поиска молча оставалось бы пустым.
//
// Порядок опроса — от самого точного к самому широкому:
//   1. фрейм с фокусом (wc.focusedFrame) — именно в нём человек и выделял, один запрос;
//   2. верхний фрейм — обычная страница без фреймов, тоже один запрос;
//   3. остальные фреймы поддерева — уже перебором, с потолком на число.
// Кросс-доменность роли не играет: WebFrameMain.executeJavaScript выполняется из главного
// процесса в контексте КАЖДОГО фрейма отдельно, ему не нужен доступ через границу origin.
import type { WebContents, WebFrameMain } from 'electron';

// Потолок на перебор: на рекламных страницах фреймов бывают десятки, а каждый — round trip
// в свой процесс рендеринга. Выделение при этом почти всегда в первых.
const MAX_FRAMES = 12;

async function frameSelection(frame: WebFrameMain): Promise<string> {
  try {
    const v: unknown = await frame.executeJavaScript('String(window.getSelection() ?? "")', true);
    return typeof v === 'string' ? v.trim() : '';
  } catch {
    return ''; // фрейм успел исчезнуть или не пустил скрипт — не повод падать
  }
}

export async function readPageSelection(wc: WebContents): Promise<string> {
  const focused = wc.focusedFrame;
  if (focused) {
    const s = await frameSelection(focused);
    if (s) return s;
  }

  let main: WebFrameMain | null = null;
  try { main = wc.mainFrame; } catch { return ''; }
  if (!main) return '';

  if (main !== focused) {
    const s = await frameSelection(main);
    if (s) return s;
  }

  let rest: WebFrameMain[] = [];
  try {
    rest = main.framesInSubtree.filter((f) => f !== main && f !== focused).slice(0, MAX_FRAMES);
  } catch { return ''; }
  if (rest.length === 0) return '';

  // Параллельно, а не по очереди: последовательный обход дюжины фреймов не уложился бы в
  // отведённое поповеру время ожидания (см. вызывающую сторону в main.ts).
  const results = await Promise.all(rest.map(frameSelection));
  return results.find((s) => s) ?? '';
}
