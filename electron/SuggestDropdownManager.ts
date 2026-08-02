// Дропдаун подсказок омнибокса — отдельная WebContentsView-оверлей поверх страницы, под самим
// омнибоксом (не под всей контентной зоной, как FindBar). Единственная система дропдауна (заход 5:
// старый React-портал в Toolbar.tsx и резерв места под него — OMNIBOX_SUGGEST_RESERVE в App.tsx —
// удалены; контент вкладки больше никогда не двигается ради дропдауна, эта вью плавает поверх).
// Живые подсказки + мышиный выбор + клавиатурная подсветка (setHighlight ниже) — омнибокс остаётся
// ЕДИНСТВЕННЫМ владельцем selectedIdx, вью только рисует по номеру, Enter выполняется локально
// в омнибоксе без обращения к этой вью.
//
// ⚠️ ФОКУС. Эта вью НИКОГДА не вызывает webContents.focus() сама — фокус обязан жить в омнибоксе
// (другой webContents, chromeView). Но одного бездействия НЕДОСТАТОЧНО, и прежний комментарий
// здесь утверждал обратное («addChildView сам по себе OS-фокус не крадёт») — это неверно и
// противоречило main.ts, который тот же фокус вынужденно возвращал. Замер подтвердил: при показе
// дропдауна document.hasFocus() в чроме становится false.
//
// Первопричина — незакрытое ограничение самого Electron: electron/electron#42922 («Implement
// focusable in WebContentsView») открыт, реализации нет, и в его же постановке сказано, что
// способа держать две WebContentsView в одном окне без взаимного перехвата фокуса не существует.
// Отсюда единственная рабочая защита — СТРАЖ: подписка на событие 'focus' у этой вью, которая
// немедленно возвращает фокус чрому (приём из обсуждения того же issue). Он покрывает ВСЕ пути
// перехвата, а не только момент открытия, — прежняя точечная компенсация в main.ts не спасала,
// например, от клика по омнибоксу при уже открытом дропдауне.
//
// ⚠️ ПРИКРЕПЛЕНИЕ. Вью прикрепляется к окну ОДИН раз и больше не открепляется: показ/скрытие —
// это setVisible(), а не addChildView/removeChildView. Так убран и сам триггер перехвата фокуса,
// и путь с известными багами Electron (electron/electron#44652 — после removeChildView
// последующие add/remove начинают работать неправильно, вью залипают на экране).
//
// isAttached()-проверка по факту прикрепления вместо отдельного флага — тот же урок, что и в
// FindBarManager.ts (флаг мог разойтись с реальностью и ломать повторный показ).
//
// ⚠️ ДРОПДАУН — СВОЙ У КАЖДОГО ОКНА. Омнибокс есть в любом окне, и подсказки к нему принадлежат
// тому окну, где набирают: одна вью на приложение означала бы, что прямоугольник омнибокса из
// окна B двигает список, висящий над окном A, а выбранная строка уходит не в тот омнибокс.
// Состояние лежит в карте по id окна и умирает вместе с ним; вью создаётся лениво — на первый
// список подсказок, а не на открытие окна.
import { WebContentsView, ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import path from 'node:path'
import type { ContentBounds, SuggestDropdownItem } from '../shared/ipc'

const GAP = 4 // зазор между низом омнибокса и верхом дропдауна
// Заход 5 (кардинальный фикс): высота вью больше НЕ фиксирована. Стартовая высота — до первого
// реального замера от suggestdropdown.tsx (ResizeObserver → 'suggest-dropdown:height', тот же
// приём, что INITIAL_HEIGHT/translate-popover:height у TranslatePopoverManager.ts) — держим её
// маленькой (высота ~1 строки), а не старым потолком в 280: цель этого захода — не накрывать
// вью лишней площадью (мёртвая хит-тест-зона перехватывала клики по кнопкам/контенту под собой —
// pointer-events между разными WebContentsView не работает, см. прецедент AI-панели). Реальная
// высота прилетает почти сразу после показа (did-finish-load уже отрендерил список), поэтому
// стартовый флеш короткий и безвредный — тот же компромисс, что и у поповера.
const INITIAL_HEIGHT = 48
// Живой баг: тень выглядела «угловатой» и обрезанной — margin=16 был меньше реального охвата
// тени карточки (offset+blur = 10+28 = 38px, см. suggestdropdown.tsx). WebContentsView обрезает
// всё, что рисуется за границей своего прямоугольника — хвост тени срезался ровно по краю вью,
// что и давало жёсткий «прямоугольник-подложку» вместо мягкого растворения. TranslatePopoverManager.ts
// уже проходил через это же самое с той же тенью (см. его SHADOW_MARGIN=40) — берём то же значение.
// Держать в синхроне с SHADOW_MARGIN в src/suggestdropdown.tsx.
const SHADOW_MARGIN = 40

interface WindowDropdown {
  win: BrowserWindow
  view: WebContentsView | null
  resizeBound: boolean
  // Последний присланный прямоугольник омнибокса (см. IPC.OMNIBOX_SET_BOUNDS, main.ts).
  omniboxBounds: ContentBounds
  // Последняя реально измеренная высота карточки (см. 'suggest-dropdown:height' ниже) — вью
  // персистентна между показами (в отличие от поповера), поэтому переиспользуем последнее известное
  // значение при повторном открытии вместо того, чтобы каждый раз падать обратно на INITIAL_HEIGHT.
  height: number
  // Последний присланный список подсказок — переотправляется на did-finish-load, если вью ещё
  // не успела загрузиться к моменту первого sendSuggestItems() (см. ensureDropdownView).
  items: SuggestDropdownItem[]
}

const dropdowns = new Map<number, WindowDropdown>()
let ipcRegistered = false

function stateFor(win: BrowserWindow): WindowDropdown {
  const existing = dropdowns.get(win.id)
  if (existing) return existing
  const created: WindowDropdown = {
    win, view: null, resizeBound: false,
    omniboxBounds: { x: 0, y: 0, width: 0, height: 0 },
    height: INITIAL_HEIGHT, items: [],
  }
  dropdowns.set(win.id, created)
  win.once('closed', () => { dropdowns.delete(win.id) })
  return created
}

// Окно по вью-отправителю: каналы дропдауна общие на все окна, а BrowserWindow.fromWebContents
// для дочерней вью возвращает null (тот же случай, что в WindowRegistry.contextFromSender).
function stateBySender(sender: Electron.WebContents): WindowDropdown | null {
  for (const st of dropdowns.values()) if (st.view?.webContents === sender) return st
  return null
}

// Колбэк на клик по строке (см. ensureIpcRegistered) — main.ts подписывается один раз при
// старте и пересылает выбор в слой хрома ТОГО окна, где кликнули (та же связка, что
// setTabManager у AiPanelManager).
let onPickCb: ((win: BrowserWindow, item: SuggestDropdownItem) => void) | null = null

export function onPick(cb: (win: BrowserWindow, item: SuggestDropdownItem) => void): void {
  onPickCb = cb
}

// Страж фокуса (см. блок «ФОКУС» в шапке). main.ts передаёт сюда возврат фокуса чрому; вызывается
// на КАЖДЫЙ перехват, кем бы он ни был спровоцирован — загрузкой вью, показом, кликом мимо.
// Заменяет собой прежний onFirstLoad-костыль, который лечил лишь один частный случай (самый
// первый показ за жизнь окна).
let restoreChromeFocusCb: ((win: BrowserWindow) => void) | null = null

export function onFocusStolen(cb: (win: BrowserWindow) => void): void {
  restoreChromeFocusCb = cb
}

// Прикреплена ли вью к окну. С переходом на setVisible() это состояние стало почти вечным
// (прикрепили один раз — и до закрытия окна), но проверка по ФАКТУ, а не по флагу, остаётся:
// флаг уже однажды расходился с реальностью и ломал повторный показ (тот же урок, что в
// FindBarManager.ts).
function isAttached(st: WindowDropdown): boolean {
  return !!st.view && !st.win.isDestroyed() && st.win.contentView.children.includes(st.view)
}

function computeBounds(st: WindowDropdown, height: number): { x: number; y: number; width: number; height: number } {
  const ob = st.omniboxBounds
  const x = ob.x
  const y = ob.y + ob.height + GAP
  // Лог отсюда убран: функция зовётся на каждый OMNIBOX_SET_BOUNDS (ResizeObserver омнибокса) и
  // на каждый замер высоты — в проде это поток строк с содержимым адресной строки, см. CLAUDE.md
  // («уровни логирования; в prod — без URL/текстов»).
  return {
    x: x - SHADOW_MARGIN,
    y: y - SHADOW_MARGIN,
    width: ob.width + SHADOW_MARGIN * 2,
    height: height + SHADOW_MARGIN * 2,
  }
}

function layoutDropdown(st: WindowDropdown): void {
  if (!isAttached(st)) return
  st.view!.setBounds(computeBounds(st, st.height))
}

// Вызывается из main.ts на каждый OMNIBOX_SET_BOUNDS (см. Toolbar.tsx::omniboxPillRef) —
// та же геометрия, что двигает и старый chrome-DOM дропдаун (позиционирование от toolbarRef).
export function syncOmniboxBounds(win: BrowserWindow, b: ContentBounds): void {
  const st = stateFor(win)
  st.omniboxBounds = b
  layoutDropdown(st)
}

function ensureIpcRegistered(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  // Клик по строке во вью — просто пересылаем колбэку (main.ts форвардит в chromeView).
  // Не боевой канал (не в shared/ipc.ts) — это внутренняя механика ЭТОЙ вью, как и у
  // translate-popover:close/ai-panel:close (см. соответствующие *Manager.ts).
  ipcMain.on('suggest-dropdown:pick', (e, item: SuggestDropdownItem) => {
    const st = stateBySender(e.sender)
    if (st) onPickCb?.(st.win, item)
  })

  // Заход 5 — реальная высота карточки (ResizeObserver в suggestdropdown.tsx). Math.max(1, px) —
  // защита от абсурдных 0/отрицательных значений (карточка ещё не отрендерилась/офскрин), тот же
  // приём, что Math.max(INITIAL_HEIGHT, px) у translate-popover:height.
  ipcMain.on('suggest-dropdown:height', (e, px: number) => {
    const st = stateBySender(e.sender)
    if (!st) return
    st.height = Math.max(1, px)
    layoutDropdown(st)
  })
}

function ensureDropdownView(st: WindowDropdown): WebContentsView {
  if (st.view) return st.view
  ensureIpcRegistered()
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-suggestdropdown.js'),
      contextIsolation: true,
      sandbox: false, // preload использует ipcRenderer
    },
  })
  st.view = view
  // Обязателен на самой view (не только CSS background:transparent) — иначе виден непрозрачный
  // прямоугольник-подложка вокруг списка (тот же инвариант, что у FindBar/AI-панели/поповера).
  view.setBackgroundColor('#00000000')
  // Создаём скрытой: sendSuggestItems() может создать вью задолго до первого показа (список
  // подсказок приходит раньше решения показать дропдаун), а прикрепление теперь навсегда —
  // без этого вью мелькнула бы на экране до showSuggestDropdown().
  view.setVisible(false)
  // СТРАЖ ФОКУСА (см. шапку). Любой перехват фокуса этой вью — Electron не даёт его запретить
  // (#42922) — немедленно откатываем. setImmediate, а не синхронно: вернуть фокус нужно ПОСЛЕ
  // того, как Chromium доведёт до конца текущую передачу, иначе он перетрёт наш вызов своим же.
  // Фокус возвращаем в СВОЁ окно: перехват в одном окне не должен дёргать чром другого.
  view.webContents.on('focus', () => {
    setImmediate(() => restoreChromeFocusCb?.(st.win))
  })
  // Если sendSuggestItems() пришёл ДО того, как страница успела загрузиться, .send() тогда
  // ушёл бы в никуда (preload ещё не навесил ipcRenderer.on) — did-finish-load переотправляет
  // последний известный список явно, тем же приёмом, что 'findbar:show' в FindBarManager.ts.
  // ⚠️ Здесь НЕТ wc.focus() — единственное отличие от аналогичного момента в FindBarManager.ts.
  view.webContents.once('did-finish-load', () => {
    view.webContents.send('suggest-dropdown:items', st.items)
    // Живой баг: на тяжёлом старте (восстановление сессии из многих вкладок, индексация истории
    // и т.п. одновременно) дропдаун иногда вообще не был виден при первом же показе. Позиционируем
    // вью ЕЩЁ РАЗ по актуальным lastOmniboxBounds ровно в момент, когда страница реально
    // догрузилась — на случай, если самое первое showSuggestDropdown() успело отработать раньше,
    // чем сюда пришли верные данные (bounds ещё не долетели / высота ещё не измерена). Дёшево и
    // безопасно перевызвать даже если всё и так было правильно — тот же принцип, что у onFirstLoadCb
    // ниже (фокус) для того же самого класса гонки «первый показ отличается от всех следующих».
    layoutDropdown(st)
    // Загрузка вью — известный момент перехвата фокуса (electron/electron#42578). Страж на
    // событии 'focus' его и так поймает; этот вызов оставлен как дешёвая страховка ровно на
    // первый показ, где раньше была отдельная onFirstLoad-заплатка.
    restoreChromeFocusCb?.(st.win)
  })
  view.webContents.loadURL('oblako-chrome://localhost/suggestdropdown.html')
  return view
}

