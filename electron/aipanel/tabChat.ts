// Беседа AI-панели по вкладке: контекст, занятость и три входа (чат / перевод / фактчек).
//
// ⚠️ ВЫНЕСЕНО ИЗ AiPanelManager.ts из-за храповика: тому файлу расти некуда, а чинить тут
// пришлось дыру «спросил саммари, переключил вкладку — ответ исчез».
// ⚠️ Ответ пишется в КОНТЕКСТ вкладки, с которой спросили, а не в глобальный activeTabId:
// IPC может доехать уже после переключения, и тогда саммари оседало в чужой ленте, а в своей
// onContext гасил sending. Панель показывает стрим, только пока смотрит ту же вкладку; вернулись —
// в контексте уже лежит готовый ответ (или флаг, что ещё считается).

import { ipcMain } from 'electron'
import { panelBySender } from './instances'
import type { IpcMainEvent, WebContents } from 'electron'
import type { ModelErrorCode } from '../../shared/ipc'
import { runChatMessage, resolveDirection, buildPrompt } from '../TranslationService'
import { runFactCheck } from '../GeminiFactCheck'
import { searxngSearch, buildGroundingPrompt, appendSearxngSources } from '../SearxngSearch'
import {
  getOrCreateContext, instructionsFor, resetChat, selectionFor, sendCurrentContext, sendToTab, setPanelSource,
  tabContexts, pageWcOf, type TabChatContext,
} from './chatOwnership'
import { AI_CONTEXTS, parseSource } from '../../shared/aiContexts'
export { sendCurrentContext, syncTabChat } from './chatOwnership'

let extractPageText: (wc: WebContents | null) => Promise<{ ok: boolean; text: string; markdown: string | null }> = async () => (
  { ok: false, text: '', markdown: null }
)
let buildFirstTurn: (pageText: string, pageTitle: string, userText: string) => string = (_p, _t, u) => u

export function wireTabChat(deps: {
  extractPageText: (wc: WebContents | null) => Promise<{ ok: boolean; text: string; markdown: string | null }>
  buildFirstTurnPrompt: (pageText: string, pageTitle: string, userText: string) => string
}): void {
  extractPageText = deps.extractPageText
  buildFirstTurn = deps.buildFirstTurnPrompt
}

function beginJob(ctx: TabChatContext, kind: NonNullable<TabChatContext['pending']>): number {
  ctx.abort = new AbortController()
  ctx.job += 1
  ctx.pending = kind
  ctx.error = null
  ctx.errorCode = null
  return ctx.job
}

