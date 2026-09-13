import { WebContentsView } from 'electron'
import type { BrowserWindow } from 'electron'
import path from 'node:path'
import type { ContentBounds, UpdateStatus } from '../shared/ipc'
import { shouldShowUpdatePrompt } from '../shared/updateOffer'
import { closeWindowView } from './viewTeardown'
import { OVERLAY_SHADOW_MARGIN as SHADOW_MARGIN } from '../shared/overlayMetrics'
import { restackPermissionPopover } from './PermissionPopoverManager'
import { allContexts, mainContext } from './WindowRegistry'

// Карточка «доступна новая версия» — отдельная WebContentsView поверх страницы, у левого
// верхнего угла контентной зоны, тем же рецептом, что запрос разрешения сайта.
//
// ⚠️ Не в React-хроме: нативная вью страницы лежит поверх него, и карточка в App.tsx была бы
// под сайтом. Не отдельным окном, как MCP: вопрос задаёт сам браузер человеку, который в нём
// сидит, а не чужая программа снаружи.
//
// ⚠️ Инверсная плита — третий член класса «вопрос, требующий ответа сейчас» (разрешение сайта,
// внешний агент, обновление). Правило в popoverKit переписано под это.

const CARD_WIDTH = 380
const INITIAL_HEIGHT = 170
const EDGE_GAP = 12

export type UpdatePromptAction = 'update' | 'later' | 'skip'

interface WindowUpdatePrompt {
  win: BrowserWindow
  view: WebContentsView | null
  resizeBound: boolean
  contentBounds: ContentBounds
  height: number
}

const prompts = new Map<number, WindowUpdatePrompt>()

let getSkipVersion: () => string | null = () => null
let setSkipVersion: (v: string) => void = () => { /* пока не подключили настройки */ }
let download: () => void = () => { /* */ }
let install: () => void = () => { /* */ }
let enableInstallOnQuit: () => void = () => { /* */ }
let dismissedAsk = false
let postponedInstall = false
let lastStatus: UpdateStatus | null = null

export function wireUpdatePrompt(opts: {
  getSkipVersion: () => string | null
  setSkipVersion: (v: string) => void
  download: () => void
  install: () => void
  enableInstallOnQuit: () => void
}): void {
  getSkipVersion = opts.getSkipVersion
  setSkipVersion = opts.setSkipVersion
  download = opts.download
  install = opts.install
  enableInstallOnQuit = opts.enableInstallOnQuit
}

function stateFor(win: BrowserWindow): WindowUpdatePrompt {
  const existing = prompts.get(win.id)
  if (existing) return existing
  const created: WindowUpdatePrompt = {
    win, view: null, resizeBound: false,
    contentBounds: { x: 0, y: 0, width: 0, height: 0 },
    height: INITIAL_HEIGHT,
  }
  prompts.set(win.id, created)
  win.once('closed', () => { closeWindowView(prompts.get(win.id)?.view); prompts.delete(win.id) })
  return created
}

function computeBounds(st: WindowUpdatePrompt): { x: number; y: number; width: number; height: number } {
  const cb = st.contentBounds
  return {
    x: cb.x + EDGE_GAP - SHADOW_MARGIN,
    y: cb.y + EDGE_GAP - SHADOW_MARGIN,
    width: CARD_WIDTH + SHADOW_MARGIN * 2,
    height: st.height + SHADOW_MARGIN * 2,
  }
}

function isAttached(st: WindowUpdatePrompt): boolean {
  return !!st.view && !st.win.isDestroyed() && st.win.contentView.children.includes(st.view)
}

function layout(st: WindowUpdatePrompt): void {
  if (!isAttached(st)) return
  st.view!.setBounds(computeBounds(st))
}

function hostWindow(): BrowserWindow | null {
  const main = mainContext()?.win
  if (main && !main.isDestroyed()) return main
  const first = allContexts()[0]?.win
  return first && !first.isDestroyed() ? first : null
}

export function syncUpdatePromptBounds(win: BrowserWindow, b: ContentBounds): void {
  const st = stateFor(win)
  st.contentBounds = b
  if (b.width === 0 && b.height === 0) { detach(st); return }
  if (lastStatus && shouldShowOn(lastStatus) && hostWindow()?.id === win.id && !isAttached(st)) {
    show(st)
    return
  }
  layout(st)
}

function ensureView(st: WindowUpdatePrompt): WebContentsView {
  if (st.view) return st.view
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-updateprompt.js'),
      contextIsolation: true,
      sandbox: false, // preload использует ipcRenderer — как у карточки разрешений
    },
  })
  st.view = view
  view.setBackgroundColor('#00000000')
  view.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('oblako-chrome://')) e.preventDefault()
  })
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  view.webContents.once('did-finish-load', () => { pushCurrent(st) })
  void view.webContents.loadURL('oblako-chrome://localhost/updateprompt.html')
  return view
}

function pushCurrent(st: WindowUpdatePrompt): void {
  const wc = st.view?.webContents
  if (!wc || wc.isDestroyed()) return
  wc.send('update-prompt:state', lastStatus)
}

function show(st: WindowUpdatePrompt): void {
  if (st.contentBounds.width === 0 || st.contentBounds.height === 0) return
  if (!st.resizeBound) {
    st.win.on('resize', () => layout(st))
    st.resizeBound = true
  }
  const firstTime = st.view === null
  const view = ensureView(st)
  view.setBounds(computeBounds(st))
  if (!isAttached(st)) st.win.contentView.addChildView(view)
  // Разрешение сайта срочнее: если оно уже на экране, оставляем его сверху.
  restackPermissionPopover(st.win)
  if (!firstTime) pushCurrent(st)
}

function detach(st: WindowUpdatePrompt): void {
  if (!isAttached(st)) return
  try { st.win.contentView.removeChildView(st.view!) } catch { /* окно могло закрыться */ }
}

function shouldShowOn(s: UpdateStatus): boolean {
  return shouldShowUpdatePrompt({
    kind: s.kind,
    newVersion: s.newVersion,
    skippedVersion: getSkipVersion(),
    dismissedAsk,
    postponedInstall,
  })
}

/** Статус апдейтера сменился — показать, обновить или спрятать карточку. */
export function onUpdateStatus(s: UpdateStatus): void {
  lastStatus = s
  const win = hostWindow()
  if (!win) return
  const st = stateFor(win)
  if (!shouldShowOn(s)) {
    detach(st)
    return
  }
  if (isAttached(st)) pushCurrent(st)
  else show(st)
}

export function updatePromptAnswered(action: UpdatePromptAction): void {
  const s = lastStatus
  if (!s) return
  if (action === 'update') {
    if (s.kind === 'available') download()
    else if (s.kind === 'downloaded') install()
    return
  }
  if (action === 'skip') {
    if (s.newVersion) setSkipVersion(s.newVersion)
    dismissedAsk = true
    if (lastStatus) onUpdateStatus(lastStatus)
    return
  }
  // later
  if (s.kind === 'downloaded') {
    enableInstallOnQuit()
    postponedInstall = true
  } else {
    dismissedAsk = true
  }
  if (lastStatus) onUpdateStatus(lastStatus)
}

export function setUpdatePromptHeight(sender: Electron.WebContents, px: number): void {
  for (const st of prompts.values()) {
    if (st.view?.webContents !== sender) continue
    const next = Math.max(80, Math.round(px))
    if (next === st.height) return
    st.height = next
    layout(st)
    return
  }
}
