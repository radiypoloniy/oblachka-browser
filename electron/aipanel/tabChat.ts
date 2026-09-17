// Беседа AI-панели по вкладке: контекст, занятость и три входа (чат / перевод / фактчек).
//
// ⚠️ ВЫНЕСЕНО ИЗ AiPanelManager.ts из-за храповика: тому файлу расти некуда, а чинить тут
// пришлось дыру «спросил саммари, переключил вкладку — ответ исчез».
// ⚠️ Ответ пишется в КОНТЕКСТ вкладки, с которой спросили, а не в глобальный activeTabId:
// IPC может доехать уже после переключения, и тогда саммари оседало в чужой ленте, а в своей
// onContext гасил sending. Панель показывает стрим, только пока смотрит ту же вкладку; вернулись —
// в контексте уже лежит готовый ответ (или флаг, что ещё считается).

import { ipcMain } from 'electron'
import type { IpcMainEvent, WebContents } from 'electron'
import type { ModelErrorCode, TabState } from '../../shared/ipc'
import type { AiFileMeta } from '../../shared/aiAttachments'
import { runChatMessage, resolveDirection, buildPrompt } from '../TranslationService'
import { runFactCheck } from '../GeminiFactCheck'
import { searxngSearch, buildGroundingPrompt, appendSearxngSources } from '../SearxngSearch'
import { chatPanel, panelAlive } from './instances'

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  via?: { label: string; local: boolean }
  files?: AiFileMeta[]
}

type PendingKind = 'chat' | 'factcheck' | 'search'

