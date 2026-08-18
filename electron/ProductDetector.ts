// Распознавание товара на открытой странице (отслеживание товаров, срез 1).
//
// ⚠️ Со страницы забираем СЫРЫЕ блоки JSON-LD, а разбираем их в main (shared/productSignal.ts).
// Так разбор — тот, что решает, какая цена попадёт в историю, — остаётся под прогоном обычным
// node, а в чужой странице исполняется десяток строк без всякой логики.
import type { WebContents } from 'electron';
import { productFromJsonLd, type ProductSignal } from '../shared/productSignal';

// Больше пяти блоков разметки на странице не бывает осмысленно, а вот весить они могут много.
const MAX_BLOCKS = 5;
const MAX_BLOCK_CHARS = 300_000;

const COLLECT_SCRIPT = `(function(){
  try {
    var out = [];
    var nodes = document.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < nodes.length && out.length < ${MAX_BLOCKS}; i++) {
      var t = nodes[i].textContent || '';
      if (t.length > 0 && t.length <= ${MAX_BLOCK_CHARS}) out.push(t);
    }
    return out;
  } catch (e) { return []; }
})()`;

/** Сколько ждём ответа страницы. Больше — не полезнее: живая страница отвечает за миллисекунды. */
const COLLECT_TIMEOUT_MS = 10_000;

/** Ответ рендерера или null по таймауту. Таймер снимается в обоих исходах — он бы держал петлю. */
async function withTimeout<T>(work: Promise<T>): Promise<T | null> {
  let timer: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      work,
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), COLLECT_TIMEOUT_MS); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Есть ли на этой странице товар с ценой.
 *
 * null — товара нет, и это самый частый и совершенно нормальный ответ. Ложное «нашёлся» дороже
 * пропуска: индикатор загорится там, где отслеживать нечего.
 */
export async function detectProduct(wc: WebContents | null): Promise<ProductSignal | null> {
  if (!wc || wc.isDestroyed()) return null;
  const url = wc.getURL();
  // Служебные страницы, хаб и файлы с диска товарами быть не могут.
  if (!/^https?:/i.test(url)) return null;
  try {
    // ⚠️ ТАЙМАУТ ОБЯЗАТЕЛЕН. executeJavaScript ждёт ответа рендерера бесконечно, а зовут нас в том
    // числе из фоновой проверки товаров, которая держит ради этого СКРЫТОЕ ОКНО (TrackingChecker,
    // checkView). Пока живо хоть одно окно — любое, включая невидимое — приложение не выходит по
    // window-all-closed. То есть один зависший ответ от антибот-страницы Маркета или Озона
    // означал: человек закрыл браузер, а процесс остался жить навсегда, удерживая
    // single-instance lock. Симптом со стороны — «браузер не запускается и ссылки не
    // открываются», причём ни ошибки, ни окна: второй запуск молча умирает о занятый замок.
    const blocks = await withTimeout(wc.executeJavaScript(COLLECT_SCRIPT) as Promise<string[]>);
    if (!Array.isArray(blocks) || blocks.length === 0) return null;
    return productFromJsonLd(blocks);
  } catch {
    // Страница могла уйти из-под ног — это не ошибка, просто товара нет.
    return null;
  }
}
