// Клик по элементу на живой странице: инжект подсветки, доли вьюпорта обратно.
//
// ⚠️ После клика main снимает ТЕКУЩИЙ вьюпорт. Доли от прокрученной страницы на старый
// capturePage попали бы в случайный кусок исходного кадра. Подсветку снимаем до снимка
// и ждём кадр без неё: removeChild синхронен, а композитор отдаёт capturePage предыдущий
// кадр — красная рамка попадала в PNG.
// Доли, не CSS×dpr — иначе зум страницы разъедется с размером снимка
// (разбор — shared/screenshotMarkup.ts).
//
// ⚠️ Щит поверх страницы: pointerdown preventDefault не отменяет последующий click у <a>,
// а если снять слушатели на down — click доходит до ссылки и открывает вкладку. Щит ест
// жест целиком; elementFromPoint на мгновение его выключает. Колёсико и клавиши прокрутки
// тоже: иначе человек уезжает за снятый кадр и думает, что кропает то, что видит.
import type { WebContents } from 'electron';
import { MIN_CROP, PICK_PAD, SHOT_MARK } from '../shared/screenshotMarkup';

const TIMEOUT_MS = 60_000;

/** IIFE → Promise. userGesture:true, иначе preventDefault на ссылке не сработает. */
export const PICK_ELEMENT_SCRIPT = `(() => new Promise((resolve) => {
  if (window.__oblakoShotPick) window.__oblakoShotPick.abort();
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;'
    + 'border:2px solid ${SHOT_MARK};border-radius:4px;display:none';
  const shield = document.createElement('div');
  shield.setAttribute('aria-hidden', 'true');
  shield.style.cssText = 'position:fixed;inset:0;z-index:2147483646;cursor:crosshair;touch-action:none;';
  document.documentElement.appendChild(shield);
  document.documentElement.appendChild(box);
  const vw = () => Math.max(1, document.documentElement.clientWidth);
  const vh = () => Math.max(1, document.documentElement.clientHeight);
  const hit = (ev) => {
    shield.style.pointerEvents = 'none';
    const el = document.elementFromPoint(ev.clientX, ev.clientY);
    shield.style.pointerEvents = 'auto';
    if (!el || el === box || el === shield) return null;
    let cur = el;
    while (cur && cur !== document.documentElement && cur !== document.body) {
      const r = cur.getBoundingClientRect();
      if (r.width >= ${MIN_CROP} && r.height >= ${MIN_CROP}) return cur;
      cur = cur.parentElement;
    }
    return el;
  };
  const place = (el) => {
    if (!el) { box.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = r.left + 'px';
    box.style.top = r.top + 'px';
    box.style.width = Math.max(0, r.width) + 'px';
    box.style.height = Math.max(0, r.height) + 'px';
  };
  const cleanup = () => {
    clearTimeout(timer);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('wheel', onEat, true);
    shield.removeEventListener('pointermove', onMove);
    shield.removeEventListener('pointerdown', onEat);
    shield.removeEventListener('click', onClick);
    shield.removeEventListener('auxclick', onEat);
    shield.removeEventListener('contextmenu', onEat);
    box.style.display = 'none';
    shield.style.display = 'none';
    void box.offsetHeight;
    if (box.parentNode) box.parentNode.removeChild(box);
    if (shield.parentNode) shield.parentNode.removeChild(shield);
    window.__oblakoShotPick = null;
  };
  const afterPaint = (value) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(value)));
  };
  const onMove = (ev) => place(hit(ev));
  const onEat = (ev) => { ev.preventDefault(); ev.stopImmediatePropagation(); };
  const onClick = (ev) => {
    ev.preventDefault();
    ev.stopImmediatePropagation();
    const el = hit(ev);
    if (!el) { cleanup(); afterPaint(null); return; }
    const r = el.getBoundingClientRect();
    const view = { width: vw(), height: vh() };
    const x = Math.max(0, r.left - ${PICK_PAD});
    const y = Math.max(0, r.top - ${PICK_PAD});
    const w = Math.min(view.width, r.right + ${PICK_PAD}) - x;
    const h = Math.min(view.height, r.bottom + ${PICK_PAD}) - y;
    cleanup();
    afterPaint({ x: x / view.width, y: y / view.height, w: w / view.width, h: h / view.height });
  };
  const scrollKey = (ev) => ev.key === ' ' || ev.key === 'PageUp' || ev.key === 'PageDown'
    || ev.key === 'Home' || ev.key === 'End' || ev.key.startsWith('Arrow');
  const onKey = (ev) => {
    if (scrollKey(ev)) { onEat(ev); return; }
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    cleanup();
    resolve(null);
  };
  const timer = setTimeout(() => { cleanup(); resolve(null); }, ${TIMEOUT_MS});
  window.__oblakoShotPick = { abort: () => { cleanup(); resolve(null); } };
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('wheel', onEat, { capture: true, passive: false });
  shield.addEventListener('pointermove', onMove);
  shield.addEventListener('pointerdown', onEat);
  shield.addEventListener('click', onClick);
  shield.addEventListener('auxclick', onEat);
  shield.addEventListener('contextmenu', onEat);
}))()`;

/** Два кадра без подсветки: capturePage иначе берёт предыдущий композиторный кадр. */
export async function waitShotPaint(wc: WebContents): Promise<void> {
  if (wc.isDestroyed()) return;
  try {
    await wc.executeJavaScript(
      'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 16))))',
    );
  } catch { /* вкладка умерла */ }
}