export function showSuggestDropdown(win: BrowserWindow): void {
  const st = stateFor(win)
  if (!st.resizeBound) {
    win.on('resize', () => layoutDropdown(st)) // подписка один раз на окно, как layoutPanel в AiPanelManager
    st.resizeBound = true
  }

  const view = ensureDropdownView(st)
  view.setBounds(computeBounds(st, st.height))
  // ⚠️ Порядок наложения приходится ПОДНИМАТЬ на каждый показ, а не только при первом.
  //
  // Вью прикрепляется один раз (это по-прежнему верно: removeChildView крадёт фокус и лежит на
  // пути багов Electron #44652), но нативный z-order определяется порядком детей contentView, а
  // вкладки добавляются туда ПОЗЖЕ дропдауна — при каждой активации. В результате на вкладке с
  // сайтом выпадашка оказывалась ПОД страницей: её не было видно, и адресной строкой нельзя
  // было пользоваться. На хабе проблема не проявлялась вовсе — там нативной вью страницы нет,
  // потому баг и жил незамеченным.
  //
  // Повторный addChildView для УЖЕ прикреплённой вью не пересоздаёт её, а перемещает в конец
  // списка детей — тот же приём подъёма, что у плавающих окон веб-приложений графа
  // (см. raiseGraphWebApp). Фокус при этом остаётся в чроме: на вью висит страж, возвращающий
  // его обратно, а сами мы focus() здесь не зовём.
  try { win.contentView.addChildView(view) } catch { /* окно могло закрыться */ }
  view.setVisible(true)
  // ⚠️ НИКАКОГО view.webContents.focus() здесь — критичный инвариант этого модуля.
}

