// Наборы контекста AI-панели: инструкции и материал, которые человек закрепляет вместо страницы.
//
// ⚠️ ЗАЧЕМ. Беседа панели до сих пор жила только «про вкладку»: текст страницы подмешивался в
// первый ход, а смена URL сбрасывала разговор. Набор — второй источник контекста: «отвечай на
// присланные сообщения в такой-то стилистике», заданный один раз в настройках. Отвязанная от
// страницы беседа не сбрасывается ни переключением вкладок, ни навигацией.
//
// ⚠️ Каналы — НЕ из shared/ipc, тем же приёмом, что INSIGHTS (shared/pageInsights.ts): фича
// целиком лежит в одном файле, а сторож контракта эти строки не видит. Правишь канал — правь и
// обработчик (electron/ipc/aiHub.ts), и оба моста (preload/aiContexts.ts, preload-aipanel.ts).
//
// ⚠️ Только типовые импорты: файл гоняется голым node в scripts/ai-contexts-check.mjs.

export const AI_CONTEXTS = {
  list: 'ai-contexts:list',
  save: 'ai-contexts:save',
  remove: 'ai-contexts:remove',
  setDefault: 'ai-contexts:set-default',
  changed: 'ai-contexts:changed',
  /** Панель → main: человек выбрал источник беседы на плашке. */
  setSource: 'ai-panel:set-source',
} as const

// ⚠️ Потолок — ради локальной модели, а не ради диска. Набор уходит системным промптом в КАЖДЫЙ
// запрос, и у Qwen он съедает тот же контекст, что и история беседы. 12 тысяч символов — это
// ~3–4 тысячи токенов: страница в первом ходе (PAGE_TEXT_MAX_CHARS) всё равно больше.
export const PRESET_TEXT_MAX = 12000
export const PRESET_TITLE_MAX = 60

export interface AiContextPreset { id: string; title: string; text: string }

export interface AiContextsState {
  presets: AiContextPreset[]
  /** С какого набора панель начинает беседу. null — со страницы, как было до наборов. */
  defaultId: string | null
}

export const EMPTY_CONTEXTS: AiContextsState = { presets: [], defaultId: null }

/** Откуда беседа берёт контекст: страница под панелью, закреплённый набор или ничего. */
export type ChatSource = { kind: 'page' } | { kind: 'none' } | { kind: 'preset'; id: string }

export const PAGE_SOURCE: ChatSource = { kind: 'page' }

export interface AiContextsApi {
  aiContexts(): Promise<AiContextsState>
  /** id нет — новый набор; есть — правка. null — набор не прошёл проверку. */
  saveAiContext(input: { id?: string; title: string; text: string }): Promise<AiContextsState | null>
  removeAiContext(id: string): Promise<AiContextsState>
  setDefaultAiContext(id: string | null): Promise<AiContextsState>
  onAiContextsChanged(cb: (state: AiContextsState) => void): () => void
}

/**
 * Проверка ввода набора. Пустое имя не ошибка: берём первую строку текста — человек, вставивший
 * инструкцию, не обязан придумывать ей заголовок.
 */
export function sanitizePreset(input: unknown): { title: string; text: string } | null {
  if (!input || typeof input !== 'object') return null
  const v = input as Record<string, unknown>
  if (typeof v.text !== 'string') return null
  const text = v.text.trim().slice(0, PRESET_TEXT_MAX)
  if (!text) return null
  const rawTitle = typeof v.title === 'string' ? v.title.trim() : ''
  const fallback = text.split('\n')[0].trim()
  const title = (rawTitle || fallback).slice(0, PRESET_TITLE_MAX).trim()
  return { title: title || 'Набор', text }
}

/**
 * Разбор файла с диска. null — файл ИСПОРЧЕН (не «пустой»): хранилище обязано отличать одно от
 * другого, иначе первая же запись молча затёрла бы наборы человека дефолтом.
 */
export function normalizeContexts(raw: unknown): AiContextsState | null {
  if (!raw || typeof raw !== 'object' || !Array.isArray((raw as { presets?: unknown }).presets)) return null
  const v = raw as { presets: unknown[]; defaultId?: unknown }
  const presets: AiContextPreset[] = []
  const seen = new Set<string>()
  for (const item of v.presets) {
    const p = item as Record<string, unknown> | null
    const clean = sanitizePreset(p)
    if (!clean || typeof p?.id !== 'string' || !p.id || seen.has(p.id)) return null
    seen.add(p.id)
    presets.push({ id: p.id, ...clean })
  }
  const defaultId = typeof v.defaultId === 'string' && seen.has(v.defaultId) ? v.defaultId : null
  return { presets, defaultId }
}

/** Источник, с которого открывается панель: набор по умолчанию, если он есть, иначе страница. */
export function initialSource(state: AiContextsState): ChatSource {
  return state.defaultId && state.presets.some((p) => p.id === state.defaultId)
    ? { kind: 'preset', id: state.defaultId }
    : PAGE_SOURCE
}

/** Набор удалили, пока на нём стояла беседа, — возвращаемся к странице, а не к пустоте. */
export function resolveSource(source: ChatSource, state: AiContextsState): ChatSource {
  if (source.kind !== 'preset') return source
  return state.presets.some((p) => p.id === source.id) ? source : PAGE_SOURCE
}

export function parseSource(raw: unknown): ChatSource | null {
  if (!raw || typeof raw !== 'object') return null
  const v = raw as Record<string, unknown>
  if (v.kind === 'page' || v.kind === 'none') return { kind: v.kind }
  if (v.kind === 'preset' && typeof v.id === 'string' && v.id) return { kind: 'preset', id: v.id }
  return null
}

/**
 * Идентификатор беседы, которым панель подписывает отправку. У страницы это id вкладки, у
 * отвязанной беседы — 'free:…'. ⚠️ Строка, а не объект: ровно этот id уже ходит в sendChat и
 * в onContext, и вторая система адресации разошлась бы с первой.
 */
export function freeChatId(source: ChatSource): string {
  return source.kind === 'preset' ? `free:preset:${source.id}` : 'free:none'
}

export function sourceFromChatId(id: string): ChatSource | null {
  if (id === 'free:none') return { kind: 'none' }
  if (id.startsWith('free:preset:') && id.length > 'free:preset:'.length) {
    return { kind: 'preset', id: id.slice('free:preset:'.length) }
  }
  return null
}

/**
 * Системный промпт с закреплённым набором.
 *
 * ⚠️ Набор — в SYSTEM, а не в первом сообщении, как текст страницы. Страница — материал к одному
 * разговору, набор — правило на всю беседу: из первого хода модели (особенно облачные) охотно
 * «забывают» инструкции через несколько ответов, системные держат.
 */
export function withInstructions(base: string, text: string | undefined): string {
  const pinned = text?.trim()
  if (!pinned) return base
  return `${base}\n\nThe user has pinned standing instructions and context for this conversation. ` +
    'Follow them in every reply unless the user explicitly overrides them in a message:\n' +
    `"""\n${pinned}\n"""`
}
