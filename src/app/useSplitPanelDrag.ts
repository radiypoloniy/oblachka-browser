// Перетаскивание половины сплита за её шапку.
// Жест живёт в рабочей области, а не в сайдбаре: тянешь панель за шапку и либо кладёшь на
// вторую панель (половины меняются местами), либо уводишь в сайдбар (сплит разрывается, обе
// вкладки остаются, активной становится ТА, которую не тащили). Всё прочее — отмена.
//
// ⚠️ Почему setPointerCapture, а не dnd-kit и не опрос курсора в main. Капчур удерживает
// pointermove в чроме даже когда курсор ушёл над нативные вьюхи страниц (в Electron/Aura все
// вьюхи в одном HWND) — на этом же держится разделитель сплита в App.tsx. Значит зону считает сам
// renderer, по clientX/clientY, и вся правда о геометрии остаётся там, где её и меряют.
//
// ⚠️ А вот РИСУЕТ всё оверлей, растянутый на время жеста на всё окно (DropZoneManager): и
// подсветку панелей, и карточку в руке. Своей карточки у чрома нет намеренно — он лежит ПОД
// нативными вьюхами страниц, и стоило курсору уехать вверх, к тулбару, как низ карточки уходил
// под страницу, будто она в неё провалилась.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type { ContentBounds, SplitSwapHint, TabState } from '../../shared/ipc';
import { SPLIT_DRAG_CARD_CAPTURE_WIDTH, SPLIT_DRAG_CARD_CAPTURE_MAX_HEIGHT } from '../components/SplitDragCard';

/**
 * Жест перетаскивания половины сплита за шапку. Отдаёт наружу ссылки на обе панели (по ним
 * снимается геометрия цели), состояние жеста для подкраски шапок и обводки сайдбара, пару
 * заголовков в порядке предпросмотра и четыре обработчика указателя для шапки панели.
 */