function stillJob(ctx: TabChatContext, job: number): boolean {
  return tabContexts.get(ctx.key) === ctx && ctx.job === job && !ctx.abort?.signal.aborted
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

function unexpected(ctx: TabChatContext, job: number, tabId: string, error: unknown): void {
  if (!stillJob(ctx, job)) return
  const message = error instanceof Error ? error.message : String(error)
  rememberError(ctx, job, message)
  sendToTab(tabId, 'ai-panel:chat-result', { ok: false, error: message }, ctx.key)
}

export function registerTabChatIpc(): void {
  ipcMain.on('ai-panel:chat-send', (event: IpcMainEvent, text: string, webGrounding: boolean, requestedTab?: unknown) => {
    const wc = event.sender
    const send = (channel: string, data: unknown) => sendToTab(tabId, channel, data, ctx.key)
    const selection = selectionFor(wc, requestedTab)
    if (!selection) return
    const tabId = selection.id
    const ctx = getOrCreateContext(selection.key, selection.url, selection.title)
    if (ctx.pending) return
    ctx.messages.push({ role: 'user', text })
    const job = beginJob(ctx, webGrounding ? 'search' : 'chat')
    const title = ctx.title || selection.title
    const instructions = instructionsFor(selection.source)

    if (webGrounding) {
      void runGrounded(tabId, ctx, job, text, instructions).catch(e => unexpected(ctx, job, tabId, e))
      return
    }

    // Отвязанная беседа страницу не читает вовсе — ни в первом ходе, ни потом: в этом её смысл.
    const needsExtraction = selection.source.kind === 'page' && ctx.pageText === null
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
        if (stillJob(ctx, job)) send('ai-panel:chat-chunk', chunkText)
      }, ctx.abort?.signal, 'chat', instructions)
      if (!stillJob(ctx, job)) return
      if (outcome.ok) {
        ctx.messages.push({ role: 'assistant', text: outcome.out, files: outcome.files, via: outcome.via })
        ctx.history = outcome.history
        finishJob(ctx, job)
      } else {
        rememberError(ctx, job, outcome.error, outcome.errorCode)
      }
      if (stillJob(ctx, job)) send('ai-panel:chat-result', outcome)
    })().catch(e => unexpected(ctx, job, tabId, e))
  })

  // Плашка панели: страница / набор / пустой чат. Беседы не сбрасываются — у каждого источника
  // своя, и вернуться к странице значит вернуться к её разговору, а не начать заново.
  ipcMain.on(AI_CONTEXTS.setSource, (event, raw: unknown) => {
    const panel = panelBySender(event.sender)
    const source = parseSource(raw)
    if (panel && source) setPanelSource(panel, source)
  })

  ipcMain.on('ai-panel:clear-chat', (event) => {
    const selected = selectionFor(event.sender)
    if (!selected) return
    const ctx = tabContexts.get(selected.key)
    if (!ctx) return
    resetChat(ctx, selected.url)
    const panel = panelBySender(event.sender)
    if (panel) sendCurrentContext(panel.win)
  })

  ipcMain.on('ai-panel:quick-translate', (event: IpcMainEvent, requestedTab?: unknown) => {
    const wc = event.sender
    const send = (channel: string, data: unknown) => sendToTab(tabId, channel, data, ctx.key)
    const selection = selectionFor(wc, requestedTab)
    // Перевод и фактчек — действия НАД страницей; у отвязанной беседы страницы нет.
    if (!selection || selection.source.kind !== 'page') return
    const tabId = selection.id
    const ctx = getOrCreateContext(selection.key, selection.url, selection.title)
    if (ctx.pending) return
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
      if (!stillJob(ctx, job)) return
      const outcome = await runChatMessage(promptText, ctx.history, (chunkText) => {
        if (stillJob(ctx, job)) send('ai-panel:chat-chunk', chunkText)
      }, ctx.abort?.signal)
      if (!stillJob(ctx, job)) return
      if (outcome.ok) {
        ctx.messages.push({ role: 'assistant', text: outcome.out, files: outcome.files, via: outcome.via })
        ctx.history = outcome.history
        finishJob(ctx, job)
      } else {
        rememberError(ctx, job, outcome.error, outcome.errorCode)
      }
      if (stillJob(ctx, job)) send('ai-panel:chat-result', outcome)
    })().catch(e => unexpected(ctx, job, tabId, e))
  })

  ipcMain.on('ai-panel:fact-check', (event: IpcMainEvent, requestedTab?: unknown) => {
    const wc = event.sender
    const send = (channel: string, data: unknown) => sendToTab(tabId, channel, data, ctx.key)
    const selection = selectionFor(wc, requestedTab)
    if (!selection || selection.source.kind !== 'page') return
    const tabId = selection.id
    const ctx = getOrCreateContext(selection.key, selection.url, selection.title)
    if (ctx.pending) return
    ctx.messages.push({ role: 'user', text: 'Фактчек' })
    const job = beginJob(ctx, 'factcheck')
    const title = ctx.title || selection.title
    const url = ctx.url || selection.url
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
      if (stillJob(ctx, job)) send('ai-panel:chat-result', outcome)
    })().catch(e => unexpected(ctx, job, tabId, e))
  })
}

async function runGrounded(
  tabId: string, ctx: TabChatContext, job: number, text: string, instructions?: string,
): Promise<void> {
  const send = (channel: string, data: unknown) => sendToTab(tabId, channel, data, ctx.key)
  const search = await searxngSearch(text)
  if (!stillJob(ctx, job)) return
  if (!search.ok) {
    rememberError(ctx, job, search.error)
    if (stillJob(ctx, job)) send('ai-panel:chat-result', { ok: false, error: search.error })
    return
  }
  if (ctx.pending === 'search') ctx.pending = 'chat'
  const promptText = buildGroundingPrompt(text, search.results)
  const outcome = await runChatMessage(promptText, ctx.history, (chunkText) => {
    if (stillJob(ctx, job)) send('ai-panel:chat-chunk', chunkText)
  }, ctx.abort?.signal, 'chat', instructions)
  if (!stillJob(ctx, job)) return
  if (outcome.ok) {
    const withSources = appendSearxngSources(outcome.out, search.results)
    ctx.messages.push({ role: 'assistant', text: withSources, files: outcome.files, via: outcome.via })
    ctx.history = outcome.history
    finishJob(ctx, job)
    if (stillJob(ctx, job)) send('ai-panel:chat-result', { ...outcome, out: withSources })
  } else {
    rememberError(ctx, job, outcome.error, outcome.errorCode)
    if (stillJob(ctx, job)) send('ai-panel:chat-result', outcome)
  }
}
