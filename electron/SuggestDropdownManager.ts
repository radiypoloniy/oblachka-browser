// Дропдаун подсказок омнибокса — отдельное ДОЧЕРНЕЕ ОКНО поверх главного, под самим омнибоксом.
// Живые подсказки + мышиный выбор + клавиатурная подсветка (setHighlight ниже) — омнибокс остаётся
// ЕДИНСТВЕННЫМ владельцем selectedIdx, окно только рисует по номеру, Enter выполняется локально
// в омнибоксе без обращения сюда.
//
// ⚠️ ПОЧЕМУ ОКНО, А НЕ WebContentsView — это главное решение модуля, и оно оплачено долгой серией
// заплаток, каждая из которых лечила симптом.
//
// Пока список жил в своей `WebContentsView`, адресная строка и подсказки оказывались в ДВУХ разных
// фокус-доменах, а Electron не даёт сделать вью, которая фокус не забирает: electron/electron#42922
// открыт, реализации нет, и в его постановке прямо сказано, что способа держать две вью в одном
// окне без взаимного перехвата не существует. Единственной защитой был СТРАЖ — вернуть фокус
// чрому на каждый перехват. Он работал, но именно он и был источником следующей беды: возврат не
// отменяет перехват, а идёт ПОСЛЕ него, то есть каждый показ списка — это круг «фокус ушёл →
// вернулся». А показ зовётся на КАЖДУЮ букву.
//
// Чем это оборачивалось для человека: круг посреди протяжки мышью обрывает саму протяжку —
// Chromium снимает захват мыши, когда вью теряет фокус, — и выделение в строке не рисуется вовсе,
// потому что документ в этот момент неактивен. Живая жалоба звучала так: «набрал пару символов,
// хочу выделить набранное мышью, а выделяется рекомендация». Выделение при этом было, его просто
// не было видно, и единственной видимой подсветкой на экране оставалась строка выдачи.
//
// Так же устроен и настоящий Chrome: его омнибокс — нативное поле, а попап подсказок живёт
// ОТДЕЛЬНЫМ `views::Widget` (chrome/browser/ui/views/omnibox), который активацию не забирает.
// Здесь повторено то же самое доступными средствами: дочернее окно с `focusable: false`. На
// Windows это `WS_EX_NOACTIVATE` — окно принимает мышь, но активным не становится НИКОГДА, то
// есть перехватить фокус физически не может.
//
// Что из этого следует и чего теперь в модуле НЕТ: стража фокуса, возврата фокуса из main,
// подъёма z-order через addChildView и проверок «а не наверху ли мы». Порядок наложения решает
// сама природа дочернего окна — оно всегда над родителем, вью вкладки его не накрывает.
//
// ⚠️ Цена конструкции — окно надо ВОДИТЬ ЗА ГЛАВНЫМ: координаты у него экранные, поэтому переезд,
// изменение размера, сворачивание и уход в другое приложение обязаны обрабатываться руками (см.
// bindWindow ниже). Вью такого не требовала — за это и платим.
//
// ⚠️ ДРОПДАУН — СВОЙ У КАЖДОГО ОКНА. Омнибокс есть в любом окне, и подсказки принадлежат тому
// окну, где набирают: одно окно на приложение означало бы, что прямоугольник омнибокса из окна B
// двигает список над окном A, а выбранная строка уходит не в тот омнибокс. Состояние лежит в
// карте по id окна и умирает вместе с ним; окно создаётся лениво — на первый список подсказок.
import { BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { IPC } from '../shared/ipc'
import type { ContentBounds, OmniboxPanel, OmniboxRecommendEdit, SuggestDropdownItem } from '../shared/ipc'

const GAP = 8 // зазор между низом омнибокса и верхом карточки
// Стартовая высота — до первого реального замера от suggestdropdown.tsx (ResizeObserver →
// 'suggest-dropdown:height'). Держим маленькой (высота ~1 строки): реальная высота прилетает почти
// сразу после показа, поэтому стартовый флеш короткий и безвредный.
const INITIAL_HEIGHT = 48
// Тень карточки рисуется ВНУТРИ окна, а окно всё, что за своей границей, обрезает — поэтому вокруг
// карточки нужен прозрачный запас не меньше реального охвата тени (offset+blur = 10+28, см.
// suggestdropdown.tsx). Держать в синхроне с SHADOW_MARGIN там же.
const SHADOW_MARGIN = 40
// ⚠️ СВЕРХУ ЗАПАС ДРУГОЙ, И ЭТО САМАЯ ДОРОГАЯ СТРОКА В ФАЙЛЕ. Прозрачные поля вокруг карточки
// ХИТ-ТЕСТЯТСЯ: и у вью, и у окна мышь ловит весь прямоугольник, а не только видимую карточку.
// Пока запас был одинаковым со всех сторон (40) при зазоре 4, верхний край дропдауна оказывался на
// 36 px ВЫШЕ низа адресной строки, то есть накрывал почти всю её высоту (38 px). Следствия, которые
// месяц объясняли фокусом: текст в строке нельзя было выделить мышью вообще (курсор физически не
// доходил до поля, работала только клавиатура), клик по строке то открывал дропдаун, то нет — как
// повезёт попасть в оставшиеся пиксели, — а протяжка уходила в список и водила его подсветку,
// отчего казалось, что «выделяется рекомендация».
// Поэтому сверху запас РОВНО такой же, как зазор: край окна ложится точно на низ строки и не
// перекрывает её ни на пиксель. Платим верхушкой тени — она обрезается; это видно куда меньше, чем
// неработающая адресная строка, а тень у нас всё равно смещена вниз (offset +10).
const SHADOW_TOP = GAP
// ⚠️ ПОТОЛОК ШИРИНЫ КАРТОЧКИ. Раньше её ширина была ровно шириной омнибокса, а омнибокс с недавних
// пор занимает всю свободную полосу тулбара — на 2560-мониторе это под две тысячи пикселей. Выдача
// в такой карточке не «широкая», она РАЗМАЗАННАЯ: восемь значков расползаются по всей строке, одна
// карточка подсказки растягивается в полосу во весь экран, а глазу негде зацепиться. Так не делает
// никто: Spotlight в macOS фиксированной ширины независимо от монитора.
// Карточка прижата к ЛЕВОМУ краю строки (там же, где начинается текст адреса), поэтому лишнюю
// ширину режем справа.
// ⚠️ Режем именно ОКНО, а не только вёрстку внутри: прозрачный остаток окна хит-тестился бы и
// глотал клики по странице справа от карточки — ровно та беда, которой посвящён SHADOW_TOP выше.
const MAX_CARD_WIDTH = 1040

interface WindowDropdown {
  win: BrowserWindow
  popup: BrowserWindow | null
  bound: boolean
  // Последний присланный прямоугольник омнибокса (см. IPC.OMNIBOX_SET_BOUNDS, main.ts) — в
  // координатах КОНТЕНТА главного окна, экранные считаются в computeBounds.
  omniboxBounds: ContentBounds
  // Последняя измеренная высота карточки: окно персистентно между показами, поэтому повторное
  // открытие переиспользует известное значение вместо возврата к INITIAL_HEIGHT.
  height: number
  // Последний список — переотправляется на did-finish-load, если окно ещё не успело загрузиться
  // к моменту первого sendSuggestItems().
  items: SuggestDropdownItem[]
  // Последняя панель (режим «нетронутая строка», заход 11) — переотправляется по тому же поводу.
  panel: OmniboxPanel | null
  // Что показано СЕЙЧАС. Нужно ровно для переотправки на did-finish-load: слать оба сообщения
  // подряд нельзя — какое пришло вторым, то бы и нарисовалось, независимо от намерения омнибокса.
  mode: 'items' | 'panel'
  // Показан ли список СЕЙЧАС с точки зрения омнибокса. Нужен отдельно от popup.isVisible():
  // окно прячется и по внешним причинам (главное свернули, ушли в другое приложение), и при
  // возврате его надо показать снова — но только если омнибокс всё ещё его просит.
  wanted: boolean
}

const dropdowns = new Map<number, WindowDropdown>()
let ipcRegistered = false

function stateFor(win: BrowserWindow): WindowDropdown {
  const existing = dropdowns.get(win.id)
  if (existing) return existing
  const created: WindowDropdown = {
    win, popup: null, bound: false,
    omniboxBounds: { x: 0, y: 0, width: 0, height: 0 },
    height: INITIAL_HEIGHT, items: [], panel: null, mode: 'items', wanted: false,
  }
  dropdowns.set(win.id, created)
  win.once('closed', () => {
    const st = dropdowns.get(win.id)
    if (st?.popup && !st.popup.isDestroyed()) st.popup.destroy()
    dropdowns.delete(win.id)
  })
  return created
}

// Окно по отправителю: каналы дропдауна общие на все окна.
function stateBySender(sender: Electron.WebContents): WindowDropdown | null {
  for (const st of dropdowns.values()) if (st.popup?.webContents === sender) return st
  return null
}

// Колбэк на клик по строке — main.ts подписывается один раз при старте и пересылает выбор в слой
// хрома ТОГО окна, где кликнули.
let onPickCb: ((win: BrowserWindow, item: SuggestDropdownItem) => void) | null = null

export function onPick(cb: (win: BrowserWindow, item: SuggestDropdownItem) => void): void {
  onPickCb = cb
}

// То же для клика по полоске сайта в панели — main.ts пересылает его в чром, где открывается
// поповер замочка (панель показывает сводку и управлением не занимается).
let onSiteInfoCb: ((win: BrowserWindow) => void) | null = null

export function onSiteInfo(cb: (win: BrowserWindow) => void): void {
  onSiteInfoCb = cb
}

// Правка набора «Рекомендуемые» карандашом в панели — тоже уходит в чром: список хранит
// SettingsManager, но что показано в панели, решает по-прежнему один Toolbar.tsx.
let onRecommendCb: ((win: BrowserWindow, edit: OmniboxRecommendEdit) => void) | null = null

export function onRecommend(cb: (win: BrowserWindow, edit: OmniboxRecommendEdit) => void): void {
  onRecommendCb = cb
}

// ⚠️ Координаты ЭКРАННЫЕ: у дочернего окна нет системы координат родителя. getContentBounds() даёт
// экранное положение контентной области главного окна, а omniboxBounds приходит от рендерера в
// координатах этой же области — то есть складываются они напрямую, без поправок на рамку и
// заголовок. Это и есть причина, по которой брать getBounds() здесь нельзя.
function computeBounds(st: WindowDropdown): { x: number; y: number; width: number; height: number } {
  const ob = st.omniboxBounds
  const base = st.win.isDestroyed() ? { x: 0, y: 0 } : st.win.getContentBounds()
  return {
    x: Math.round(base.x + ob.x - SHADOW_MARGIN),
    // GAP - SHADOW_TOP === 0: верх окна ровно на низе адресной строки, ни пикселя выше.
    y: Math.round(base.y + ob.y + ob.height + GAP - SHADOW_TOP),
    width: Math.round(Math.min(ob.width, MAX_CARD_WIDTH) + SHADOW_MARGIN * 2),
    height: Math.round(st.height + SHADOW_TOP + SHADOW_MARGIN),
  }
}

function layoutDropdown(st: WindowDropdown): void {
  const popup = st.popup
  if (!popup || popup.isDestroyed() || st.win.isDestroyed()) return
  popup.setBounds(computeBounds(st))
}

// Вызывается из main.ts на каждый OMNIBOX_SET_BOUNDS (см. Toolbar.tsx::omniboxPillRef).
export function syncOmniboxBounds(win: BrowserWindow, b: ContentBounds): void {
  const st = stateFor(win)
  st.omniboxBounds = b
  layoutDropdown(st)
}

function ensureIpcRegistered(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  // Клик по строке — просто пересылаем колбэку (main.ts форвардит в chromeView). Не боевой канал
  // (не в shared/ipc.ts): это внутренняя механика ЭТОГО окна, как translate-popover:close.
  ipcMain.on('suggest-dropdown:pick', (e, item: SuggestDropdownItem) => {
    const st = stateBySender(e.sender)
    if (st) onPickCb?.(st.win, item)
  })

  ipcMain.on(IPC.SUGGEST_DROPDOWN_SITE_INFO, (e) => {
    const st = stateBySender(e.sender)
    if (st) onSiteInfoCb?.(st.win)
  })

  ipcMain.on(IPC.SUGGEST_DROPDOWN_RECOMMEND, (e, edit: OmniboxRecommendEdit) => {
    const st = stateBySender(e.sender)
    if (st) onRecommendCb?.(st.win, edit)
  })

  // Реальная высота карточки (ResizeObserver в suggestdropdown.tsx). Math.max(1, px) — защита от
  // абсурдных 0/отрицательных значений (карточка ещё не отрендерилась).
  ipcMain.on('suggest-dropdown:height', (e, px: number) => {
    const st = stateBySender(e.sender)
    if (!st) return
    st.height = Math.max(1, px)
    layoutDropdown(st)
  })
}

// ⚠️ Подписки на главное окно — ровно та цена, о которой сказано в шапке. Экранные координаты
// означают, что окно-список само по себе не поедет ни за переездом, ни за ресайзом, а при
// сворачивании родителя останется висеть поверх чужих приложений.
function bindWindow(st: WindowDropdown): void {
  if (st.bound) return
  st.bound = true
  const follow = () => layoutDropdown(st)
  st.win.on('move', follow)
  st.win.on('resize', follow)
  // Ушли в другое приложение или свернули главное — списку на экране не место. ⚠️ Клик по самому
  // списку сюда НЕ приводит: окно неактивируемое, главное окно фокус при этом не теряет, — ровно
  // ради этого свойства конструкция и выбрана.
  const vanish = () => hideSuggestDropdown(st.win)
  st.win.on('blur', vanish)
  st.win.on('minimize', vanish)
  st.win.on('hide', vanish)
  // Вернулись — показываем снова, но только если омнибокс всё ещё этого хочет.
  st.win.on('restore', () => { if (st.wanted) showSuggestDropdown(st.win) })
}

function ensurePopup(st: WindowDropdown): BrowserWindow {
  if (st.popup && !st.popup.isDestroyed()) return st.popup
  ensureIpcRegistered()
  const popup = new BrowserWindow({
    // parent — чтобы окно всегда лежало НАД главным и уезжало вместе с ним при сворачивании.
    parent: st.win,
    // ⚠️ Вся суть конструкции: неактивируемое окно. На Windows это WS_EX_NOACTIVATE — мышь
    // принимает, фокус не забирает никогда. Без этого мы возвращаемся ровно к тому, от чего ушли.
    focusable: false,
    frame: false,
    transparent: true,
    // Тень рисует сама карточка (см. SHADOW_MARGIN): системная легла бы по прямоугольнику окна,
    // то есть по прозрачному запасу вокруг карточки.
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-suggestdropdown.js'),
      contextIsolation: true,
      sandbox: false, // preload использует ipcRenderer
    },
  })
  st.popup = popup
  popup.setMenuBarVisibility(false)
  // Список не навигирует никуда сам — но если что-то попробует, окно UI не должно превратиться в
  // страницу сайта (тот же гвард, что у AI-панели).
  popup.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('oblako-chrome://')) e.preventDefault()
  })
  popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  popup.webContents.once('did-finish-load', () => {
    // Список мог прийти ДО загрузки страницы — тогда send ушёл бы в никуда (preload ещё не навесил
    // обработчик). Переотправляем последнее известное явно — и ровно ОДНО, то, что просил омнибокс:
    // послать оба сообщения подряд значит нарисовать не режим, а порядок отправки.
    if (st.mode === 'panel' && st.panel) popup.webContents.send('suggest-dropdown:panel', st.panel)
    else popup.webContents.send('suggest-dropdown:items', st.items)
    layoutDropdown(st)
  })
  popup.loadURL('oblako-chrome://localhost/suggestdropdown.html')
  return popup
}

