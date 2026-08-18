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
const LIMIT_RATIO = 0.08;
// Жёсткость: МЕНЬШЕ — туже резинка, оттянуть труднее. Первая версия стояла на 0.5, и одного
// щелчка колеса хватало, чтобы выбросить ленту почти на весь ход.
const STIFFNESS = 0.3;
// Пауза без событий колеса, после которой считаем жест законченным. Держать её короткой
// нельзя: щелчки колеса идут с промежутком в сотню миллисекунд, и лента успевала отскочить
// назад между ними — от этого дёрганья и раздражение.
const IDLE_MS = 170;
// Постоянная времени оттяжки. ⚠️ Считается через exp(−dt/τ), а не «доля за кадр»: покадровый
// коэффициент привязывает скорость к частоте экрана — на 144 Гц то же движение шло втрое
// быстрее, а на просадке кадров проваливалось. Именно отсюда бралась рваность.
const PULL_TAU_MS = 95;
// Возврат — НЕ асимптотика, а анимация с концом. Прежний покадровый лерп (0.085) полз к нулю
// около 950 мс и обрывался жёсткой отсечкой на 0.25 px: хвост тянулся дольше, чем всё
// движение до него. Длительность берём из токенов движения (--dur-base/--dur-slow) и мерим
// от величины оттяжки — маленькой возвращаться долго незачем.
const BACK_MIN_MS = 140;
const BACK_MAX_MS = 260;

function rubberBand(raw: number, limit: number): number {
  const sign = raw < 0 ? -1 : 1;
  const x = Math.abs(raw);
  return sign * (1 - 1 / ((x * STIFFNESS) / limit + 1)) * limit;
}

// Форма --ease-out (var(--ease-out)): резкий старт, тихий хвост. Точную безье в
// JS считать незачем — четвёртая степень повторяет её с точностью до пикселя (в середине
// пути расхождение меньше сотой доли хода).
function easeOut(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv * inv;
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
    let last = 0;      // время предыдущего кадра — оттяжка считается по реальному dt
    // Идущий возврат: откуда начали, когда и за сколько. Заводится в момент отпускания и
    // живёт до нуля; новый щелчок колеса его отменяет прямо посреди пути.
    let back: { from: number; start: number; dur: number } | null = null;

    // ⚠️ Нарисованное ДОГОНЯЕТ натяжение покадрово, а не ставится сразу. Колесо мыши шлёт
    // рывками по ~100 px за щелчок, и мгновенное применение выбрасывало ленту на треть хода
    // одним кадром — это и ощущалось резко. Здесь любой ввод, хоть дискретный, превращается
    // в непрерывное движение.
    const tick = (now: number): void => {
      const inner = innerOf();
      if (!inner) { raf = 0; return; }
      const limit = Math.max(28, box.clientHeight * LIMIT_RATIO);

      if (target !== 0) {
        back = null;
        // ⚠️ dt подрезаем: после пропущенных кадров (или возврата на вкладку) разница бывает
        // в сотни миллисекунд, и лента прыгнула бы к натяжению одним скачком.
        const dt = last ? Math.min(now - last, 50) : 16.7;
        const want = rubberBand(target, limit);
        shown += (want - shown) * (1 - Math.exp(-dt / PULL_TAU_MS));
      } else {
        if (!back) {
          const reach = Math.min(1, Math.abs(shown) / limit);
          back = { from: shown, start: now, dur: BACK_MIN_MS + (BACK_MAX_MS - BACK_MIN_MS) * reach };
        }
        const t = Math.min(1, (now - back.start) / back.dur);
        shown = back.from * (1 - easeOut(t));
        if (t >= 1) {
          // Конец назначен временем, а не порогом близости к нулю: ленте нечего доползать.
          shown = 0; back = null; last = 0; raf = 0;
          inner.style.transform = '';
          return;
        }
      }

      last = now;
      inner.style.transform = `translate3d(0, ${(-shown).toFixed(2)}px, 0)`;
      raf = requestAnimationFrame(tick);
    };

    const kick = (): void => { if (!raf) raf = requestAnimationFrame(tick); };

    // ⚠️ Резинка НЕ для колеса мыши, и это не настройка вкуса, а свойство ввода. На iOS и macOS
    // она работает потому, что палец и тачпад дают непрерывный поток мелких смещений: лента
    // тянется ровно за рукой и отпускается вместе с ней. Колесо шлёт РЫВКИ по ~100 px с паузами
    // в сотню миллисекунд — тянуть за них нечего, и любая физика поверх этого выглядит как
    // подёргивание: оттянулось на щелчок, постояло, отскочило. Сколько ни крути коэффициенты,
    // непрерывности из дискретного ввода не получится.
    //
    // Признак непрерывного ввода: deltaMode в пикселях И небольшой шаг. Щелчок колеса на Windows
    // приходит как ~100 px (или вовсе в строках, deltaMode=1), тачпад — десятками мелких дельт.
    const isContinuous = (e: WheelEvent): boolean => e.deltaMode === 0 && Math.abs(e.deltaY) < 60;

    const onWheel = (e: WheelEvent): void => {
      if (!isContinuous(e)) { if (target) { target = 0; kick(); } return; }
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
