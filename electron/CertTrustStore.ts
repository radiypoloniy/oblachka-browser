// Домены, которым ЧЕЛОВЕК сам разрешил корень Минцифры — сверх вшитого списка банков.
//
// Зачем вообще: вшитый список неизбежно отстаёт от жизни. Сайты переезжают на сертификаты
// Минцифры по мере того, как у них кончаются западные, и без этой двери человек упирается в
// тупик — страница не открывается, и сделать с этим нечего до следующей версии браузера.
//
// ⚠️ Разрешение ПОСТОЯННОЕ, поэтому у него обязан быть экран управления и отзыв (см. раздел
// настроек «Разрешения»). Ровно по той же причине согласие на запуск чужого приложения
// (ExternalProtocol.ts) живёт лишь до перезапуска: там экрана нет — значит и постоянного
// разрешения быть не должно. Здесь экран есть, поэтому и запись на диске уместна.
//
// Хранится отдельным файлом, а не в settings.json: это не настройка удобства, а список
// доверенных доменов — его хочется видеть и чистить целиком, не вычитывая из общей кучи.
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

interface TrustRecord {
  domain: string
  addedAt: number
}

const FILE = (): string => path.join(app.getPath('userData'), 'cert-trust.json')

let cache: TrustRecord[] | null = null

// Домен приводим к канону, иначе «WWW.Sberbank.RU » и «sberbank.ru» станут разными записями,
// а список доверия — последнее место, где уместны почти-дубликаты.
function normalize(input: string): string {
  return input.trim().toLowerCase().replace(/^www\./, '')
}

function load(): TrustRecord[] {
  if (cache) return cache
  try {
    const raw = fs.readFileSync(FILE(), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    cache = Array.isArray(parsed)
      ? parsed.filter((r): r is TrustRecord =>
        !!r && typeof r === 'object'
        && typeof (r as TrustRecord).domain === 'string'
        && typeof (r as TrustRecord).addedAt === 'number')
      : []
  } catch {
    cache = [] // файла нет или он битый — начинаем с пустого списка, это не повод падать
  }
  return cache
}

function save(list: TrustRecord[]): void {
  cache = list
  try {
    // tmp+rename, как у списка загрузок: оборванная запись не должна оставить полфайла, по
    // которому потом молча потеряется всё доверие разом.
    const file = FILE()
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8')
    fs.renameSync(tmp, file)
  } catch (e) {
    console.warn('[certs] не удалось сохранить список доверия:', e)
  }
}

export function listUserTrusted(): TrustRecord[] {
  return [...load()].sort((a, b) => b.addedAt - a.addedAt)
}

export function isUserTrusted(hostname: string): boolean {
  const h = normalize(hostname)
  return load().some((r) => h === r.domain || h.endsWith(`.${r.domain}`))
}

export function addUserTrusted(hostname: string): boolean {
  const domain = normalize(hostname)
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) return false
  const list = load()
  if (list.some((r) => r.domain === domain)) return true
  save([...list, { domain, addedAt: Date.now() }])
  console.log(`[certs] человек разрешил корень Минцифры для ${domain}`)
  return true
}

export function removeUserTrusted(domain: string): boolean {
  const d = normalize(domain)
  const list = load()
  const next = list.filter((r) => r.domain !== d)
  if (next.length === list.length) return false
  save(next)
  return true
}