export function showSuggestDropdown(win: BrowserWindow): void {
  const st = stateFor(win)
  st.wanted = true
  if (win.isDestroyed() || win.isMinimized()) return
  bindWindow(st)
  const popup = ensurePopup(st)
  popup.setBounds(computeBounds(st))
  // ⚠️ showInactive(), а не show(): show() просит у системы активацию. Окно и так неактивируемое,
  // но просить активацию и не получать её — лишний повод системе дёрнуть фокус главного окна.
  if (!popup.isVisible()) popup.showInactive()
}

// Живой список подсказок — buildSuggestions в Toolbar.tsx шлёт его на каждый пересчёт. Лениво
// создаёт окно-приёмник, даже если оно ещё не показано: показ остаётся делом showSuggestDropdown.
export function sendSuggestItems(win: BrowserWindow, items: SuggestDropdownItem[]): void {
  const st = stateFor(win)
  st.items = items
  st.mode = 'items'
  ensurePopup(st).webContents.send('suggest-dropdown:items', items)
}

// Панель по нетронутой строке (заход 11) — второй режим той же вью. Приходит и повторно, когда
// подъезжает «вы это уже читали»: вью просто перерисовывает пришедшее целиком.
export function sendSuggestPanel(win: BrowserWindow, panel: OmniboxPanel): void {
  const st = stateFor(win)
  st.panel = panel
  st.mode = 'panel'
  ensurePopup(st).webContents.send('suggest-dropdown:panel', panel)
}

