// Размытая подложка под якорным поповером — СНИМОК страницы, а не backdrop-filter.
//
// ⚠️ ПОЧЕМУ ТАК, А НЕ ЧЕСТНЫМ БЛЮРОМ. Поповеры живут в ОТДЕЛЬНЫХ WebContentsView поверх страницы,
// а `backdrop-filter` размывает только то, что лежит В ТОМ ЖЕ документе. Под вью — чужой слой
// композитинга, и размыть его нечем: сколько ни задавай blur, текст страницы за карточкой
// остаётся резким. Это не наша недоработка и не баг Electron — так устроен композитинг, и
// поправить это в CSS нельзя в принципе (разбор жил в tokens/colors.css у --material, и оттуда
// же росло решение «просто сделаем материал плотнее»).
//
// ⚠️ Плотности НЕДОСТАТОЧНО, и это живая жалоба: даже пять процентов прозрачности поверх плотного
// текста дают рябь, и содержимое карточки «превращается в кашу». Причём убрать прозрачность
// совсем — значит потерять материал: карточка станет крашеной плитой.
//
// Обход: снять кадр той области страницы, которую карточка накроет, уменьшить его в SCALE раз и
// отдать во вью картинкой. Дальше карточка рисует его у себя ПОД своим полупрозрачным фоном —
// то есть собственные пиксели вью становятся непрозрачными, и сквозь материал видно размытый
// снимок вместо резкого текста. Матовость настоящая, читаемость полная.
//
// ⚠️ Снимок СТАТИЧЕН: страница за карточкой может уехать (прокрутка, видео, анимация). Это
// осознанно и почти не видно — размытая в кашу картинка и так неузнаваема, а поповеры,
// заякоренные на поле, прокрутка вообще закрывает. Ради живого блюра пришлось бы снимать кадр
// по таймеру, то есть жечь GPU ради эффекта, которого никто не разглядывает.
import type { BrowserWindow, WebContentsView } from 'electron';
import { IPC } from '../shared/ipc';
import { contextForWindow } from './WindowRegistry';

/**
 * Во сколько раз уменьшаем снимок перед отправкой.
 *
 * ⚠️ Уменьшение — это и есть первая половина блюра, причём бесплатная: даунсэмплинг усредняет
 * пиксели ровно так, как усреднил бы гауссов фильтр, а вторую половину доводит CSS-filter при
 * растягивании обратно. Заодно карточка 300×400 уезжает во вью картинкой в несколько килобайт,
 * а не мегабайтным PNG.
 */
const SCALE = 8;

/**
 * Пауза перед снимком.
 *
 * ⚠️ Нужна не «для плавности», а потому что bounds карточки пересчитываются пачкой: показ,
 * доклад высоты из рендерера, ресайз окна — три вызова подряд на одно появление. Без склейки это
 * три захвата кадра там, где нужен один.
 */
const DEBOUNCE_MS = 60;

const timers = new WeakMap<WebContentsView, ReturnType<typeof setTimeout>>();

export interface CardRect { x: number; y: number; width: number; height: number }

/** Снять и отправить подложку под карточку. Прямоугольник — в координатах ОКНА. */
export function pushOverlayBackdrop(win: BrowserWindow, view: WebContentsView | null, card: CardRect): void {
  if (!view) return;
  const prev = timers.get(view);
  if (prev) clearTimeout(prev);
  timers.set(view, setTimeout(() => { void capture(win, view, card); }, DEBOUNCE_MS));
}

function send(view: WebContentsView, dataUrl: string | null): void {
  try {
    if (!view.webContents.isDestroyed()) view.webContents.send(IPC.OVERLAY_BACKDROP, dataUrl);
  } catch { /* вью закрылась между таймером и отправкой */ }
}

async function capture(win: BrowserWindow, view: WebContentsView, card: CardRect): Promise<void> {
  try {
    if (win.isDestroyed() || view.webContents.isDestroyed()) return;
    const tabs = contextForWindow(win)?.tabs ?? null;
    const wc = tabs?.getActiveWebContents() ?? null;
    // Спящая вкладка, служебная страница, хаб — снимать нечего. Карточка останется как была
    // (плотный материал), то есть деградация тихая и без поломки.
    if (!tabs || !wc || wc.isDestroyed()) { send(view, null); return; }

    const vb = tabs.getTabViewBounds(tabs.getActiveId());
    if (vb.width < 8 || vb.height < 8) { send(view, null); return; }

    // Координаты окна → координаты страницы. ⚠️ Зажимаем в область вкладки, а не отбрасываем
    // вылезшую карточку: над нижним краем окна она заходит за страницу почти всегда, и «нет
    // снимка» там означало бы возврат к той самой каше ровно в самом частом случае. Сдвиг на
    // несколько пикселей в размытой подложке не виден.
    const x = Math.min(Math.max(0, Math.round(card.x - vb.x)), vb.width - 8);
    const y = Math.min(Math.max(0, Math.round(card.y - vb.y)), vb.height - 8);
    const width = Math.max(8, Math.min(Math.round(card.width), vb.width - x));
    const height = Math.max(8, Math.min(Math.round(card.height), vb.height - y));

    const img = await wc.capturePage({ x, y, width, height });
    if (img.isEmpty()) { send(view, null); return; }
    const small = img.resize({ width: Math.max(8, Math.round(width / SCALE)), quality: 'good' });
    send(view, small.toDataURL());
  } catch (e) {
    // Снимок — украшение, а не функция: любая осечка означает «карточка без подложки», не сбой.
    console.warn('[overlay-backdrop] снимок не вышел:', (e as Error).message);
    send(view, null);
  }
}