export function useSplitPanelDrag(opts: {
  splitLeft: TabState | undefined;
  splitRight: TabState | undefined;
  /** Пара распалась посреди жеста — жест обрывается вместе с ней. */
  isSplit: boolean;
  /** Область контента: её левый край отделяет рабочую зону от острова сайдбара. */
  contentRef: RefObject<HTMLDivElement | null>;
}) {
  const { splitLeft, splitRight, isSplit, contentRef } = opts;

  const leftPanelRef  = useRef<HTMLDivElement>(null);
  const rightPanelRef = useRef<HTMLDivElement>(null);
  // Живое состояние жеста — в ref: обработчик зовётся десятки раз в секунду, и решение о зоне не
  // должно зависеть от того, успел ли перерисоваться React. Прямоугольники снимаются ОДИН раз, на
  // старте: за время жеста раскладка не меняется, а getBoundingClientRect на каждое движение
  // заставлял бы браузер считать layout заново.
  const panelDragRef = useRef<{
    tabId: string;
    siblingId: string;
    side: 'left' | 'right';       // какую половину тащат — цель это ВТОРАЯ
    title: string;                // бланк карточки; берётся на старте, дальше не меняется
    favicon: string | null;
    otherRect: DOMRect | null;    // панель-цель, координаты окна
    contentLeft: number;          // левый край области контента — левее него только остров сайдбара
    hint: SplitSwapHint | null;   // готовый payload подсветки, пересылается при смене зоны
    startX: number; startY: number;
    x: number; y: number;
    started: boolean;
    zone: 'swap' | 'sidebar' | null;
    cursorFrame: number | null;   // rAF: курсор уходит в main не чаще кадра
    thumb: string | null;         // снимок панели; приходит позже начала жеста, см. ниже
  } | null>(null);
  // Чрому от жеста нужно немногое: подкрасить шапку несомой панели и обвести сайдбар, когда
  // отпускание вернёт половину туда. Карточку и подсветку панелей рисует оверлей.
  const [panelDrag, setPanelDrag] = useState<
    { tabId: string; zone: 'swap' | 'sidebar' | null } | null
  >(null);

  // ⚠️ Пока превью показывает обмен, местами меняются и ЗАГОЛОВКИ. Страницы переезжает main
  // (нативные вьюхи), а шапки рисует React — не поменяй мы их, под шапкой одной страницы стояла бы
  // другая, и предпросмотр врал бы именами. Слоты при этом остаются на месте: превью — это картина
  // будущего, а не досрочная правка модели.
  const previewSwap = panelDrag?.zone === 'swap';
  const headerLeft  = previewSwap ? splitRight : splitLeft;
  const headerRight = previewSwap ? splitLeft  : splitRight;

  const endPanelDrag = useCallback((apply: boolean) => {
    const d = panelDragRef.current;
    panelDragRef.current = null;
    if (!d?.started) {
      // ⚠️ Состояние в React чистим ВСЕГДА, даже когда обрывать нечего. Оно могло пережить
      // прошлый жест (см. страховку в pointerdown ниже), а тогда шапка остаётся пустой и
      // ненажимаемой на вид, хотя никакого жеста уже нет. Когда состояние и так пусто, вызов
      // бесплатен: React сравнивает значение и не перерисовывает.
      setPanelDrag(null);
      return;
    }
    if (d.cursorFrame !== null) cancelAnimationFrame(d.cursorFrame);
    setPanelDrag(null);
    window.oblako.sendSplitDragCursor(null);

    // ⚠️ ИСХОД — ПЕРВЫМ, снятие подсветки — вторым, и порядок тут не косметический. Раскладку
    // жеста в main держит то же сообщение, что и подсветку (см. SPLIT_SWAP_HINT): сними мы её
    // раньше, панели сначала прыгнули бы в исходное положение, и только потом применился бы
    // обмен — то есть на глазах уехало бы туда и обратно. А исход, наоборот, забирает раскладку
    // себе: он уже знает, что вторая панель стоит на новом месте.
    if (apply) {
      if (d.zone === 'swap')         void window.oblako.swapSplitPanels(d.tabId);
      else if (d.zone === 'sidebar') void window.oblako.exitSplit(d.tabId, d.siblingId);
    }
    void window.oblako.setSplitSwapHint(null);
  }, []);

  const handlePanelDragPointerDown = useCallback((
    tabId: string, siblingId: string, side: 'left' | 'right', title: string, favicon: string | null,
  ) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    // Крестик в шапке — своя кнопка, драг с неё не начинаем.
    if ((e.target as HTMLElement).closest('button')) return;
    // ⚠️ ПРОШЛЫЙ ЖЕСТ ЗАКРЫВАЕМ ЯВНО, а не затираем ссылкой ниже. Затирание молча теряло его:
    // React-состояние оставалось «эту панель несут» (шапка пустая, на вид неактивная), в main
    // оставалась раскладка жеста, а следующий pointerup выходил сразу — у свежей записи
    // started === false. Дальше залипание жило до разрыва сплита. Тот же приём, что у
    // перетаскивания вкладки (DropZoneManager::startTabDrag первой строкой зовёт stopDrag) и что
    // у страховки в TabManager::applyPanelDragLayout — теперь он есть на обоих концах.
    if (panelDragRef.current) endPanelDrag(false);
    // ⚠️ Без preventDefault: он гасит совместимостные mouse-события, а вместе с ними рискует унести
    // и click — а клик по шапке обязан по-прежнему фокусировать панель (onClick рамки). Выделение
    // текста при протяжке снимает userSelect:'none' на самой шапке, отдельный preventDefault не нужен.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    panelDragRef.current = {
      tabId, siblingId, side, title, favicon,
      otherRect: null, contentLeft: 0, hint: null,
      startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY,
      started: false, zone: null, cursorFrame: null, thumb: null,
    };

    // ⚠️ Снимок панели заказываем УЖЕ на нажатии, до порога начала драга. capturePage ждёт
    // следующего скомпонованного кадра (в ScreenshotManager.ts это записано замером: на
    // загруженной машине заметно), и закажи мы его в момент старта — карточка появлялась бы с
    // опозданием ровно тогда, когда человек ждёт отклика. Цена — один лишний снимок на клик по
    // шапке (клик фокусирует панель): он ничего не блокирует и никуда не уходит, кроме мусора.
    void window.oblako.captureSplitPane(
      tabId, SPLIT_DRAG_CARD_CAPTURE_WIDTH, SPLIT_DRAG_CARD_CAPTURE_MAX_HEIGHT,
    ).then((thumb) => {
      const d = panelDragRef.current;
      if (!d || d.tabId !== tabId || !thumb) return;
      d.thumb = thumb;
      // Драг мог начаться раньше, чем пришёл снимок — тогда карточка подменяет подпись на ходу.
      if (d.started) window.oblako.sendSplitDragThumb(thumb);
    });
  }, [endPanelDrag]);

  const handlePanelDragPointerMove = useCallback((e: ReactPointerEvent) => {
    const d = panelDragRef.current;
    if (!d) return;
    d.x = e.clientX;
    d.y = e.clientY;

    if (!d.started) {
      // Порог, как у остальных драгов в проекте: клик по шапке (фокус панели) не должен
      // становиться перетаскиванием.
      if (Math.abs(e.clientX - d.startX) < 5 && Math.abs(e.clientY - d.startY) < 5) return;
      d.started = true;
      const other = (d.side === 'left' ? rightPanelRef : leftPanelRef).current;
      d.otherRect   = other?.getBoundingClientRect() ?? null;
      d.contentLeft = contentRef.current?.getBoundingClientRect().left ?? 0;
      // Координаты окна как есть: оверлей на время жеста растянут на всё окно (см. SplitSwapHint).
      const toRect = (r: DOMRect): ContentBounds =>
        ({ x: r.left, y: r.top, width: r.width, height: r.height });
      d.hint = d.otherRect
        ? { tabId: d.tabId, target: toRect(d.otherRect), title: d.title, favicon: d.favicon, zone: null }
        : null;
      if (d.hint) void window.oblako.setSplitSwapHint(d.hint);
      // Снимок мог прийти ДО начала жеста — тогда оверлея ещё не существовало и сообщение о нём
      // было бы выброшено. Отправляем сразу после подсветки, которая эту вью и поднимает.
      if (d.thumb) window.oblako.sendSplitDragThumb(d.thumb);
      setPanelDrag({ tabId: d.tabId, zone: null });
    }

    // ⚠️ Курсор вне окна — исхода нет. Капчур продолжает слать нам события и за краем окна, и без
    // этой проверки «утащил половину влево за пределы окна» попадало бы в ветку сайдбара
    // (clientX < 0) и рвало сплит. Вынести половину в новое окно этот жест не умеет — значит
    // снаружи он не делает ничего.
    const inWindow = e.clientX >= 0 && e.clientY >= 0
      && e.clientX <= window.innerWidth && e.clientY <= window.innerHeight;
    const r = d.otherRect;
    const zone: 'swap' | 'sidebar' | null = !inWindow ? null
      : r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom
        ? 'swap'
        // Левее области контента в окне нет ничего, кроме острова сайдбара.
        : e.clientX < d.contentLeft ? 'sidebar'
        : null;

    if (zone !== d.zone) {
      d.zone = zone;
      if (d.hint) {
        d.hint = { ...d.hint, zone };
        void window.oblako.setSplitSwapHint(d.hint);
      }
      setPanelDrag({ tabId: d.tabId, zone });
    }

    // Курсор — в main не чаще кадра: он идёт потоком, а нужен ровно для того, чтобы карточка ехала
    // за рукой. Один send на кадр драга дешевле, чем рывки вместо анимации.
    if (d.cursorFrame === null) {
      d.cursorFrame = requestAnimationFrame(() => {
        const cur = panelDragRef.current;
        if (!cur) return;
        cur.cursorFrame = null;
        window.oblako.sendSplitDragCursor({ x: cur.x, y: cur.y });
      });
    }
  }, []);

  const handlePanelDragPointerUp     = useCallback(() => endPanelDrag(true),  [endPanelDrag]);
  const handlePanelDragPointerCancel = useCallback(() => endPanelDrag(false), [endPanelDrag]);

  // Пара исчезла посреди жеста (страница закрыла себя, вкладку убили из другого окна) — обрываем
  // драг вместе с ней: иначе на отпускании исход применился бы к паре, которой уже нет, а оверлей
  // остался бы висеть поверх страницы и глотать клики.
  useEffect(() => {
    if (!panelDrag || isSplit) return;
    endPanelDrag(false);
  }, [panelDrag, isSplit, endPanelDrag]);

  return {
    leftPanelRef, rightPanelRef,
    panelDrag,
    headerLeft, headerRight,
    handlePanelDragPointerDown,
    handlePanelDragPointerMove,
    handlePanelDragPointerUp,
    handlePanelDragPointerCancel,
  };
}