export function hideSuggestDropdown(win: BrowserWindow | null): void {
  if (!win) return
  const st = dropdowns.get(win.id)
  if (!st) return
  // ⚠️ wanted снимаем ТОЛЬКО когда прячет сам омнибокс. Внешние причины (свернули окно, ушли в
  // другое приложение) намерения человека не отменяют — иначе после возврата список бы не вернулся.
  if (st.popup && !st.popup.isDestroyed()) st.popup.hide()
}

// Скрытие по команде омнибокса — в отличие от внешних причин выше, снимает и намерение.
export function closeSuggestDropdown(win: BrowserWindow | null): void {
  if (!win) return
  const st = dropdowns.get(win.id)
  if (!st) return
  st.wanted = false
  if (st.popup && !st.popup.isDestroyed()) st.popup.hide()
}

// Клавиатурная подсветка — омнибокс держит selectedIdx, эта функция пересылает номер строки
// (-1 снимает подсветку). Окно ничего не решает само — источник истины в Toolbar.tsx.
export function setHighlight(win: BrowserWindow, idx: number): void {
  const popup = dropdowns.get(win.id)?.popup
  if (popup && !popup.isDestroyed()) popup.webContents.send(IPC.SUGGEST_DROPDOWN_HIGHLIGHT, idx)
}
