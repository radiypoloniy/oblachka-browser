import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

// Пороги схлопывания. ⚠️ Живут здесь, а не в Toolbar.tsx: они читаются ТОЛЬКО из замеров ниже, и
// разъехаться с ними не должны — иначе капсула складывается не тогда, когда ей тесно.
export const CAPSULE_FULL_THRESHOLD = 380;
export const CAPSULE_HIDE_THRESHOLD = 200;
const PLACEHOLDER_HIDE_THRESHOLD = 200;
const PLACEHOLDER_SHOW_THRESHOLD = 220;

export type CapsuleMode = 'full' | 'compact' | 'hidden';

export interface OmniboxGeometry {
  /** Ширина всего тулбара — от неё зависит режим VPN-пилюли. */
  toolbarWidth: number;
  /** Ширина «таблетки» омнибокса — от неё зависят пороги внутри неё. */
  omniboxWidth: number;
  /** Режим капсулы поисковика. Приоритет у поля ввода: капсула схлопывается первой. */
  capsuleMode: CapsuleMode;
  /** Показывать ли подсказку в пустом поле (гистерезис, чтобы не мигала). */
  placeholderVisible: boolean;
  /** Послать прямоугольник таблетки в main вручную — там, где размер не менялся, а место изменилось. */
  pushOmniboxBounds: () => void;
}

/**
 * Замеры омнибокса и тулбара плюс отправка геометрии в main.
 *
 * ⚠️ Ширина ИЗМЕРЯЕТСЯ, а не вычисляется. Её задаёт flex, и оценивать её формулой значило бы
 * держать вторую, неизбежно расходящуюся правду. Обратной связи на раскладку нет: ширину диктует
 * родитель (flex + maxWidth), содержимое таблетки на неё не влияет (minWidth: 0), поэтому запись
 * измерения в состояние не может запустить цикл «измерил → перерисовал → измерил другое».
 *
 * ⚠️ Пуш геометрии в main нужен дропдауну подсказок: он живёт отдельной WebContentsView и встаёт
 * ПОД таблеткой. ResizeObserver ловит изменение РАЗМЕРА, но не чистое смещение: сворачивание
 * сайдбара двигает тулбар по X, а ширина таблетки при этом может не измениться. Отсюда второй
 * эффект — на toolbarWidth, который меняется во всех трёх случаях.
 *
 * ⚠️ Повтор отсекается сравнением с последним ОТПРАВЛЕННЫМ значением: замер показал ровно два
 * одинаковых сообщения подряд на каждое изменение, а каждое такое сообщение синхронно двигает
 * вью дропдауна в main. Сравнение именно с отправленным, не с текущим DOM: при перезагрузке
 * чрома ref обнулится и первый пуш уйдёт в любом случае.
 */
export function useOmniboxGeometry(
  toolbarRef: RefObject<HTMLDivElement | null>,
  omniboxPillRef: RefObject<HTMLDivElement | null>,
): OmniboxGeometry {
  const [toolbarWidth, setToolbarWidth] = useState(1280);
  const [omniboxWidth, setOmniboxWidth] = useState(0);
  const [placeholderVisible, setPlaceholderVisible] = useState(true);
  const lastBoundsRef = useRef('');

  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const update = () => setToolbarWidth(el.offsetWidth);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, [toolbarRef]);

  const pushOmniboxBounds = useCallback(() => {
    const el = omniboxPillRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Тот же замер обслуживает и пороги схлопывания внутри таблетки.
    setOmniboxWidth(r.width);
    const b = { x: r.left, y: r.top, width: r.width, height: r.height };
    const key = `${b.x},${b.y},${b.width},${b.height}`;
    if (key === lastBoundsRef.current) return;
    lastBoundsRef.current = key;
    void window.oblako.setOmniboxBounds(b);
  }, [omniboxPillRef]);

  useEffect(() => {
    const el = omniboxPillRef.current;
    if (!el) return;
    pushOmniboxBounds();
    const ro = new ResizeObserver(pushOmniboxBounds);
    ro.observe(el);
    return () => ro.disconnect();
  }, [omniboxPillRef, pushOmniboxBounds]);

  useEffect(() => {
    pushOmniboxBounds();
  }, [toolbarWidth, pushOmniboxBounds]);

  // Гистерезис плейсхолдера: прячем когда поле узкое, возвращаем с запасом.
  useEffect(() => {
    if (omniboxWidth < PLACEHOLDER_HIDE_THRESHOLD) setPlaceholderVisible(false);
    else if (omniboxWidth >= PLACEHOLDER_SHOW_THRESHOLD) setPlaceholderVisible(true);
    // в зоне [200, 220) — не меняем, чтобы не мигало
  }, [omniboxWidth]);

  const capsuleMode: CapsuleMode = omniboxWidth >= CAPSULE_FULL_THRESHOLD ? 'full'
    : omniboxWidth >= CAPSULE_HIDE_THRESHOLD ? 'compact'
      : 'hidden';

  return { toolbarWidth, omniboxWidth, capsuleMode, placeholderVisible, pushOmniboxBounds };
}
