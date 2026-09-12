// Клик по элементу на живой странице: инжект подсветки, доли вьюпорта обратно.
//
// ⚠️ Кропаем УЖЕ снятый растр, а не делаем второй capturePage: подсветка в кадр не попадает,
// и координаты не зависят от того, успела ли страница перерисоваться. Доли, не CSS×dpr —
// иначе зум страницы разъедется с размером снимка (разбор — shared/screenshotMarkup.ts).
import { MIN_CROP, SHOT_MARK } from '../shared/screenshotMarkup';

const TIMEOUT_MS = 60_000;

/** IIFE → Promise. userGesture:true, иначе preventDefault на ссылке не сработает. */
export const PICK_ELEMENT_SCRIPT = `(() => new Promise((resolve) => {
  if (window.__oblakoShotPick) window.__oblakoShotPick.abort();
  const box = document.createElement('div');
  box.setAttribute('aria-hidden', 'true');
  box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;'
    + 'border:2px solid ${SHOT_MARK};border-radius:4px;display:none';
  document.documentElement.appendChild(box);
  const vw = () => Math.max(1, document.documentElement.clientWidth);
  const vh = () => Math.max(1, document.documentElement.clientHeight);
  const target = (ev) => {
    const hit = document.elementFromPoint(ev.clientX, ev.clientY);
    if (!hit || hit === box) return null;
    let cur = hit;
    while (cur && cur !== document.documentElement && cur !== document.body) {
      const r = cur.getBoundingClientRect();
      if (r.width >= ${MIN_CROP} && r.height >= ${MIN_CROP}) return cur;
      cur = cur.parentElement;
    }
    return hit;
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
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('keydown', onKey, true);
    if (box.parentNode) box.parentNode.removeChild(box);
    window.__oblakoShotPick = null;
  };
  const onMove = (ev) => place(target(ev));
  const onDown = (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const el = target(ev);
    cleanup();
    if (!el) { resolve(null); return; }
    const r = el.getBoundingClientRect();
    resolve({ x: r.left / vw(), y: r.top / vh(), w: r.width / vw(), h: r.height / vh() });
  };
  const onKey = (ev) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    ev.stopPropagation();
    cleanup();
    resolve(null);
  };
  const timer = setTimeout(() => { cleanup(); resolve(null); }, ${TIMEOUT_MS});
  window.__oblakoShotPick = { abort: () => { cleanup(); resolve(null); } };
  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('keydown', onKey, true);
}))()`;