interface TabChatContext {
  messages: ChatMessage[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  history: any[]
  url: string
  title: string
  pageText: string | null
  pageMarkdown: string | null
  pending: PendingKind | null
  /** Растёт при сбросе: незавершённый ход после смены URL в свою ленту больше не пишется. */
  job: number
  error: string | null
  errorCode: ModelErrorCode | null
}

const tabContexts = new Map<string, TabChatContext>()

let activeTabId: string | null = null
let activeTabUrl = ''
let activeTabTitle = ''
let activeTabFavicon: string | null = null

let extractPageText: (wc: WebContents | null) => Promise<{ ok: boolean; text: string; markdown: string | null }> = async () => (
  { ok: false, text: '', markdown: null }
)
let pageWcOf: (tabId: string) => WebContents | null = () => null
let buildFirstTurn: (pageText: string, pageTitle: string, userText: string) => string = (_p, _t, u) => u

export function wireTabChat(deps: {
  extractPageText: (wc: WebContents | null) => Promise<{ ok: boolean; text: string; markdown: string | null }>
  buildFirstTurnPrompt: (pageText: string, pageTitle: string, userText: string) => string
  pageWcOf: (tabId: string) => WebContents | null
}): void {
  extractPageText = deps.extractPageText
  buildFirstTurn = deps.buildFirstTurnPrompt
  pageWcOf = deps.pageWcOf
}

function emptyCtx(url: string, title: string): TabChatContext {
  return {
    messages: [], history: [], url, title,
    pageText: null, pageMarkdown: null,
    pending: null, job: 0, error: null, errorCode: null,
  }
}

function getOrCreateContext(id: string, url: string, title = ''): TabChatContext {
  let ctx = tabContexts.get(id)
  if (!ctx) {
    ctx = emptyCtx(url, title)
    tabContexts.set(id, ctx)
  }
  return ctx
}

function resetChat(ctx: TabChatContext, url: string): void {
  ctx.job += 1
  ctx.url = url
  ctx.messages = []
  ctx.history = []
  ctx.pageText = null
  ctx.pageMarkdown = null
  ctx.pending = null
  ctx.error = null
  ctx.errorCode = null
}

export function sendCurrentContext(): void {
  const view = chatPanel()?.view
  if (!view || view.webContents.isDestroyed() || !activeTabId) return
  const ctx = getOrCreateContext(activeTabId, activeTabUrl, activeTabTitle)
  view.webContents.send('ai-panel:context', {
    tabId: activeTabId,
    url: activeTabUrl,
    title: activeTabTitle,
    favicon: activeTabFavicon,
    messages: ctx.messages,
    sending: ctx.pending !== null,
    factChecking: ctx.pending === 'factcheck',
    webSearching: ctx.pending === 'search',
    error: ctx.error,
    errorCode: ctx.errorCode,
  })
}

export function syncTabChat(tabsSnapshot: TabState[]): void {
  const liveIds = new Set(tabsSnapshot.map((t) => t.id))
  for (const id of tabContexts.keys()) {
    if (!liveIds.has(id)) tabContexts.delete(id)
  }

  const active = tabsSnapshot.find((t) => t.isActive)
  if (!active) return

  const ctx = getOrCreateContext(active.id, active.url, active.title)
  ctx.title = active.title

  let urlChanged = false
  if (ctx.url !== active.url) {
    resetChat(ctx, active.url)
    urlChanged = true
  }

  const switched = active.id !== activeTabId
  activeTabId = active.id
  activeTabUrl = active.url
  activeTabTitle = active.title
  activeTabFavicon = active.faviconUrl ?? null

  if (switched || urlChanged) sendCurrentContext()
}

function pickTabId(requested: unknown): string | null {
  return typeof requested === 'string' && requested ? requested : activeTabId
}

function showing(tabId: string, wc: WebContents): boolean {
  return panelAlive(wc) && activeTabId === tabId
}

function beginJob(ctx: TabChatContext, kind: PendingKind): number {
  ctx.pending = kind
  ctx.error = null
  ctx.errorCode = null
  return ctx.job
}

function stillJob(ctx: TabChatContext, job: number): boolean {
  return ctx.job === job
}

function finishJob(ctx: TabChatContext, job: number): boolean {
  if (!stillJob(ctx, job)) return false
  ctx.pending = null
  return true
}

function rememberError(ctx: TabChatContext, job: number, error: string, errorCode?: ModelErrorCode): void {
  if (!stillJob(ctx, job)) return
  ctx.pending = null
  ctx.error = error
  ctx.errorCode = errorCode ?? null
}

export function registerTabChatIpc(): void {
  ipcMain.on('ai-panel:chat-send', (event: IpcMainEvent, text: string, webGrounding: boolean, requestedTab?: unknown) => {
    const wc = event.sender
    const tabId = pickTabId(requestedTab)
    if (!tabId) return
    const ctx = getOrCreateContext(tabId, tabId === activeTabId ? activeTabUrl : '', ctxTitle(tabId))
    ctx.messages.push({ role: 'user', text })
    const job = beginJob(ctx, webGrounding ? 'search' : 'chat')
    const title = ctx.title || activeTabTitle

    if (webGrounding) {
      void runGrounded(wc, tabId, ctx, job, text)
      return
    }

    const needsExtraction = ctx.pageText === null
    const pageWc = needsExtraction ? pageWcOf(tabId) : null
    void (async () => {
      let promptText = text
      if (needsExtraction) {
        const extracted = await extractPageText(pageWc)
        if (!stillJob(ctx, job)) return
        if (extracted.ok) {
          ctx.pageText = extracted.text
          ctx.pageMarkdown = extracted.markdown
        }
        promptText = buildFirstTurn(extracted.markdown ?? extracted.text, title, text)
        console.log(`[ai-panel] текст страницы извлечён: ${extracted.text.length} симв.`)
      }
      const outcome = await runChatMessage(promptText, ctx.history, (chunkText) => {
        if (showing(tabId, wc)) wc.send('ai-panel:chat-chunk', chunkText)
      })
      if (!stillJob(ctx, job)) return
      if (outcome.ok) {
        ctx.messages.push({ role: 'assistant', text: outcome.out, files: outcome.files, via: outcome.via })
        ctx.history = outcome.history
        finishJob(ctx, job)
      } else {
        rememberError(ctx, job, outcome.error, outcome.errorCode)
      }
      if (showing(tabId, wc)) wc.send('ai-panel:chat-result', outcome)
    })()
  })

  ipcMain.on('ai-panel:clear-chat', () => {
    if (!activeTabId) return
    const ctx = tabContexts.get(activeTabId)
    if (!ctx) return
    resetChat(ctx, activeTabUrl)
    sendCurrentContext()
  })

  ipcMain.on('ai-panel:quick-translate', (event: IpcMainEvent, requestedTab?: unknown) => {
    const wc = event.sender
    const tabId = pickTabId(requestedTab)
    if (!tabId) return
    const ctx = getOrCreateContext(tabId, tabId === activeTabId ? activeTabUrl : '', ctxTitle(tabId))
    ctx.messages.push({ role: 'user', text: 'Перевести' })
    const job = beginJob(ctx, 'chat')
    const needsExtraction = ctx.pageText === null
    const pageWc = needsExtraction ? pageWcOf(tabId) : null
    void (async () => {
      if (needsExtraction) {
        const extracted = await extractPageText(pageWc)
        if (!stillJob(ctx, job)) return
        if (extracted.ok) {
          ctx.pageText = extracted.text
          ctx.pageMarkdown = extracted.markdown
        }
        console.log(`[ai-panel] текст страницы извлечён: ${extracted.text.length} симв.`)
      }
      const pageText = ctx.pageText ?? ''
      let promptText = 'Переведи содержимое этой страницы.'
      if (pageText) {
        const { src, tgt } = await resolveDirection('auto', pageText)
        promptText = buildPrompt(src, tgt, pageText)
      }
      const outcome = await runChatMessage(promptText, ctx.history, (chunkText) => {
        if (showing(tabId, wc)) wc.send('ai-panel:chat-chunk', chunkText)
      })
      if (!stillJob(ctx, job)) return
      if (outcome.ok) {
        ctx.messages.push({ role: 'assistant', text: outcome.out, files: outcome.files, via: outcome.via })
        ctx.history = outcome.history
        finishJob(ctx, job)
      } else {
        rememberError(ctx, job, outcome.error, outcome.errorCode)
      }
      if (showing(tabId, wc)) wc.send('ai-panel:chat-result', outcome)
    })()
  })

  ipcMain.on('ai-panel:fact-check', (event: IpcMainEvent, requestedTab?: unknown) => {
    const wc = event.sender
    const tabId = pickTabId(requestedTab)
    if (!tabId) return
    const ctx = getOrCreateContext(tabId, tabId === activeTabId ? activeTabUrl : '', ctxTitle(tabId))
    ctx.messages.push({ role: 'user', text: 'Фактчек' })
    const job = beginJob(ctx, 'factcheck')
    const title = ctx.title || activeTabTitle
    const url = ctx.url || activeTabUrl
    const needsExtraction = ctx.pageText === null
    const pageWc = needsExtraction ? pageWcOf(tabId) : null
    void (async () => {
      if (needsExtraction) {
        const extracted = await extractPageText(pageWc)
        if (!stillJob(ctx, job)) return
        if (extracted.ok) {
          ctx.pageText = extracted.text
          ctx.pageMarkdown = extracted.markdown
        }
        console.log(`[ai-panel] текст страницы извлечён: ${extracted.text.length} симв. (для фактчека)`)
      }
      const outcome = await runFactCheck(ctx.pageText ?? '', title, url)
      if (!stillJob(ctx, job)) return
      if (outcome.ok) {
        ctx.messages.push({ role: 'assistant', text: outcome.out })
        finishJob(ctx, job)
      } else {
        rememberError(ctx, job, outcome.error)
      }
      if (showing(tabId, wc)) wc.send('ai-panel:chat-result', outcome)
    })()
  })
}

function ctxTitle(tabId: string): string {
  return tabId === activeTabId ? activeTabTitle : (tabContexts.get(tabId)?.title ?? '')
}

async function runGrounded(
  wc: WebContents, tabId: string, ctx: TabChatContext, job: number, text: string,
): Promise<void> {
  const search = await searxngSearch(text)
  if (!stillJob(ctx, job)) return
  if (!search.ok) {
    rememberError(ctx, job, search.error)
    if (showing(tabId, wc)) wc.send('ai-panel:chat-result', { ok: false, error: search.error })
    return
  }
  if (ctx.pending === 'search') ctx.pending = 'chat'
  const promptText = buildGroundingPrompt(text, search.results)
  const outcome = await runChatMessage(promptText, ctx.history, (chunkText) => {
    if (showing(tabId, wc)) wc.send('ai-panel:chat-chunk', chunkText)
  })
  if (!stillJob(ctx, job)) return
  if (outcome.ok) {
    const withSources = appendSearxngSources(outcome.out, search.results)
    ctx.messages.push({ role: 'assistant', text: withSources, files: outcome.files, via: outcome.via })
    ctx.history = outcome.history
    finishJob(ctx, job)
    if (showing(tabId, wc)) wc.send('ai-panel:chat-result', { ...outcome, out: withSources })
  } else {
    rememberError(ctx, job, outcome.error, outcome.errorCode)
    if (showing(tabId, wc)) wc.send('ai-panel:chat-result', outcome)
  }
}
