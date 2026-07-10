// Живые поисковые подсказки (suggest-API текущего движка) — заход 10, дополнение к
// history/tab-подсказкам в Toolbar.tsx::buildSuggestions. Fetch ТОЛЬКО из main-процесса: ни один
// из трёх эндпоинтов (Google/DuckDuckGo/Yandex) не шлёт Access-Control-Allow-Origin (проверено
// вручную curl'ом на все три) — fetch из renderer получил бы заблокированный CORS-ом ответ
// (сеть отработает, но JS не сможет прочитать тело). Main — обычный Node-контекст, CORS там не
// действует вовсе.
//
// ⚠️ net.fetch (модуль Electron 'net'), НЕ глобальный fetch() — живой аудит утечек VPN (см. план,
// шаг 3) поймал именно этот файл: глобальный fetch() идёт через сетевой стек Node/undici и НЕ
// уважает session.setProxy() — при включённом VPN подсказки при наборе в омнибоксе продолжали бы
// идти напрямую, светя реальный IP поисковику. net.fetch — часть session.defaultSession.
import { net } from 'electron'
import { getSearchEngine } from '../shared/searchEngines'
import type { SearchEngineId } from '../shared/searchEngines'

// Не висеть, если эндпоинт не отвечает — таймаут через AbortController (совмещён с отменой
// устаревшего запроса ниже, один и тот же signal).
const FETCH_TIMEOUT_MS = 3000
// Разумный потолок строк — независимо от того, сколько фраз вернул движок.
const MAX_SUGGESTIONS = 5

// «Новый запрос отменяет предыдущий» — простой и надёжный способ не получить устаревший ответ
// поверх свежего (пользователь печатает быстрее, чем отвечает сеть), без отдельного канала
// отмены через IPC (ipcRenderer.invoke не поддерживает cancel из коробки). Единственный источник
// живых suggest-запросов во всём приложении — один модульный слот безопасен, гонок между
// несколькими одновременными вызовами быть не может (омнибокс один).
let currentAbort: AbortController | null = null

export async function fetchSearchSuggestions(query: string, engineId: SearchEngineId): Promise<string[]> {
  if (!query.trim()) return []

  currentAbort?.abort()
  const controller = new AbortController()
  currentAbort = controller
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const engine = getSearchEngine(engineId)
    const res = await net.fetch(engine.suggestUrl(query), { signal: controller.signal })
    if (!res.ok) return []
    const json = await res.json()
    return engine.parseSuggest(json).slice(0, MAX_SUGGESTIONS)
  } catch (e) {
    // Отмена (AbortError) — ожидаемый исход на каждый новый ввод/таймаут, не ошибка приложения.
    if ((e as Error).name !== 'AbortError') {
      console.log(`[suggest-fetch] failed: ${(e as Error).message}`)
    }
    return []
  } finally {
    clearTimeout(timeout)
    if (currentAbort === controller) currentAbort = null
  }
}
