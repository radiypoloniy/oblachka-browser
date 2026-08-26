import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { X } from 'lucide-react';
import Sidebar, { FaviconTile } from './components/Sidebar';
import Toolbar from './components/Toolbar';
import Hub from './components/Hub';
import TabError from './components/TabError';
import Settings from './components/Settings';
import HistoryBookmarks from './components/HistoryBookmarks';
import ImportDialog from './components/ImportDialog';
import Onboarding from './components/Onboarding';
import { islandPlate, chromeTintStyle, tintedPlateVars, chromeSpaceStyle } from './styles/island';
import { useSplitPanelDrag } from './app/useSplitPanelDrag';
import { useContentBounds } from './app/useContentBounds';
import { useTabOrganizer } from './app/useTabOrganizer';
import { useAiPanel } from './app/useAiPanel';
import { useBrowserModel } from './app/useBrowserModel';
import { useSidebarCollapse } from './app/useSidebarCollapse';
import { useSplitDivider } from './app/useSplitDivider';
import { useDownloads } from './app/useDownloads';
import { usePageTranslate } from './app/usePageTranslate';
import { useVpnConnection } from './app/useVpnConnection';
import { useChromeAppearance } from './app/useChromeAppearance';
import { watchGenClocks } from './newtab/genClocks';
import { setDesktopProfile } from './newtab/desktop';
import ProfilePicker from './components/ProfilePicker';
import { isDarkTheme } from '../shared/ipc';
import type { TabState, ThemePrefs } from '../shared/ipc';
import { ISLAND_GAP, SHELL_MARGIN, SPLIT_HEADER_HEIGHT, SPLIT_PANE_INSET, SPLIT_PANE_RADIUS } from '../shared/layout';
import { RADIUS } from './styles/system';


// «Остров» позади реальной вкладки (обычная страница/её ошибка, не hub) — та же плашка,
// что уже рисуют History/Settings/Bookmarks под собой (radius-island/shadow-island,
// CONTENT_CORNER_RADIUS в TabManager.ts). Реальная WebContentsView кладётся сверху
// main-процессом ровно на тот же прямоугольник и непрозрачна — плашку целиком закрывает,
// снаружи виден только хвост тени в margin:var(--gutter-shell) вокруг contentRef (и, в
// split-режиме, в ISLAND_GAP между панелями). Hub сюда не входит намеренно: он прозрачный
// по задумке (цветной --canvas просвечивает сквозь него), сплошная подложка убила бы этот
// эффект — у Hub своя эстетика, не «страница».
const TAB_FRAME_VISUAL: CSSProperties = {
  ...islandPlate,
  borderRadius: 'var(--radius-island)',
  boxShadow: 'var(--shadow-island)',
  background: 'var(--surface-solid)',
  overflow: 'hidden',
};

// Одиночная вкладка: плашка сама себе абсолютно спозиционированный слой позади контента,
// pointer-events:none — она никогда не должна перехватывать клики (TabError включает их себе
// обратно явно, см. TabError.tsx).
const TAB_FRAME_STYLE: CSSProperties = {
  position: 'absolute', inset: 0,
  ...TAB_FRAME_VISUAL,
  pointerEvents: 'none',
};

