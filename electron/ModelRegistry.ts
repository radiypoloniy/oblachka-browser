import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

// Реестр установленных на диске GGUF-моделей — первый шаг к тому, чтобы браузер запускался и
// работал без единой модели на диске (сейчас путь к Qwen захардкожен, см.
// TranslationService.ts:250). Этот модуль НИКУДА не подключён — только читает диск и хранит
// список найденного; сама загрузка модели (TranslationService.ts) этим коммитом не меняется.

export interface InstalledModel {
  id: string           // стабильный slug из имени файла, см. slugify ниже
  label: string         // человекочитаемое имя
  filePath: string      // абсолютный путь на диске
  sizeBytes: number
  source: 'legacy' | 'downloaded'
}

export interface ModelRegistryState {
  models: InstalledModel[]
  defaultModelId: string | null
}

// Начинаем с 1 — в отличие от settings.json (SettingsManager.ts), здесь версия понадобится
// раньше: формат реестра моделей будет меняться быстрее (загрузка/удаление моделей — следующие
// коммиты). Миграционную функцию пока не пишем (см. задачу) — незнакомая версия ведёт себя как
// пустой файл (ниже, в load()).
const SCHEMA_VERSION = 1

interface PersistedRegistry {
  schemaVersion: number
  models: InstalledModel[]
  defaultModelId: string | null
}

// Тот же файл, что жёстко зашит в TranslationService.ts:250 — используется только чтобы выбрать
// его дефолтом при сид-скане (см. seedFromDisk), самой загрузки модели не касается.
const LEGACY_DEFAULT_FILENAME = 'Qwen3.5-9B-Q4_K_M.gguf'

function isSource(v: unknown): v is InstalledModel['source'] {
  return v === 'legacy' || v === 'downloaded'
}

function isInstalledModel(v: unknown): v is InstalledModel {
  if (typeof v !== 'object' || v === null) return false
  const m = v as Record<string, unknown>
  return (
    typeof m.id === 'string' && m.id.length > 0 &&
    typeof m.label === 'string' &&
    typeof m.filePath === 'string' && m.filePath.length > 0 &&
    typeof m.sizeBytes === 'number' && Number.isFinite(m.sizeBytes) &&
    isSource(m.source)
  )
}

let state: ModelRegistryState = { models: [], defaultModelId: null }

function registryPath(): string {
  return path.join(app.getPath('userData'), 'models.json')
}

// Запись — по образцу SettingsManager.ts#write (114-126): атомарно через tmp+rename, ошибка
// диска молча проглатывается — реестр остаётся применённым в памяти на эту сессию.
function write(): void {
  const data: PersistedRegistry = {
    schemaVersion: SCHEMA_VERSION,
    models: state.models,
    defaultModelId: state.defaultModelId,
  }
  const targetPath = registryPath()
  const tmpPath = targetPath + '.tmp'
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8')
    fs.renameSync(tmpPath, targetPath)
  } catch { /* ошибка диска — реестр останется применённым в памяти на эту сессию */ }
}

// Чтение — по образцу SettingsManager.ts#load (97-112): файла нет или битый JSON → остаёмся на
// пустом состоянии. Незнакомая schemaVersion — та же деградация (миграций пока нет). Каждая
// запись models валидируется отдельно (isInstalledModel) — битая запись выпадает, а не весь файл.
function load(): void {
  try {
    const raw = fs.readFileSync(registryPath(), 'utf8')
    const data = JSON.parse(raw) as unknown
    if (typeof data !== 'object' || data === null) return
    const d = data as Record<string, unknown>
    if (d.schemaVersion !== SCHEMA_VERSION) return
    const models = Array.isArray(d.models) ? d.models.filter(isInstalledModel) : []
    const defaultModelId = typeof d.defaultModelId === 'string' ? d.defaultModelId : null
    state = { models, defaultModelId }
  } catch { /* файла нет или битый JSON — остаёмся на дефолте (пустой реестр) */ }
}