// Живой список подсказок (заход 3/5) — buildSuggestions в Toolbar.tsx шлёт его на каждый
// пересчёт (дебаунс 150мс). Лениво создаёт вью-приёмник, даже если она ещё не показана —
// показ/скрытие остаются исключительно делом showSuggestDropdown()/hideSuggestDropdown().
export function sendSuggestItems(win: BrowserWindow, items: SuggestDropdownItem[]): void {
  const st = stateFor(win)
  st.items = items
  ensureDropdownView(st).webContents.send('suggest-dropdown:items', items)
}

// Скрытие — setVisible(false), а НЕ removeChildView: вью остаётся прикреплённой (см. шапку).
// Скрытая вью не рисуется и не участвует в хит-тесте, так что прежняя проблема «мёртвая зона
// перехватывает клики под собой» этим не возвращается.
export function hideSuggestDropdown(win: BrowserWindow | null): void {
  if (!win) return
  dropdowns.get(win.id)?.view?.setVisible(false)
}

// Клавиатурная подсветка (заход 4/5) — омнибокс держит selectedIdx, эта функция просто
// пересылает номер строки во вью (-1 снимает подсветку). Вью ничего не решает сама — источник
// истины остаётся в Toolbar.tsx. Если вью ещё не создана — подсвечивать нечего, no-op.
export function setHighlight(win: BrowserWindow, idx: number): void {
  dropdowns.get(win.id)?.view?.webContents.send('suggest-dropdown:highlight', idx)
}