// Полоса заголовка над split-панелью (favicon+title+×) — сидит в верхних SPLIT_HEADER_HEIGHT
// px родительского TAB_FRAME_VISUAL, которые TabManager (getTabViewBounds/repositionViews)
// больше не отдаёт под контентную WebContentsView (см. shared/layout.ts). Клик по пустому месту
// всплывает к onClick панели (фокус), крестик сам себя останавливает и зовёт closeTab — тот же
// путь, что и обычное закрытие вкладки (TabManager.closeTab уже схлопывает сплит через exitSplit,
// отдельного пути не заводим).
//
// ⚠️ Своей нижней границы у шапки НЕТ, и это не упущение: страница лежит карточкой внутри панели
// (см. shared/layout.ts::SPLIT_PANE_INSET), и границу рисует кант этой карточки — чуть ниже.
// Прямая линия над кантом дублировала бы её и упиралась в скругление.
//
// Шапка — она же РУЧКА панели: за неё половину сплита перетаскивают на вторую панель (поменять
// местами) или в сайдбар (разорвать сплит). Логика жеста — в App (handlePanelDrag*).
//
// dragging — страницу этого острова несут в руке. Тогда шапка пустеет: см. ниже, почему это
// правильно и почему при этом сама полоса обязана остаться.
function SplitPanelHeader({ tab, active, onClose, dragging, dragHandlers }: {
  tab: TabState;
  active: boolean;
  onClose: () => void;
  dragging: boolean;
  dragHandlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
    // ⚠️ Страховка от залипшей подсветки: если капчур теряется НЕ через pointerup (alt-tab,
    // контекстное меню, прерывание системой), ни up, ни cancel на шапку не приходят — а подсветку
    // сплита гасит только endPanelDrag. Тогда её снимает этот обработчик. На обычном pointerup он
    // тоже сработает (капчур освобождается следом), но endPanelDrag идемпотентен — второй вызов
    // выходит сразу (ref уже обнулён).
    onLostPointerCapture: (e: React.PointerEvent) => void;
  };
}) {
  return (
    <div
      {...dragHandlers}
      style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: SPLIT_HEADER_HEIGHT,
        display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px',
        cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none',
      }}
    >
      {/* ⚠️ Пока страницу несут, на её острове НЕ ОСТАЁТСЯ НИЧЕГО от неё: ни значка, ни имени, ни
          крестика. Иначе пустой слот выглядит полноценной панелью, у которой почему-то пропало
          содержимое, — а на самом деле вся эта страница сейчас в руке, на карточке под курсором.
          ⚠️ Сама полоса при этом остаётся в DOM всегда, и это не формальность: на ней держится
          setPointerCapture. Убери мы её вместе с содержимым — жест оборвался бы на полуслове, а
          вместе с ним и возврат скрытой вьюхи (страница осталась бы невидимой). */}
      {!dragging && <FaviconTile tab={tab} size={12} />}
      {/* Активная панель заявляет о себе и текстом, не только кантом: цвет и насыщенность — тот
          же приём, что у активной вкладки в сайдбаре, одно правило на оба места. */}
      {!dragging && (
        <span style={{
          flex: 1, minWidth: 0, fontSize: 'var(--fs-xs)',
          fontWeight: active ? 600 : 500,
          color: active ? 'var(--text-strong)' : 'var(--text-body)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          transition: 'color var(--dur-fast) var(--ease-standard)',
        }}>{tab.title || tab.url || 'Загрузка…'}</span>
      )}
      {!dragging && (
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          title="Закрыть"
          style={{
            border: 'none', background: 'transparent', cursor: 'default', padding: 2,
            borderRadius: RADIUS.tight, display: 'inline-flex', flex: 'none', color: 'var(--text-faint)',
          }}
        ><X size={12} /></button>
      )}
    </div>
  );
}

// Прямоугольник страницы внутри split-панели — тот же, что main отдаёт вьюхе
// (TabManager.#splitPaneBounds). Нужен дважды: под кант карточки и под страницу ошибки, которая
// обязана лежать ровно там, где лежала бы страница.
const SPLIT_PANE_RECT: CSSProperties = {
  position: 'absolute',
  top: SPLIT_HEADER_HEIGHT + SPLIT_PANE_INSET, left: SPLIT_PANE_INSET,
  right: SPLIT_PANE_INSET, bottom: SPLIT_PANE_INSET,
  borderRadius: SPLIT_PANE_RADIUS,
};

// Кант страницы внутри split-панели — граница между ней и панелью (страница лежит карточкой
// внутри, см. shared/layout.ts::SPLIT_PANE_INSET). Всегда нейтральный: какая половина активна,
// говорит обводка ВСЕГО острова (splitPanelStyle ниже), а не эта линия.
//
// ⚠️ Рисуется box-shadow'ом СНАРУЖИ прямоугольника карточки. Внутрь рисовать бесполезно: там
// лежит нативная вью страницы, она поверх React-слоя и закрыла бы любую рамку.
//
// empty — страницу несут в руке, обводить нечего: форму пустого слота держит кант самого острова
// (splitPanelStyle), а вторая линия внутри пустоты читалась бы как разметка неизвестно чего.
function SplitPaneEdge({ empty }: { empty: boolean }) {
  if (empty) return null;
  return (
    <div style={{ ...SPLIT_PANE_RECT, pointerEvents: 'none', boxShadow: '0 0 0 1px var(--divider)' }} />
  );
}

