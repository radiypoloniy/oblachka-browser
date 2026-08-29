import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

// Ширина развёрнутого сайдбара. ⚠️ Вилка узкая намеренно: сайдбар — не панель контента, а
// полоса вкладок, и её ширина решает ровно одно — сколько букв заголовка помещается в строку.
// Ниже 200 подписи вырождаются в «Как приго…», выше 420 полоса начинает соперничать со
// страницей за место, ради которого её и сужают. 256 — прежнее жёсткое значение, оно же дефолт.
const SIDEBAR_W_MIN = 200;
const SIDEBAR_W_MAX = 420;
const SIDEBAR_W_DEFAULT = 256;
const SIDEBAR_W_KEY = 'oblako-sidebar-width';

// Насколько ручка ширины выходит ЗА правую кромку сайдбара. Равно --gutter-shell: ровно столько
// между сайдбаром и карточкой контента, то есть полоса захвата доходит до её левого края — до
// единственной видимой границы в этом месте, за которую человек и тянет. Больше нельзя: дальше
// начинается нативная вью страницы, куда события мыши DOM'а не доходят.
export const SIDEBAR_HANDLE_OUTSET = 12;

function loadSidebarWidth(): number {
  try {
    const raw = Number(localStorage.getItem(SIDEBAR_W_KEY));
    if (Number.isFinite(raw) && raw > 0) return Math.min(SIDEBAR_W_MAX, Math.max(SIDEBAR_W_MIN, raw));
  } catch { /* приватный режим/выключенный storage — просто дефолт */ }
  return SIDEBAR_W_DEFAULT;
}

/**
 * Ширина сайдбара и жест её изменения: тяга за ручку у правой кромки, двойной щелчок — вернуть
 * дефолт, запись на диск в конце жеста.
 */
export function useSidebarWidth(): {
  width: number;
  /** На ручку у правой кромки — начинает тягу. */
  onHandlePointerDown: (e: ReactPointerEvent) => void;
  /** На неё же — возвращает ширину по умолчанию. */
  onHandleDoubleClick: () => void;
} {
  const [width, setWidth] = useState<number>(loadSidebarWidth);

  // ⚠️ Ширину двигаем на pointermove по документу, а не по самой ручке: увести курсор за пределы
  // тонкой полоски проще простого, и без захвата на документе перетаскивание рвалось бы на
  // первом же быстром движении. setPointerCapture тут не годится — ручка живёт внутри области
  // с window-drag («drag»), и захват конфликтует с перетаскиванием окна.
  const dragW = useRef<{ startX: number; startW: number } | null>(null);

  // Свежая ширина для обработчика отпускания: тот заведён один раз и замкнул бы стартовое значение.
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const d = dragW.current;
      if (!d) return;
      e.preventDefault();
      const next = Math.min(SIDEBAR_W_MAX, Math.max(SIDEBAR_W_MIN, d.startW + (e.clientX - d.startX)));
      setWidth(next);
    };
    const onUp = (): void => {
      if (!dragW.current) return;
      dragW.current = null;
      document.body.style.cursor = '';
      // Пишем на диск ТОЛЬКО в конце жеста: на каждое движение это была бы сотня записей в секунду.
      try { localStorage.setItem(SIDEBAR_W_KEY, String(widthRef.current)); } catch { /* см. loadSidebarWidth */ }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
  }, []);

  return {
    width,
    onHandlePointerDown: (e) => {
      e.preventDefault();
      dragW.current = { startX: e.clientX, startW: width };
      document.body.style.cursor = 'col-resize';
    },
    onHandleDoubleClick: () => {
      setWidth(SIDEBAR_W_DEFAULT);
      try { localStorage.setItem(SIDEBAR_W_KEY, String(SIDEBAR_W_DEFAULT)); } catch { /* см. loadSidebarWidth */ }
    },
  };
}
