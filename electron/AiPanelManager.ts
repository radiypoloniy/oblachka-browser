// Правая AI-панель — Заход 1: пустой каркас-оверлей, только открытие/закрытие/позиция/дизайн.
// Тот же приём, что и у поповера перевода (см. TranslatePopoverManager.ts): отдельная
// WebContentsView, добавленная в contentView ПОСЛЕДНЕЙ → native z-order (не CSS z-index),
// поверх уже добавленной вкладки. Bounds контентной вкладки НЕ трогаем — панель просто
// перекрывает правый край страницы, сайт под ней геометрически не меняется (как у Яндекса).
// Никакой AI-логики здесь пока нет — просто позиция/тоггл/дизайн, содержимое page — заглушка.
import { WebContentsView, ipcMain } from 'electron'
import type { BrowserWindow, IpcMainEvent } from 'electron'
import path from 'node:path'
import { runChatMessage } from './TranslationService'

const PANEL_WIDTH = 360
// Держать в синхроне с TOOLBAR_HEIGHT в src/components/Toolbar.tsx — панель начинается СРАЗУ
// ПОД тулбаром (он же кастомный titlebar), не залезает в него. Иначе она перекрывает
// VPN/AI-кнопки и физически блокирует клики по ним: WebContentsView — прямоугольный
// hit-test слой поверх chromeView, у него нет «прозрачности для кликов» по CSS pointer-events
// внутри своей страницы — именно так ранее ломался повторный клик по AI-кнопке (панель сама
// перекрывала кнопку, которой её открыли).
const TOOLBAR_HEIGHT = 56
// Воздух вокруг «плавающего острова» на все стороны (отступ от тулбара/правого края/низа окна) —
// держать в синхроне с GUTTER в src/aipanel.tsx (тот инсетит видимую карточку внутри вьюпорта
// ровно на столько же паддингом). Тот же запас служит зоной под CSS box-shadow «парящей»
// карточки — WebContentsView обрезает всё, что рисуется за границей своего прямоугольника (тот
// же приём, что и SHADOW_MARGIN в TranslatePopoverManager.ts). Сверху жёстко: view.y не может
// быть меньше TOOLBAR_HEIGHT (см. комментарий выше) — справа/снизу больше и не нужно, тень
// физически не может выйти за пределы окна.
const GUTTER = 20

let panelView: WebContentsView | null = null
let attachedWin: BrowserWindow | null = null
let resizeBoundWin: BrowserWindow | null = null
let isOpen = false
let ipcRegistered = false

function computeBounds(win: BrowserWindow) {
  const { width, height } = win.getContentBounds()
  return {
    x: width - PANEL_WIDTH - GUTTER * 2,
    y: TOOLBAR_HEIGHT,
    width: PANEL_WIDTH + GUTTER * 2,
    height: height - TOOLBAR_HEIGHT,
  }
}

function layoutPanel(): void {
  if (!panelView || !attachedWin) return
  panelView.setBounds(computeBounds(attachedWin))
}

function closePanel(win: BrowserWindow): void {
  if (panelView) win.contentView.removeChildView(panelView)
  isOpen = false
}

// Регистрируется один раз, лениво — на первое открытие панели, не на старте.
function ensureIpcRegistered(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  // Крестик в шапке панели — свой маленький канал (как у поповера перевода), не shared/ipc.ts:
  // это внутренняя механика панели, а не контракт хром-обвязки.
  ipcMain.on('ai-panel:close', () => {
    if (attachedWin) closePanel(attachedWin)
  })

  // Чат (Заход 2) — та же труба, что у поповера: runChatMessage стримит чанки по мере генерации,
  // затем финальный исход. event.sender вместо popoverView/panelView сравнения — здесь один
  // постоянный panelView, но сверяемся всё равно (панель могла быть закрыта/пересоздана между
  // отправкой сообщения и приходом ответа).
  ipcMain.on('ai-panel:chat-send', (event: IpcMainEvent, text: string) => {
    const wc = event.sender
    void runChatMessage(text, (chunkText) => {
      if (panelView && panelView.webContents === wc) wc.send('ai-panel:chat-chunk', chunkText)
    }).then((outcome) => {
      if (panelView && panelView.webContents === wc) wc.send('ai-panel:chat-result', outcome)
    })
  })
}

// Создаётся лениво на первое открытие — ничего не висит на старте браузера (тот же принцип,
// что и у поповера перевода).
function ensurePanelView(): WebContentsView {
  if (panelView) return panelView
  ensureIpcRegistered()
  panelView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-aipanel.js'),
      contextIsolation: true,
      sandbox: false, // preload использует ipcRenderer
    },
  })
  // Прозрачный фон вида — страница сама красит себя в токен темы (см. aipanel.tsx), без
  // риска мигнуть белым мимо текущей темы (светлой/тёмной) до применения CSS.
  panelView.setBackgroundColor('#00000000')
  panelView.webContents.loadURL('oblako-chrome://localhost/aipanel.html')
  return panelView
}

// Тоггл по клику кнопки AI в тулбаре — возвращает новое состояние (true = открыта).
export function toggleAiPanel(win: BrowserWindow): boolean {
  attachedWin = win
  if (resizeBoundWin !== win) {
    win.on('resize', layoutPanel)
    resizeBoundWin = win
  }

  if (isOpen) {
    closePanel(win)
    return false
  }

  const view = ensurePanelView()
  view.setBounds(computeBounds(win))
  win.contentView.addChildView(view) // последней → поверх вкладки, а не под ней
  isOpen = true
  return true
}
