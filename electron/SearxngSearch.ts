// Web-grounding для AI-панели через собственный SearXNG сервера пользователя — по образцу
// GeminiFactCheck.ts (то же fetchInProfile на session.defaultSession, тот же путь в сеть, автоматически
// идущий через VPN, если он включён, см. main.ts::applyVpnProxy). В отличие от фактчека, эта
// функция — ТОЛЬКО добыча и разбор результатов; генерация ответа уходит в обычный стрим-путь
// Qwen (runChatMessage), не в собственный blocking-вызов модели, см. AiPanelManager.ts.
import { getConfig } from './SearxngKeyStore'
import { fetchInProfile } from './ProfileSession';

export interface SearxngResult {
  title: string
  url: string
  content: string
}

export type SearxngSearchOutcome =
  | { ok: true; results: SearxngResult[] }
  | { ok: false; error: string }

const RESULT_LIMIT = 6
const FETCH_TIMEOUT_MS = 10_000

// Страховки по образцу PAGE_TEXT_MAX_CHARS в AiPanelManager.ts — 6 сниппетов и так укладываются
// в разы меньше того лимита, но обрезка всё равно закладывается на случай аномально длинных
// content/title (SEO-спам, редиректы) или будущего увеличения RESULT_LIMIT.
const SNIPPET_CONTENT_MAX_CHARS = 800
const SNIPPET_TITLE_MAX_CHARS = 200
const GROUNDING_SNIPPETS_MAX_CHARS = 6000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>

export async function searxngSearch(query: string): Promise<SearxngSearchOutcome> {
  const config = getConfig()
  if (!config) return { ok: false, error: 'SearXNG не настроен' }
  const q = query.trim()
  if (!q) return { ok: false, error: 'Пустой запрос' }

  const base = config.endpoint.replace(/\/$/, '')
  const url = `${base}/search?q=${encodeURIComponent(q)}&format=json&language=ru`

  const headers: Record<string, string> = {}
  // token хранится как "логин:пароль" (см. SearxngKeyStore.ts, Settings.tsx) — SearXNG сам по себе
  // не определяет схему авторизации API, self-hosted инстансы почти всегда закрывают доступ HTTP
  // Basic Auth на уровне reverse-proxy (nginx auth_basic) — отсюда именно Basic, не Bearer.
  if (config.token) {
    headers.Authorization = `Basic ${Buffer.from(config.token, 'utf8').toString('base64')}`
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetchInProfile(url, { headers, signal: controller.signal })
  } catch (e) {
    // AbortError (наш же таймаут) — отдельное, более понятное сообщение, чем сырой "aborted".
    // Всё остальное (в т.ч. VPN kill-switch: socks5://127.0.0.1:1 из main.ts::applyVpnProxy —
    // соединение с мёртвым портом падает тем же путём, ERR_SOCKS_CONNECTION_FAILED и подобные)
    // просто прокидываем текстом ошибки — не глотаем молча.
    if (e instanceof Error && e.name === 'AbortError') {
      return { ok: false, error: `SearXNG не ответил за ${FETCH_TIMEOUT_MS / 1000}с — сервер недоступен или VPN не пропускает трафик` }
    }
    return { ok: false, error: e instanceof Error ? e.message : 'Сеть недоступна' }
  } finally {
    clearTimeout(timeout)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[searxng] ${res.status}: ${body.slice(0, 500)}`)
    return { ok: false, error: `SearXNG вернул ошибку ${res.status}` }
  }

  let data: AnyRecord
  try {
    data = await res.json() as AnyRecord
  } catch {
    return { ok: false, error: 'Не удалось разобрать ответ SearXNG' }
  }

  const raw: AnyRecord[] = Array.isArray(data?.results) ? data.results : []
  const results: SearxngResult[] = raw
    .slice(0, RESULT_LIMIT)
    .map((r) => ({
      title: typeof r?.title === 'string' && r.title ? r.title.slice(0, SNIPPET_TITLE_MAX_CHARS) : '',
      url: typeof r?.url === 'string' ? r.url : '',
      content: typeof r?.content === 'string' ? r.content.slice(0, SNIPPET_CONTENT_MAX_CHARS) : '',
    }))
    .filter((r) => r.url) // без url источник нечем цитировать — выбрасываем, не показываем как «мусорный»
    .map((r) => ({ ...r, title: r.title || r.url }))

  console.log(`[searxng] запрос «${q}» → ${results.length} результатов`)
  return { ok: true, results }
}

// Промпт для Qwen — пронумерованные сниппеты + инструкция отвечать только по источникам и честно
// признавать нехватку данных вместо выдумывания. Источники в сам промпт кладём с number → тем же
// [N], которые модель должна проставлять инлайн в ответе (см. appendSearxngSources ниже — итоговый
// список после генерации использует ТЕ ЖЕ номера по порядку тех же results).
export function buildGroundingPrompt(query: string, results: SearxngResult[]): string {
  const snippets = results
    .map((r, i) => `[${i + 1}] ${r.title} — ${r.content} (${r.url})`)
    .join('\n\n')
    .slice(0, GROUNDING_SNIPPETS_MAX_CHARS)

  return 'You are a helpful assistant with access to web search results. Using ONLY the numbered ' +
    'sources below, answer the user\'s question in the same language the question is written in. ' +
    'Cite sources inline as [N], where N is the source number. If the sources do not contain enough ' +
    'information to answer, say so honestly instead of making something up.\n\n' +
    `Sources:\n${snippets}\n\nQuestion: ${query}`
}

// Источники — ТОЛЬКО из структурного results (см. предупреждение в GeminiFactCheck.ts: никогда
// из текста генерации модели). Нумерация совпадает с тем, что подставлено в промпт выше — те же
// results, тот же порядок, тот же индекс+1.
export function appendSearxngSources(text: string, results: SearxngResult[]): string {
  if (results.length === 0) return text
  const list = results.map((r, i) => `${i + 1}. [${r.title}](${r.url})`).join('\n')
  return `${text}\n\n**Источники:**\n${list}`
}