// Остров split-панели: активную обводим целиком — вместе с полосой заголовка, потому что заголовок
// и страница это ОДИН остров, и обводка вокруг одной страницы читалась как рамка не пойми чего.
//
// ⚠️ Кант — снаружи прямоугольника (box-shadow без inset): внутри его закрыла бы нативная вью
// страницы, а снаружи он ложится в межостровный зазор (ISLAND_GAP = 10px, места хватает).
//
// empty — страницу этого острова сейчас несут в руке (см. panelDrag). Тогда остров обязан выглядеть
// ПУСТЫМ, а не полноценной панелью, у которой почему-то пропало содержимое: заливка становится
// прозрачной (сквозь неё работает стекло islandPlate — backdrop-filter никуда не делся), тень
// уходит (то, что не floats, не должно и отбрасывать), активная обводка тоже — она про «сюда идёт
// ввод», а в пустой слот ввод не идёт.
//
// ⚠️ Гасить остров целиком через opacity было бы проще, но неправильно: вместе с заливкой погас бы
// и кант, и на светлой теме слот стал бы неотличим от фона окна — пустая рамка превратилась бы в
// «поехавшую раскладку». Поэтому кант, наоборот, остаётся в полную силу и держит форму слота.
const splitPanelStyle = (active: boolean, flex: number, empty: boolean): CSSProperties => ({
  ...TAB_FRAME_VISUAL,
  position: 'relative', flex, minWidth: 0,
  ...(empty
    ? {
      background: 'color-mix(in srgb, var(--surface-solid) 32%, transparent)',
      boxShadow: 'inset 0 0 0 1px var(--divider)',
    }
    : {
      boxShadow: active
        ? 'var(--shadow-island), 0 0 0 1.5px color-mix(in srgb, var(--accent) 45%, transparent)'
        : 'var(--shadow-island)',
    }),
  transition: 'box-shadow var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard)',
});

