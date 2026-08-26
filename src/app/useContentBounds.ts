import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

/**
 * Главный стык чрома с main: измеряем «дырку» под контент и сообщаем, куда положить
 * WebContentsView активной вкладки. React рисует рамку, main кладёт в неё вью.
 *
 * Наружу отдаётся `contentRef` — ссылка на сам элемент-дырку: его же меряет сплит-жест и
 * держит разметка.
 *
 * ⚠️ Вызывать РАНЬШЕ всех, кому нужен `contentRef`. Порядок эффектов при этом безразличен:
 * замер живёт в useLayoutEffect и потому выполняется до любого useEffect в App.
 */
export function useContentBounds(activeId: string, isHub: boolean) {
  const contentRef = useRef<HTMLDivElement>(null);

  // Отсечение повторов: pushBounds дёргается из ResizeObserver, window.resize и нескольких
  // эффектов сразу, и они регулярно приходят с ОДНИМ И ТЕМ ЖЕ прямоугольником. Каждое сообщение
  // заставляет main синхронно переставлять WebContentsView активной вкладки (см. чек-лист
  // производительности: «главный поток заблокирован» + «чрезмерный IPC»), поэтому молчание при
  // отсутствии изменений — не микрооптимизация, а снятие лишней работы с main-потока.
  const lastContentBoundsRef = useRef('');
  const sendContentBounds = useCallback((b: { x: number; y: number; width: number; height: number }) => {
    const key = `${b.x},${b.y},${b.width},${b.height}`;
    if (key === lastContentBoundsRef.current) return;
    lastContentBoundsRef.current = key;
    void window.oblako.setContentBounds(b);
  }, []);

  // Callback стабилен (deps=[]): всё, что ему нужно, он читает из DOM в момент вызова.
  const pushBounds = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    // Загрузки теперь такая же псевдо-вкладка, как История и Настройки (view: null в
    // TabManager, приём хаба): activate() сам прячет ранее показанную реальную вьюху, и
    // отдельное «спрятать контент нулевыми bounds» для оверлея больше не нужно.
    const r = el.getBoundingClientRect();
    // Дропдаун омнибокса больше НЕ резервирует место — нативная вью (SuggestDropdownManager.ts)
    // плавает поверх контента как самостоятельный оверлей (native z-order, addChildView), контенту
    // сдвигаться незачем (заход 5: устранена дублирующая система, см. Toolbar.tsx).
    // ⚠️ Резерва под запрос разрешения здесь больше НЕТ. Приглашение переехало в собственную
    // WebContentsView поверх страницы (electron/PermissionPopoverManager.ts) — раньше оно
    // откусывало 64 px сверху и роняло вёрстку живой страницы вниз-вверх на каждый вопрос.
    sendContentBounds({ x: r.left, y: r.top, width: r.width, height: r.height });
  }, [sendContentBounds]);

  useLayoutEffect(() => {
    pushBounds();
    const ro = new ResizeObserver(pushBounds);
    if (contentRef.current) ro.observe(contentRef.current);
    window.addEventListener('resize', pushBounds);
    return () => { ro.disconnect(); window.removeEventListener('resize', pushBounds); };
  }, [pushBounds]);

  // когда переключаемся между хабом/страницей/псевдо-вкладкой (История/Настройки), геометрия
  // дырки та же, но main должен переотобразить вьюху — пушим bounds ещё раз. activeId один уже
  // покрывает переключение НА/С Истории и Настроек (это теперь обычная смена activeId, не
  // отдельное состояние) — специальных эффектов под них больше не нужно.
  useEffect(() => { pushBounds(); }, [activeId, isHub, pushBounds]);

  return contentRef;
}
