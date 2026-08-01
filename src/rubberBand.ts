import { useEffect } from 'react';
import type { RefObject } from 'react';

// ── Пружинистая отдача при прокрутке, как в iOS ───────────────────────────────
//
// Chromium на Windows такого не умеет: `overscroll-behavior` только ГАСИТ эффекты, а
// собственной резинки у платформы нет. Поэтому делаем сами — но строго на границах и
// строго трансформом, чтобы не трогать вёрстку и не мешать обычной прокрутке.
//
// ⚠️ Двигаем ВНУТРЕННЮЮ обёртку, а не сам контейнер прокрутки: сдвиг контейнера утащил бы
// вместе с содержимым и его края, и полосу прокрутки — на iOS едет именно содержимое.

// Дальше этого не оттянуть: за пределом жест перестаёт читаться как отдача и выглядит
// поломкой раскладки.
const MAX_PULL = 56;
// Возврат — заметно длиннее оттягивания: быстрый отскок ощущается как щелчок, а не как пружина.
const RETURN_MS = 340;
// Пауза без событий колеса, после которой считаем жест законченным.
const IDLE_MS = 90;

export function useRubberBand(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const box = ref.current;
    const inner = box?.firstElementChild as HTMLElement | null;
    if (!box || !inner) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let pull = 0;
    let idle = 0;
    let returning = false;

    const draw = (): void => {
      inner.style.transform = pull ? `translateY(${(-pull).toFixed(1)}px)` : '';
    };

    const release = (): void => {
      if (!pull) return;
      returning = true;
      inner.style.transition = `transform ${RETURN_MS}ms var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1))`;
      pull = 0;
      draw();
      window.setTimeout(() => { inner.style.transition = ''; returning = false; }, RETURN_MS + 20);
    };

    const onWheel = (e: WheelEvent): void => {
      const atTop = box.scrollTop <= 0;
      const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 1;
      const beyond = (e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom);

      // Внутри содержимого не вмешиваемся вообще — обычная прокрутка должна остаться обычной.
      if (!beyond) { if (pull) release(); return; }

      e.preventDefault();
      if (returning) { inner.style.transition = ''; returning = false; }

      // Затухание: чем дальше оттянуто, тем меньше даёт следующий тик. Без него содержимое
      // уезжало бы линейно и упиралось в потолок рывком.
      pull += (e.deltaY * 0.45) / (1 + Math.abs(pull) / 60);
      pull = Math.max(-MAX_PULL, Math.min(MAX_PULL, pull));
      draw();

      window.clearTimeout(idle);
      idle = window.setTimeout(release, IDLE_MS);
    };

    box.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      box.removeEventListener('wheel', onWheel);
      window.clearTimeout(idle);
      inner.style.transition = '';
      inner.style.transform = '';
    };
  }, [ref]);
}
