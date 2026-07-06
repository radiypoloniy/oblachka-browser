// Заход D (шаг 5) — фактчек через Gemini API с Search Grounding (google_search tool).
// ⚠️ Архитектурное требование, не опция: ссылки в отчёте берутся ТОЛЬКО из groundingMetadata
// реального ответа API (candidate.groundingMetadata.groundingChunks[].web), никогда из текста
// генерации модели — иначе фича с названием "фактчек" может показать несуществующие источники.
// net.fetch — тот же способ похода в сеть из main, что уже используется для кэша favicon
// (см. TabManager.ts::#cacheFaviconData) — не заводим отдельный http-клиент/зависимость.
import { net } from 'electron'
import { getKey } from './AiKeyStore'

export type FactCheckOutcome =
  | { ok: true; out: string }
  | { ok: false; error: string }

const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>

function buildFactCheckPrompt(title: string, url: string, pageText: string): string {
  return 'You are a fact-checking assistant built into a web browser. Using Google Search grounding, ' +
    'verify the factual claims made on the following web page and report your findings in the same ' +
    'language the page is written in. Be concise but specific about what is accurate, inaccurate, ' +
    'outdated, or unverifiable — do not just restate the page content.\n\n' +
    `Page title: "${title}"\nPage URL: ${url}\n\nPage content:\n"""\n${pageText}\n"""`
}

export async function runFactCheck(pageText: string, pageTitle: string, pageUrl: string): Promise<FactCheckOutcome> {
  const apiKey = getKey()
  if (!apiKey) return { ok: false, error: 'Ключ Gemini не подключён' }
  if (!pageText) return { ok: false, error: 'Не удалось получить текст страницы для проверки' }

  const prompt = buildFactCheckPrompt(pageTitle, pageUrl, pageText)

  let res: Response
  try {
    res = await net.fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
      }),
    })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Сеть недоступна' }
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[fact-check] Gemini API ${res.status}: ${body.slice(0, 500)}`)
    return { ok: false, error: `Gemini API вернул ошибку ${res.status}` }
  }

  let data: AnyRecord;
  try {
    data = await res.json() as AnyRecord
  } catch {
    return { ok: false, error: 'Не удалось разобрать ответ Gemini' }
  }

  const candidate: AnyRecord | undefined = data?.candidates?.[0]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text: string = (candidate?.content?.parts ?? []).map((p: AnyRecord) => p?.text ?? '').join('')
  if (!text) {
    console.error('[fact-check] пустой ответ Gemini:', JSON.stringify(data).slice(0, 500))
    return { ok: false, error: 'Пустой ответ от Gemini' }
  }

  // Ссылки — только реальные groundingChunks, см. предупреждение в шапке файла.
  const groundingChunks: AnyRecord[] = candidate?.groundingMetadata?.groundingChunks ?? []
  const sources: { title: string; uri: string }[] = groundingChunks
    .map((c) => c?.web)
    .filter((w): w is AnyRecord => typeof w?.uri === 'string' && w.uri.length > 0)
    .map((w) => ({ title: typeof w.title === 'string' && w.title ? w.title : w.uri, uri: w.uri }))

  const out = sources.length > 0
    ? `${text}\n\n**Источники:**\n${sources.map((s) => `- [${s.title}](${s.uri})`).join('\n')}`
    : text

  console.log(`[fact-check] готово: ${text.length} симв., источников: ${sources.length}`)
  return { ok: true, out }
}