// Расширение срезается ДО слагификации (иначе ".gguf" даёт лишний хвост "-gguf" в каждом id),
// группы non-alnum схлопываются в один дефис, дефисы по краям обрезаются — иначе "Qwen3.5-9B..."
// с точкой и дефисом подряд дал бы "qwen3--5-9b" вместо чистого "qwen3-5-9b".
function slugify(filename: string): string {
  const base = filename.slice(0, filename.length - path.extname(filename).length)
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Тот же путь, что зашит в TranslationService.ts:250 — продублирован намеренно (задача прямо
// запрещает рефакторить TranslationService в этом коммите). Берём только каталог, не сам файл.
function legacyGgufDir(): string {
  const legacyModelPath = path.join(__dirname, '../../resources/models/gguf/Qwen3.5-9B-Q4_K_M.gguf')
  return path.dirname(legacyModelPath)
}

function userGgufDir(): string {
  return path.join(app.getPath('userData'), 'models', 'gguf')
}

// Нерекурсивный скан одного каталога на *.gguf — каталога может не быть (норма и для
// userData/models/gguf на первом запуске, и для легаси-каталога вне dev-окружения), просто
// возвращаем пустой список.
function scanDir(dir: string, source: InstalledModel['source']): InstalledModel[] {
  let entries: string[]
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return []
  }
  const found: InstalledModel[] = []
  for (const name of entries) {
    if (path.extname(name).toLowerCase() !== '.gguf') continue
    const filePath = path.join(dir, name)
    let stat: fs.Stats
    try {
      stat = fs.statSync(filePath)
    } catch {
      continue // исчез между readdirSync и statSync — пропускаем, не роняем весь скан
    }
    if (!stat.isFile()) continue // нерекурсивно: каталог с расширением .gguf в имени — не модель
    found.push({ id: slugify(name), label: path.basename(name, '.gguf'), filePath, sizeBytes: stat.size, source })
  }
  return found
}

// Заполняет пустой реестр тем, что реально найдено на диске. Файлы не двигаются, не копируются,
// не переименовываются, не удаляются — этот коммит работает строго на чтение (см. задачу).
function seedFromDisk(): void {
  const found: InstalledModel[] = []
  const seenIds = new Set<string>()
  // userData первым — тот же приоритет "пользовательская докладка сначала, бандл/легаси —
  // фолбэк", что и в AppProtocol.ts::registerModelProtocol, на случай совпадения id между каталогами.
  for (const m of [...scanDir(userGgufDir(), 'downloaded'), ...scanDir(legacyGgufDir(), 'legacy')]) {
    if (seenIds.has(m.id)) continue
    seenIds.add(m.id)
    found.push(m)
  }

  let defaultModelId: string | null = null
  const legacyQwen = found.find((m) => path.basename(m.filePath) === LEGACY_DEFAULT_FILENAME)
  if (legacyQwen) {
    defaultModelId = legacyQwen.id
  } else if (found.length > 0) {
    defaultModelId = [...found].sort((a, b) => a.label.localeCompare(b.label))[0]!.id
  }

  state = { models: found, defaultModelId }
  write()
}

// Вызывается один раз при старте (main.ts). Только чтение диска — TranslationService.ts (сам
// рантайм загрузки модели) этим модулем не подключён и не меняется.
export function init(): void {
  load()
  if (state.models.length === 0) seedFromDisk()
}

export function list(): InstalledModel[] {
  return [...state.models]
}

export function getById(id: string): InstalledModel | null {
  return state.models.find((m) => m.id === id) ?? null
}

export function getDefault(): InstalledModel | null {
  return state.defaultModelId ? getById(state.defaultModelId) : null
}

export function setDefault(id: string): void {
  if (!getById(id)) return
  state.defaultModelId = id
  write()
}

export function add(model: InstalledModel): void {
  if (getById(model.id)) return // id — стабильный slug, дубликат игнорируем
  state.models.push(model)
  write()
}

// Только запись реестра — файл на диске не трогаем. Удаление файла будет отдельным коммитом
// после того, как появится корректный dispose (см. задачу).
export function remove(id: string): void {
  const next = state.models.filter((m) => m.id !== id)
  if (next.length === state.models.length) return
  state.models = next
  if (state.defaultModelId === id) state.defaultModelId = null
  write()
}