export default function App() {
  console.log('[renderer-alive] App смонтирован')

  useEffect(() => watchGenClocks(), []);
  // ⚠️ Спрашиваем только в главном окне и только один раз за запуск: карточка выбора в каждом
  // новом окне была бы уже не помощью, а препятствием.
  const [pickerDone, setPickerDone] = useState(false);

  // ⚠️ Стол принадлежит профилю (см. setDesktopProfile). Слушаем здесь, а не в DesktopScreen:
  // тот монтируется только на новой вкладке, а знать активный профиль надо с самого старта —
  // иначе первая же открытая новая вкладка успеет показать чужой стол.
  useEffect(() => {
    void window.oblako.getProfiles().then((p) => setDesktopProfile(p.activeId));
    return window.oblako.onProfilesChanged((p) => setDesktopProfile(p.activeId));
  }, []);

  // ⚠️ Модель браузера — ПЕРВОЙ среди хуков: от activeIncognito зависит тема, от activeId —
  // замер области контента, от tabs/nodes — жест сплита и группировка (разбор — в шапке хука).
  const {
    tabs, sidebarNodes, activeId, splitRatio,
    hasOrganizeSnapshot, hasRenameSnapshot,
    active, activeIncognito, isHub, tabError, kind,
    splitLeft, splitRight, isSplit,
    select, newTab, close, submit, openSpecial, enterSplit, setSplitRatio,
  } = useBrowserModel();

  // Роль своего окна (см. shared/ipc.ts::WindowRole). Спрашивается один раз: окно не меняет роль
  // за свою жизнь. До ответа считаем окно полным — это состояние живёт доли секунды и только в
  // главном окне выглядит правильно; в лёгком лишние кнопки просто исчезнут первым же ответом.
  const [isLightWindow, setIsLightWindow] = useState(false);
  const vpnConn = useVpnConnection();
  const { pageTranslateState, pageTranslateProgress } = usePageTranslate();
  const { downloads, downloadsActive, downloadsProgress, downloadStartTick } = useDownloads();
  // Оформление (см. ThemePrefs в shared/ipc.ts). Владеет значением main — оно на диске и одно на
  // все окна; здесь только копия для отрисовки. До первого ответа держим светлую — она же дефолт
  // настроек, поэтому мигания «тёмная → светлая» на старте не будет.
  const [themePrefs, setThemePrefs] = useState<ThemePrefs>({ mode: 'light', palette: 'charcoal', systemDark: false });
  const dark = isDarkTheme(themePrefs);
  // Импорт данных из другого браузера — модалка поверх всего chrome. 'manual' — открыта кнопкой
  // из настроек, 'onboarding' — авто-предложение первого запуска (мягче тон + «Пропустить»),
  // null — закрыта. См. ImportDialog.tsx / electron/browserImport/.
  const [importDialog, setImportDialog] = useState<'manual' | null>(null);
  // Открытый раздел настроек, по id вкладки. ⚠️ Живёт ЗДЕСЬ, а не в самом Settings: вкладка
  // настроек — псевдо-вкладка, её компонент размонтируется при уходе на другую вкладку и уносит
  // свой стейт, из-за чего человек каждый раз возвращался на верхний раздел. App.tsx — корень
  // хрома, он переживает переключение вкладок. По id, а не одним значением: вкладок настроек
  // можно открыть несколько, и у каждой своё место. В main это НЕ уезжает — контракт IPC ради
  // такого не трогаем, а дальше перезапуска помнить и нечего: псевдо-вкладки в сессию не идут.
  const [settingsSection, setSettingsSection] = useState<Record<string, string>>({});
  // Экран первого запуска — рассказ о браузере + перенос данных (см. Onboarding.tsx). Отдельно
  // от importDialog: тот остался ручным импортом из настроек, с другим тоном и объёмом.
  const [onboarding, setOnboarding] = useState(false);

  // AI-хаб (заход 3): правый док вместо поповера — открытость, ширина и её делитель.
  const {
    aiPanelOpen, aiPanelWidth, isAiPanelDragging,
    aiPanelContainerRef, toggleAiPanel,
    handleAiDividerPointerDown, handleAiDividerPointerMove, handleAiDividerPointerUp,
  } = useAiPanel();

  // Снимки для отката живут в main, сюда приезжают синхронизацией (см. applySync ниже) — поэтому
  // они принадлежат App, а не флоу группировки: тот их только читает.

  // AI-группировка: предложить группы, применить, назвать вкладки и откатить любую половину.
  const {
    organizeTabsCount, organizeState, organizeLongWait, organizeProposal,
    renameProgress, undoDismissed, dismissUndo,
    handleOrganize, handleOrganizeApply, handleOrganizeCancel,
    handleOrganizeRollback, handleRenameRollback, handleRollbackAll,
  } = useTabOrganizer({ tabs, sidebarNodes, hasOrganizeSnapshot, hasRenameSnapshot });

  // Схлопывание сайдбара: выбор человека и принудительное схлопывание на узком окне.
  const { collapsed: sidebarCollapsed, setCollapsed: setSidebarCollapsed } = useSidebarCollapse();

  const omniboxRef = useRef<HTMLInputElement>(null);

  // ⚠️ ПРЕДОХРАНИТЕЛЬ ОТ ДРОПА ФАЙЛА В САМ ИНТЕРФЕЙС. Слой хрома — обычная веб-страница, и по
  // умолчанию Chromium на брошенный файл её ПЕРЕОТКРЫВАЕТ: у нас это означало голое окно без
  // вкладок и адресной строки (а в худшем случае — подмену самого интерфейса браузера файлом).
  // Ни одного места, где такой жест что-то осмысленно значит, в чроме нет: адресная строка
  // обрабатывает дроп сама и до сюда его не пускает (stopPropagation), перетаскивание вкладок
  // живёт на pointer-событиях dnd-kit и HTML5-драга не использует вовсе. Поэтому здесь глухая
  // заглушка, а не разбор случаев.
  useEffect(() => {
    const swallow = (e: DragEvent) => { e.preventDefault(); };
    document.addEventListener('dragover', swallow);
    document.addEventListener('drop', swallow);
    return () => {
      document.removeEventListener('dragover', swallow);
      document.removeEventListener('drop', swallow);
    };
  }, []);

  useEffect(() => {
    window.oblako.getWindowRole()
      .then((role) => setIsLightWindow(role === 'light'))
      .catch(() => { /* роль не пришла — остаёмся полным окном, как было до многооконности */ });
  }, []);

  // Выбор темы живёт в main (settings.json): читаем при старте и слушаем изменения — их шлёт и
  // соседнее окно, где человек ткнул настройку, и сама система при смене светлой/тёмной.
  useEffect(() => {
    void window.oblako.getTheme().then(setThemePrefs).catch(() => { /* останемся на светлой */ });
    return window.oblako.onThemeChanged(setThemePrefs);
  }, []);

  // ⚠️ Вызов стоит ИМЕННО ЗДЕСЬ, и это несущее: тема, земля и полоса системных кнопок связаны
  // порядком эффектов, а порядок задаётся местом вызова хука (разбор — в шапке useChromeAppearance).
  // Выше по файлу — состояние темы, ниже — разметка, которая эту землю рисует.
  const ground = useChromeAppearance(dark, activeIncognito, themePrefs.palette);

  // Онбординг: однократное предложение импорта из другого браузера при первом запуске (если на
  // диске реально найден источник). shouldOfferImport вернёт false после первого показа (флаг
  // importOffered в SettingsManager) и при отсутствии источников. Помечаем показанным сразу —
  // чтобы не всплывать повторно, даже если пользователь просто закрыл окно. Модалка ложится поверх
  // Хаба (первый запуск = активна вкладка Хаба, контент-область не перекрыта WebContentsView).
  useEffect(() => {
    let cancelled = false;
    void window.oblako.shouldShowOnboarding().then((show) => {
      if (cancelled || !show) return;
      setOnboarding(true);
      void window.oblako.markOnboardingShown();
    });
    return () => { cancelled = true; };
  }, []);

  // Подписки на разные push-события хрома — один раз на маунт. FindBar (открытие/закрытие/
  // результат) сюда больше не входит — переехал в отдельную WebContentsView, см.
  // electron/FindBarManager.ts (main сам решает, когда её показать/спрятать/куда слать счётчик).
  useEffect(() => {
    const unsubOmnibox = window.oblako.onOmniboxFocus(() => {
      omniboxRef.current?.focus();
      omniboxRef.current?.select();
    });

    // Ctrl+H — та же псевдо-вкладка, что и иконка в сайдбаре (см. onHistory prop у Sidebar
    // ниже): всегда создаёт новую (простая, предсказуемая семантика, как у обычного createTab —
    // без «переключиться на уже открытую, если есть»).
    const unsubHistory = window.oblako.onHistoryOpen(() => {
      void openSpecial('history');
    });

    const unsubDownloadsOpen = window.oblako.onDownloadsOpen(() => {
      void openSpecial('downloads');
    });

    return () => {
      unsubOmnibox();
      unsubHistory(); unsubDownloadsOpen();
    };
  }, []);

  // Замер «дырки» под контент и отправка её в main — стык, на котором держится показ страниц.
  // ⚠️ Вызов стоит ДО useSplitPanelDrag: тот меряет contentRef, который заводит этот хук.
  const contentRef = useContentBounds(activeId, isHub);

  // Делитель между половинами сплита. Стоит ПОСЛЕ замера: жест меряет ту же область контента.
  const {
    isDragging, handleDividerPointerDown, handleDividerPointerMove, handleDividerPointerUp,
  } = useSplitDivider({ contentRef, onRatio: setSplitRatio });

  // Перетаскивание половины сплита за её шапку — жест целиком в useSplitPanelDrag, там же разбор,
  // почему это pointer capture и почему карточку в руке рисует оверлей, а не чром.
  const {
    leftPanelRef, rightPanelRef, panelDrag, headerLeft, headerRight,
    handlePanelDragPointerDown, handlePanelDragPointerMove,
    handlePanelDragPointerUp, handlePanelDragPointerCancel,
  } = useSplitPanelDrag({ splitLeft, splitRight, isSplit, contentRef });

  return (
    // ⚠️ Цветной фон рисуется ЗДЕСЬ, одним слоем на всё окно. Раньше он жил в Sidebar.tsx и
    // красил только сайдбар — из-за чего тот и выглядел боковой плашкой: цветной прямоугольник
    // слева, серое окно справа. Подкраска это свойство ОКНА, а не панели: одна земля от края до
    // края, под сайдбаром и в зазорах вокруг страницы, а острова лежат на ней сверху.
    // --sidebar-plate (фон выделенных элементов) и --plate-* ставятся тем же слоем: они
    // наследуются вниз сами, и протаскивать флаг через каждый уровень не нужно.
    <div style={{
      position: 'fixed', inset: 0, display: 'flex', overflow: 'hidden',
      // Цветная земля несёт зерно сама; обычная получает его здесь — иначе фактура доставалась
      // бы только тем, кто включил подкраску (разбор — chromeGrainStyle в styles/island.ts).
      // Пространство рисуется ВСЕГДА; цветная подкраска — усиленный вариант того же маршрута.
      ...(ground ? chromeTintStyle(ground.backgroundImage, ground.paintLayers, dark || activeIncognito, ground.top) : chromeSpaceStyle(dark || activeIncognito)),
      ...(ground ? tintedPlateVars(ground.island, dark || activeIncognito) : null),
      ['--sidebar-plate' as string]: ground ? ground.island : 'var(--surface)',
    }}>
      {/* Оверлей во время drag разделителя: держит col-resize курсор по всей ширине
          и служит страховкой на случай если setPointerCapture не перехватит события
          над нативными WebContentsViews. */}
      {(isDragging || isAiPanelDragging) && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          cursor: 'col-resize', userSelect: 'none',
        }} />
      )}
      {/* AI-группировка вкладок живёт в приложении в одном экземпляре и принадлежит полному окну,
          поэтому в лёгком её кнопки нет: organizeTabsCount=0 гасит её тем же условием, что и
          «вкладок слишком мало» (см. Sidebar.tsx). */}
      <Sidebar
        tabs={tabs} activeId={activeId}
        collapsed={sidebarCollapsed}
        onCollapsedChange={setSidebarCollapsed}
        onSelect={select} onClose={close} onNewTab={newTab} onNewTabMenu={() => { void window.oblako.showNewTabMenu(); }}
        onTabMenu={(id) => { void window.oblako.showTabMenu(id); }}
        onSplit={(id) => enterSplit(id)}
        onExitSplit={(tabId) => { void window.oblako.exitSplit(tabId); }}
        onSettings={() => void openSpecial('settings')}
        onHistory={() => void openSpecial('history')}
        onReorder={(section, ids) => { void window.oblako.reorderTabs(section, ids); }}
        onMoveSection={(tabId, section, idx) => { void window.oblako.moveTabSection(tabId, section, idx); }}
        sidebarNodes={sidebarNodes}
        onDropOnContent={enterSplit}
        returnHint={panelDrag?.zone === 'sidebar'}
        organizeTabsCount={isLightWindow ? 0 : organizeTabsCount}
        organizeState={organizeState}
        organizeLongWait={organizeLongWait}
        organizeProposal={organizeProposal}
        hasOrganizeSnapshot={hasOrganizeSnapshot}
        hasRenameSnapshot={hasRenameSnapshot}
        renameProgress={renameProgress}
        undoDismissed={undoDismissed}
        onRenameRollback={handleRenameRollback}
        onRollbackAll={handleRollbackAll}
        onDismissUndo={dismissUndo}
        onOrganize={handleOrganize}
        onOrganizeApply={handleOrganizeApply}
        onOrganizeCancel={handleOrganizeCancel}
        onOrganizeRollback={handleOrganizeRollback}
      />
      {!pickerDone && !isLightWindow && <ProfilePicker onDone={() => setPickerDone(true)} />}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Toolbar
          tab={active} allTabs={tabs} vpnOn={vpnConn?.state === 'running'}
          isLightWindow={isLightWindow}
          omniboxRef={omniboxRef}
          onBack={() => window.oblako.goBack(activeId)}
          onForward={() => window.oblako.goForward(activeId)}
          onReload={() => window.oblako.reload(activeId)}
          onSubmit={submit}
          onSuggestToggle={(open) => {
            // Заход 5: единственная система дропдауна — нативная вью (SuggestDropdownManager.ts),
            // старый React-портал удалён вместе с резервом места под него (см. pushBounds выше).
            void window.oblako.setSuggestDropdownOpen(open);
          }}
          downloadsActive={downloadsActive}
          downloadsProgress={downloadsProgress}
          downloadStartTick={downloadStartTick}
          onToggleAiPanel={toggleAiPanel}
          aiPanelOpen={aiPanelOpen}
          pageTranslateState={pageTranslateState}
          pageTranslateProgress={pageTranslateProgress}
        />
        {/* Строка контент+док: contentRef (в неё же меряет pushBounds) + разделитель + spacer
            AI-дока (заход 3). Spacer ничего не рисует — реальный контент дока рисует main
            отдельной WebContentsView поверх этой же зарезервированной области (тот же приём,
            что и с вкладками: React рисует дырку, main кладёт вьюху). pushBounds НЕ меняется —
            contentRef и так становится у́же благодаря соседям по флексу. */}
        <div ref={aiPanelContainerRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row' }}>
        {/* Контент-зона. Варианты: хаб, страница ошибки, split, "дырка" (WebContentsView).
            Margin — единственный источник воздуха: pushBounds меряет getBoundingClientRect()
            этого div, суженный margin'ом прямоугольник уезжает в main как есть, без правки
            формул bounds. Слева/сверху/снизу — всегда --gutter-shell (как у острова сайдбара).
            Справа — условно (заход 1, зазоры): при закрытой AI-панели тот же --gutter-shell
            до края окна; при открытой — 0, потому что зазор до AI-острова теперь целиком
            в DOM-хэндле (ISLAND_GAP, ниже), лишние 12px тут были бы паразитной прибавкой. */}
        <div ref={contentRef} style={{
          flex: 1, minWidth: 0, minHeight: 0, position: 'relative',
          marginTop: 'var(--gutter-shell)', marginBottom: 'var(--gutter-shell)', marginLeft: 'var(--gutter-shell)',
          marginRight: aiPanelOpen ? 0 : SHELL_MARGIN,
        }}>
          {kind === 'history' || kind === 'bookmarks' || kind === 'downloads' ? (
            // Загрузки теперь третья секция того же острова, а не свой экран — см. HistoryBookmarks.
            // ⚠️ section перекрывает kind: так «Что я отслеживаю» открывается существующим видом
            // вкладки ('history') с секцией 'tracking' — новый вид попал бы в session.json, а
            // менять формат сессии с реальными вкладками человека ради одного экрана несоразмерно.
            <HistoryBookmarks defaultSection={(active?.section as typeof kind) ?? kind} downloads={downloads} onClose={() => void window.oblako.closeTab(activeId)} />
          ) : kind === 'settings' ? (
            <Settings
              // Раздел берём из своей памяти, если человек уже щёлкал по меню в ЭТОЙ вкладке;
              // иначе — тот, с которым вкладку открыли (кнопка «+» AI-панели открывает сразу 'ai').
              defaultSection={settingsSection[activeId] ?? active?.section}
              onSectionChange={(s) => setSettingsSection((prev) => ({ ...prev, [activeId]: s }))}
              onClose={() => void window.oblako.closeTab(activeId)}
              onOpenImport={() => setImportDialog('manual')}
            />
          ) : isSplit ? (
            <div style={{ display: 'flex', height: '100%' }}>
              {/* Левая панель — flex: splitRatio даёт долю от (ширина - ISLAND_GAP). Тот же остров,
                  что у одиночной вкладки (TAB_FRAME_STYLE) — каждая split-половина сама себе
                  «вкладка», bounds считает TabManager.applySplitBounds по этому же прямоугольнику. */}
              <div
                ref={leftPanelRef}
                style={splitPanelStyle(
                  activeId === headerLeft!.id, splitRatio,
                  panelDrag?.tabId === headerLeft!.id,
                )}
                onClick={() => {
                  if (activeId !== splitLeft!.id) void window.oblako.focusSplitPanel('left');
                }}
              >
                <SplitPanelHeader
                  tab={headerLeft!} onClose={() => close(headerLeft!.id)}
                  active={activeId === headerLeft!.id}
                  dragging={panelDrag?.tabId === headerLeft!.id}
                  dragHandlers={{
                    onPointerDown: handlePanelDragPointerDown(
                      headerLeft!.id, headerRight!.id, 'left',
                      headerLeft!.title || headerLeft!.url || 'Вкладка', headerLeft!.faviconUrl,
                    ),
                    onPointerMove: handlePanelDragPointerMove,
                    onPointerUp: handlePanelDragPointerUp,
                    onPointerCancel: handlePanelDragPointerCancel,
                    onLostPointerCapture: handlePanelDragPointerCancel,
                  }}
                />
                <SplitPaneEdge empty={panelDrag?.tabId === headerLeft!.id} />
                {/* Страница ошибки — тоже содержимое этой вкладки, поэтому и она следует за
                    заголовком (headerLeft, не splitLeft: на время превью они меняются местами) и
                    исчезает, пока страницу несут. */}
                {panelDrag?.tabId !== headerLeft!.id && headerLeft!.tabError && (
                  <div style={{ ...SPLIT_PANE_RECT, overflow: 'hidden' }}>
                    <TabError error={headerLeft!.tabError} url={headerLeft!.url}
                      onRetry={() => void window.oblako.reload(headerLeft!.id)}
                      canGoBack={headerLeft!.canGoBack}
                      onBack={() => void window.oblako.goBack(headerLeft!.id)} />
                  </div>
                )}
              </div>

              {/* Разделитель: ISLAND_GAP шириной, хват — капсула-грип по центру (не линия
                  во всю высоту — читается как ручка, не как шов). Колонка/хит-зона/pointer-
                  логика не менялись, поменялась только отрисовка внутри. */}
              <div
                style={{
                  flex: 'none', width: ISLAND_GAP, position: 'relative',
                  cursor: 'col-resize', userSelect: 'none',
                }}
                onPointerDown={handleDividerPointerDown}
                onPointerMove={handleDividerPointerMove}
                onPointerUp={handleDividerPointerUp}
                onPointerCancel={handleDividerPointerUp}
              >
                <div style={{
                  position: 'absolute', top: '50%', left: '50%',
                  width: 4, height: 32, transform: 'translate(-50%, -50%)',
                  borderRadius: RADIUS.pill, background: 'var(--divider-strong)', pointerEvents: 'none',
                }} />
              </div>

              {/* Правая панель — тот же остров, что у левой (TAB_FRAME_VISUAL). */}
              <div
                ref={rightPanelRef}
                style={splitPanelStyle(
                  activeId === headerRight!.id, 1 - splitRatio,
                  panelDrag?.tabId === headerRight!.id,
                )}
                onClick={() => {
                  if (activeId !== splitRight!.id) void window.oblako.focusSplitPanel('right');
                }}
              >
                <SplitPanelHeader
                  tab={headerRight!} onClose={() => close(headerRight!.id)}
                  active={activeId === headerRight!.id}
                  dragging={panelDrag?.tabId === headerRight!.id}
                  dragHandlers={{
                    onPointerDown: handlePanelDragPointerDown(
                      headerRight!.id, headerLeft!.id, 'right',
                      headerRight!.title || headerRight!.url || 'Вкладка', headerRight!.faviconUrl,
                    ),
                    onPointerMove: handlePanelDragPointerMove,
                    onPointerUp: handlePanelDragPointerUp,
                    onPointerCancel: handlePanelDragPointerCancel,
                    onLostPointerCapture: handlePanelDragPointerCancel,
                  }}
                />
                <SplitPaneEdge empty={panelDrag?.tabId === headerRight!.id} />
                {panelDrag?.tabId !== headerRight!.id && headerRight!.tabError && (
                  <div style={{ ...SPLIT_PANE_RECT, overflow: 'hidden' }}>
                    <TabError error={headerRight!.tabError} url={headerRight!.url}
                      onRetry={() => void window.oblako.reload(headerRight!.id)}
                      canGoBack={headerRight!.canGoBack}
                      onBack={() => void window.oblako.goBack(headerRight!.id)} />
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Обычный режим: хаб (прозрачный, без острова), либо реальная вкладка —
               остров-подложка позади неё (см. TAB_FRAME_STYLE) плюс ошибка поверх, если есть. */
            isHub
              ? <Hub
                  tabId={activeId} onSubmit={submit} isLightWindow={isLightWindow}
                  onOpenHistory={() => void openSpecial('history')}
                  onOpenSettings={() => void openSpecial('settings')}
                />
              : (
                <div style={TAB_FRAME_STYLE}>
                  {tabError && (
                    <TabError
                      error={tabError}
                      url={active?.url ?? ''}
                      onRetry={() => window.oblako.reload(activeId)}
                      canGoBack={active?.canGoBack ?? false}
                      onBack={() => void window.oblako.goBack(activeId)}
                    />
                  )}
                </div>
              )
          )}
          {/* ⚠️ Подсказки «куда отпустить вкладку» здесь НЕТ и быть не может: нативная вью
              страницы лежит поверх React-слоя, и всё, что чром рисует в области контента,
              физически не видно. Зоны рисует своя прозрачная вью поверх страницы — см.
              electron/DropZoneManager.ts и src/dropzones.tsx. */}

          {/* ⚠️ Запроса разрешений здесь тоже нет — по той же причине, что и зон дропа выше:
              он рисуется своей вью поверх страницы (electron/PermissionPopoverManager.ts). */}
        </div>

        {/* Разделитель + spacer AI-дока — только когда док открыт. Та же схема pointer capture,
            что у split-разделителя выше, ширина — от правого края aiPanelContainerRef.
            Ширина = ISLAND_GAP: хэндл занимает весь межостровный зазор split↔AI целиком
            (contentRef справа больше воздуха не даёт, см. marginRight выше). Капсула-грип по
            центру — та же отрисовка, что у split-разделителя (не линия во всю высоту).
            drag-математика ниже (handleAiDividerPointerMove) считает по абсолютной позиции
            курсора от правого края контейнера — ширины хэндла не касается, чувствительность
            ресайза не меняется. */}
        {aiPanelOpen && (
          <>
            <div
              style={{
                flex: 'none', width: ISLAND_GAP, position: 'relative',
                cursor: 'col-resize', userSelect: 'none',
              }}
              onPointerDown={handleAiDividerPointerDown}
              onPointerMove={handleAiDividerPointerMove}
              onPointerUp={handleAiDividerPointerUp}
              onPointerCancel={handleAiDividerPointerUp}
            >
              <div style={{
                position: 'absolute', top: '50%', left: '50%',
                width: 4, height: 32, transform: 'translate(-50%, -50%)',
                borderRadius: RADIUS.pill, background: 'var(--divider-strong)', pointerEvents: 'none',
              }} />
            </div>
            <div style={{ flex: 'none', width: aiPanelWidth }} />
          </>
        )}
        </div>
      </div>

      {/* Диалог импорта из другого браузера — модалка поверх всего chrome (fixed). Открывается
          только из раздела настроек «Браузер»: первый запуск теперь ведёт Onboarding ниже. */}
      {importDialog && <ImportDialog onClose={() => setImportDialog(null)} />}

      {/* ⚠️ Карточки перетаскиваемой панели здесь НЕТ намеренно: чром лежит под нативными вьюхами
          страниц, и стоило курсору уехать вверх, к тулбару, как низ карточки скрывался под
          страницей — она будто проваливалась внутрь. Всю картинку жеста рисует оверлей, который на
          это время растянут на всё окно (src/dropzones.tsx, electron/DropZoneManager.ts). */}

      {/* Экран первого запуска. Поверх всего и без закрытия кликом мимо — см. Onboarding.tsx. */}
      {onboarding && <Onboarding onFinish={() => setOnboarding(false)} />}
    </div>
  );
}
