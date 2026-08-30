import { WebContentsView, dialog, type BrowserWindow } from 'electron';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app } from 'electron';
import { markBackground, unmarkBackground } from './BackgroundWebContents';

// Выгрузка страницы Студии в PDF.
//
// ⚠️ Печатает СКРЫТАЯ ВЬЮ, а не открытая вкладка. Причина простая: печатать надо ту страницу,
// которую человек выбрал в предпросмотре, а не ту, что случайно открыта; и делать это, ничего
// у него не отнимая. Приём и параметры взяты у NotebookExtract — там такая же скрытая вью
// уводится за левый край окна.
//
// ⚠️ Вью уводится ПОЛОЖЕНИЕМ, а не нулевым размером. С нулевыми bounds у страницы нет раскладки:
// разбор в NotebookExtract стоил пустых извлечений, и для печати это было бы ещё хуже — PDF
// вышел бы пустым, а сбой заметили бы только у получателя.

/** Размер вью под печать: ширина A4 при 96 dpi. По ней и раскладывается страница. */
const PRINT_VIEWPORT = { width: 794, height: 1123 };
/** Дольше этого страница не грузится: свой файл с локальных ресурсов открывается мгновенно. */
const LOAD_TIMEOUT_MS = 8000;
/**
 * Пауза после загрузки — на шрифты.
 *
 * ⚠️ Не «на всякий случай»: страница тянет Google Fonts, и без ожидания PDF выходит набранным
 * системным запасным шрифтом. `document.fonts.ready` был бы точнее, но требует исполнения
 * скрипта в чужом документе — а тут нам как раз незачем туда лезть.
 */
const FONTS_MS = 700;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

/**
 * Сохраняет готовую страницу в PDF. false — человек отменил диалог или печать не удалась.
 *
 * @param html самодостаточный документ — тот же, что уходит в «Сохранить» и открывается вкладкой
 */
export async function savePageAsPdf(win: BrowserWindow, name: string, html: string): Promise<boolean> {
  if (!html) return false;
  const safe = (name || 'страница').replace(/[/:*?"<>|\\]/g, ' ').trim().slice(0, 80);
  const res = await dialog.showSaveDialog(win, {
    title: 'Сохранить PDF',
    defaultPath: `${safe || 'страница'}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (res.canceled || !res.filePath) return false;

  // ⚠️ Через ВРЕМЕННЫЙ ФАЙЛ, а не data:-URL. Документ уже весит десятки килобайт, а с
  // data:-URL к нему добавляется base64 и ограничения на длину адреса; file:// же просто
  // работает и заодно даёт странице нормальный origin для шрифтов.
  const tmp = path.join(app.getPath('temp'), `oblako-pdf-${Date.now()}.html`);
  const view = new WebContentsView({
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  markBackground(view.webContents.id);
  win.contentView.addChildView(view);
  view.setBounds({ x: -PRINT_VIEWPORT.width - 100, y: 0, ...PRINT_VIEWPORT });

  try {
    await fsp.writeFile(tmp, html, 'utf8');
    const ok = await withTimeout(
      view.webContents.loadURL(pathToFileURL(tmp).href).then(() => true), LOAD_TIMEOUT_MS,
    );
    if (!ok || view.webContents.isDestroyed()) return false;
    await new Promise((r) => setTimeout(r, FONTS_MS));
    if (view.webContents.isDestroyed()) return false;
    // printBackground обязателен: у «Экрана» и «Пульта» тёмный фон и цветные плашки, без него
    // получилась бы белая страница с невидимым белым текстом.
    const pdf = await view.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });
    await fsp.writeFile(res.filePath, pdf);
    return true;
  } catch (err) {
    console.warn('[Notebook] PDF не собрался:', (err as Error).message);
    return false;
  } finally {
    unmarkBackground(view.webContents.id);
    try { if (!win.isDestroyed()) win.contentView.removeChildView(view); } catch { /* окно закрылось */ }
    try { if (!view.webContents.isDestroyed()) view.webContents.close(); } catch { /* уже закрыт */ }
    // Временный файл убираем за собой — он наш и создан только что.
    try { await fsp.unlink(tmp); } catch { /* мог не создаться */ }
  }
}
