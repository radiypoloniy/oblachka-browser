// Хранилище наборов контекста AI-панели (shared/aiContexts.ts) — userData/ai-contexts.json.
//
// Образец — SkillsStore.ts: свой файл, слушатели, запись через .tmp + rename. Отличие одно и
// намеренное: испорченный файл НЕ подменяется дефолтом. SkillsStore может себе это позволить
// (встроенные скиллы восстановимы), а наборы человек писал руками — их копия откладывается рядом
// (.broken-<время>) до первой записи, чтобы потерять их было нельзя даже при сбое разбора.
//
// ⚠️ Загрузка ленивая, на первое обращение, а не из main.ts: тот стоит на храповике структуры,
// а userData к моменту первого обращения (открытие панели или настроек) давно известен.
import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { EMPTY_CONTEXTS, normalizeContexts, sanitizePreset, presetPrompt, type AiContextsState } from '../shared/aiContexts'

type Listener = (state: AiContextsState, prev: AiContextsState) => void

let state: AiContextsState | null = null
let brokenFile = false
const listeners = new Set<Listener>()

function filePath(): string {
  return path.join(app.getPath('userData'), 'ai-contexts.json')
}

function load(): AiContextsState {
  if (state) return state
  try {
    const parsed = normalizeContexts(JSON.parse(fs.readFileSync(filePath(), 'utf8')))
    if (parsed) state = parsed
    else { brokenFile = true; console.error('[AiContextStore] ai-contexts.json не разобран — файл сохранится копией') }
  } catch (e) {
    // Файла нет — первый запуск. Любая другая ошибка чтения — тот же испорченный случай.
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') brokenFile = true
  }
  state ??= EMPTY_CONTEXTS
  return state
}

export function getState(): AiContextsState {
  return load()
}

export function presetText(id: string): string | undefined {
  const preset = load().presets.find((p) => p.id === id)
  return preset ? presetPrompt(preset) : undefined
}

export function save(input: unknown): AiContextsState | null {
  const clean = sanitizePreset(input)
  if (!clean) return null
  const cur = load()
  const id = (input as { id?: unknown }).id
  if (typeof id === 'string' && id) {
    if (!cur.presets.some((p) => p.id === id)) return null
    return commit({ ...cur, presets: cur.presets.map((p) => (p.id === id ? { id, ...clean } : p)) })
  }
  return commit({ ...cur, presets: [...cur.presets, { id: randomUUID(), ...clean }] })
}

export function remove(id: string): AiContextsState {
  const cur = load()
  return commit({
    presets: cur.presets.filter((p) => p.id !== id),
    defaultId: cur.defaultId === id ? null : cur.defaultId,
  })
}

export function setDefault(id: string | null): AiContextsState {
  const cur = load()
  const next = id && cur.presets.some((p) => p.id === id) ? id : null
  return commit({ ...cur, defaultId: next })
}

export function onChanged(cb: Listener): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function commit(next: AiContextsState): AiContextsState {
  const prev = load()
  state = next
  write()
  for (const cb of listeners) cb(next, prev)
  return next
}

function write(): void {
  const file = filePath()
  try {
    if (brokenFile) {
      fs.copyFileSync(file, `${file}.broken-${Date.now()}`)
      brokenFile = false
    }
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2), 'utf8')
    fs.renameSync(`${file}.tmp`, file)
  } catch (e) {
    console.error('[AiContextStore] не удалось записать ai-contexts.json:', e)
  }
}
