import { useEffect } from 'react';
import type { RefObject } from 'react';

// ── Пружинистая отдача при прокрутке, как в iOS ───────────────────────────────
//
// Chromium на Windows такого не умеет: `overscroll-behavior` только ГАСИТ эффекты, своей
// резинки у платформы нет. Пишем сами, но не выдумывая: устройство взято с
// elastic-scroll-polyfill (внутренняя обёртка + translate3d по deltaY), математика — формула
// UIScrollView.
//
// ⚠️ Формула АСИМПТОТИЧЕСКАЯ: offset = (1 − 1/(raw·k/d + 1))·d. Сколько бы ни крутили,
// смещение стремится к d, но никогда его не достигает. Первая версия копила смещение с
// делителем и обрезала по потолку — лента доезжала до предела и вставала колом, отчего
// эффект и ощущался дёшево. Здесь упора нет вовсе: чем дальше оттянуто, тем туже идёт.
//
// ⚠️ Двигаем ВНУТРЕННЮЮ обёртку, а не контейнер прокрутки: сдвиг контейнера утащил бы и его
// края, и полосу прокрутки — на iOS едет именно содержимое.

// Предел упругости — доля высоты окна прокрутки. У Apple он тоже пропорционален размеру:
// в маленькой панели большая оттяжка выглядела бы поломкой раскладки.
const LIMIT_RATIO = 0.14;
// Жёсткость: меньше — туже резинка. 0.5 близко к ощущению UIScrollView.
const STIFFNESS = 0.5;
const RETURN_MS = 420;
const IDLE_MS = 80;

function rubberBand(raw: number, limit: number): number {
  const sign = raw < 0 ? -1 : 1;
  const x = Math.abs(raw);
  return sign * (1 - 1 / ((x * STIFFNESS) / limit + 1)) * limit;
}

export function useRubberBand(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // ⚠️ Внутреннюю обёртку ищем В МОМЕНТ СОБЫТИЯ, а не при подписке. Раздел настроек
    // пересоздаётся при переключении, и запомненная ссылка указывала бы на выброшенный
    // узел — ровно поэтому резинка срабатывала один раз и умирала.
    const innerOf = (): HTMLElement | null => box.firstElementChild as HTMLElement | null;

    let raw = 0;
    let idle = 0;
    let returning = false;

    const draw = (): void => {
      const inner = innerOf();
      if (!inner) return;
      const limit = Math.max(60, box.clientHeight * LIMIT_RATIO);
      const offset = rubberBand(raw, limit);
      inner.style.transform = raw ? `translate3d(0, ${(-offset).toFixed(2)}px, 0)` : '';
    };

    const release = (): void => {
      if (!raw) return;
      raw = 0;
      const inner = innerOf();
      if (!inner) return;
      returning = true;
      inner.style.transition = `transform ${RETURN_MS}ms cubic-bezier(0.16, 1, 0.3, 1)`;
      inner.style.transform = '';
      window.setTimeout(() => {
        const cur = innerOf();
        if (cur) cur.style.transition = '';
        returning = false;
      }, RETURN_MS + 20);
    };

    const onWheel = (e: WheelEvent): void => {
      const atTop = box.scrollTop <= 0;
      const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 1;
      const beyond = (e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom);

      // Внутри содержимого не вмешиваемся: обычная прокрутка должна остаться обычной.
      if (!beyond) { if (raw) release(); return; }

      e.preventDefault();
      if (returning) {
        const inner = innerOf();
        if (inner) inner.style.transition = '';
        returning = false;
      }

      raw += e.deltaY;
      draw();
      window.clearTimeout(idle);
      idle = window.setTimeout(release, IDLE_MS);
    };

    box.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      box.removeEventListener('wheel', onWheel);
      window.clearTimeout(idle);
      const inner = innerOf();
      if (inner) { inner.style.transition = ''; inner.style.transform = ''; }
    };
  }, [ref]);
}
