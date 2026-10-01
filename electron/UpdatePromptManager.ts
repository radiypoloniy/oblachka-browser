import { app, webContents, WebContentsView } from 'electron'
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
  renderedKey: string | null
}

const prompts = new Map<number, WindowUpdatePrompt>()

let getSkipVersion: () => string | null = () => null
let setSkipVersion: (v: string) => void = () => { /* пока не подключили настройки */ }
let download: () => void = () => { /* */ }
let install: () => void = () => { /* */ }
let dismissedAsk = false
let postponedInstall = false
let lastStatus: UpdateStatus | null = null
let offerVersion: string | null = null
let watchingInput = false

export function wireUpdatePrompt(opts: {
  getSkipVersion: () => string | null
  setSkipVersion: (v: string) => void
  download: () => void
  install: () => void
}): void {
  getSkipVersion = opts.getSkipVersion
  setSkipVersion = opts.setSkipVersion
  download = opts.download
  install = opts.install
  if (!watchingInput) {
    watchingInput = true
    for (const wc of webContents.getAllWebContents()) watchOutsideInput(wc)
    app.on('web-contents-created', (_e, wc) => watchOutsideInput(wc))
  }
}

function stateFor(win: BrowserWindow): WindowUpdatePrompt {
  const existing = prompts.get(win.id)
  if (existing) return existing
  const created: WindowUpdatePrompt = {
    win, view: null, resizeBound: false,
    contentBounds: { x: 0, y: 0, width: 0, height: 0 },
    height: INITIAL_HEIGHT,
    renderedKey: null,
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
  // Внутренние вкладки не имеют нативной страницы, но предложение обновления им тоже доступно.
  if (b.width === 0 && b.height === 0) {
    const { width, height } = win.getContentBounds()
    st.contentBounds = { x: 12, y: 56, width: width - 24, height: height - 68 }
  }
  if (lastStatus && shouldShowOn(lastStatus) && hostWindow()?.id === win.id) {
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
  if (st.renderedKey !== statusKey()) detach(st)
  wc.send('update-prompt:state', lastStatus)
}

function show(st: WindowUpdatePrompt): void {
  if (st.contentBounds.width === 0 || st.contentBounds.height === 0) return
  if (!st.resizeBound) {
    st.win.on('resize', () => layout(st))
    st.resizeBound = true
  }
  const view = ensureView(st)
  view.setBounds(computeBounds(st))
  if (st.renderedKey === statusKey()) st.win.contentView.addChildView(view)
  // Разрешение сайта срочнее: если оно уже на экране, оставляем его сверху.
  restackPermissionPopover(st.win)
  pushCurrent(st)
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
  if (s.newVersion && s.newVersion !== offerVersion) {
    offerVersion = s.newVersion
    dismissedAsk = false
    postponedInstall = false
  }
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
    postponedInstall = true
  } else {
    dismissedAsk = true
  }
  if (lastStatus) onUpdateStatus(lastStatus)
}

export function setUpdatePromptHeight(sender: Electron.WebContents, px: number, key: string): void {
  for (const st of prompts.values()) {
    if (st.view?.webContents !== sender) continue
    if (key !== statusKey() || !lastStatus || !shouldShowOn(lastStatus) || !Number.isFinite(px) || px <= 0) return
    const next = Math.max(80, Math.round(px))
    st.height = next
    st.renderedKey = key
    st.win.contentView.addChildView(st.view!)
    restackPermissionPopover(st.win)
    layout(st)
    return
  }
}

function statusKey(): string { return `${lastStatus?.kind}:${lastStatus?.newVersion ?? ''}` }

export function syncUpdatePrompt(sender: Electron.WebContents): void {
  for (const st of prompts.values()) if (st.view?.webContents === sender) pushCurrent(st)
}

export function restackUpdatePrompt(win: BrowserWindow): void {
  const st = prompts.get(win.id)
  if (!st || win.isDestroyed() || !isAttached(st)) return
  win.contentView.addChildView(st.view!)
  restackPermissionPopover(win)
}

function watchOutsideInput(wc: Electron.WebContents): void {
  // Клики сайта, хрома и AI-панели принадлежат разным документам, поэтому слушаем в main.
  wc.on('input-event', (_e, input) => {
    if (input.type !== 'mouseDown') return
    for (const st of prompts.values()) {
      if (!isAttached(st) || st.view?.webContents === wc) continue
      if (st.win.contentView.children.some(v => v instanceof WebContentsView && v.webContents === wc)) {
        updatePromptAnswered('later')
        return
      }
    }
  })
  wc.on('before-input-event', (_e, input) => {
    if (input.type !== 'keyDown' || input.key !== 'Escape') return
    for (const st of prompts.values()) {
      if (isAttached(st) && st.win.contentView.children.some(v => v instanceof WebContentsView && v.webContents === wc)) {
        updatePromptAnswered('later')
        return
      }
    }
  })
}
