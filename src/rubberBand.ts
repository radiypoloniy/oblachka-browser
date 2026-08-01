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
// Предел упругости — доля высоты окна прокрутки. У Apple он тоже пропорционален размеру:
// в маленькой панели большая оттяжка выглядела бы поломкой раскладки.
const LIMIT_RATIO = 0.08;
// Жёсткость: МЕНЬШЕ — туже резинка, оттянуть труднее. Первая версия стояла на 0.5, и одного
// щелчка колеса хватало, чтобы выбросить ленту почти на весь ход.
const STIFFNESS = 0.3;
// Пауза без событий колеса, после которой считаем жест законченным. Держать её короткой
// нельзя: щелчки колеса идут с промежутком в сотню миллисекунд, и лента успевала отскочить
// назад между ними — от этого дёрганья и раздражение.
const IDLE_MS = 170;
// Насколько быстро нарисованное догоняет натяжение. Оттяжка — живее, возврат — заметно
// мягче: одинаковые скорости давали ощущение щелчка, а не пружины.
const EASE_PULL = 0.16;
const EASE_BACK = 0.085;

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

    let target = 0;    // накопленное натяжение (сырые дельты колеса)
    let shown = 0;     // то, что нарисовано на экране
    let raf = 0;
    let idle = 0;

    // ⚠️ Нарисованное ДОГОНЯЕТ натяжение покадрово, а не ставится сразу. Колесо мыши шлёт
    // рывками по ~100 px за щелчок, и мгновенное применение выбрасывало ленту на треть хода
    // одним кадром — это и ощущалось резко. Здесь любой ввод, хоть дискретный, превращается
    // в непрерывное движение.
    const tick = (): void => {
      const inner = innerOf();
      if (!inner) { raf = 0; return; }
      const limit = Math.max(28, box.clientHeight * LIMIT_RATIO);
      const want = rubberBand(target, limit);
      shown += (want - shown) * (target === 0 ? EASE_BACK : EASE_PULL);

      if (target === 0 && Math.abs(shown) < 0.25) {
        shown = 0;
        inner.style.transform = '';
        raf = 0;
        return;
      }
      inner.style.transform = `translate3d(0, ${(-shown).toFixed(2)}px, 0)`;
      raf = requestAnimationFrame(tick);
    };

    const kick = (): void => { if (!raf) raf = requestAnimationFrame(tick); };

    const onWheel = (e: WheelEvent): void => {
      const atTop = box.scrollTop <= 0;
      const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 1;
      const beyond = (e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom);

      // Внутри содержимого не вмешиваемся: обычная прокрутка должна остаться обычной.
      if (!beyond) { if (target) { target = 0; kick(); } return; }

      e.preventDefault();
      target += e.deltaY;
      kick();
      window.clearTimeout(idle);
      idle = window.setTimeout(() => { target = 0; kick(); }, IDLE_MS);
    };

    box.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      box.removeEventListener('wheel', onWheel);
      window.clearTimeout(idle);
      if (raf) cancelAnimationFrame(raf);
      const inner = innerOf();
      if (inner) { inner.style.transition = ''; inner.style.transform = ''; }
    };
  }, [ref]);
}
