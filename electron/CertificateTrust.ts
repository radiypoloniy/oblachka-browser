// Доверие корню «Russian Trusted Root CA» (НУЦ Минцифры) — СВОЁ, внутри браузера, и только для
// перечисленных ниже доменов.
//
// Зачем вообще. Замерено на живой машине: у sberbank.ru и vtb.ru цепочка идёт
// «сайт ← Russian Trusted Sub CA ← Russian Trusted Root CA», этого корня нет ни в хранилище
// Windows, ни в наборе Chromium — то есть банк в браузере просто не открывается. У gosuslugi.ru,
// nalog.gov.ru и mos.ru сертификаты от общепризнанных УЦ, им этот слой не нужен.
//
// ⚠️ ПОЧЕМУ СПИСОК, А НЕ «ДОВЕРЯТЬ ВЕЗДЕ». Любой корневой УЦ, которому доверяет браузер, может
// выписать сертификат на ЛЮБОЙ домен; вместе с доступом к каналу это даёт возможность читать
// чужой трафик под видом настоящего сайта. Именно поэтому Chrome и Firefox этот корень не
// включают. Но для сайтов, которые УЖЕ им пользуются, доверие не добавляет ничего нового:
// настоящий сертификат Сбера и так выписан этим УЦ, по-другому сайт сейчас не работает. Новая
// уязвимость появляется ровно тогда, когда корню разрешают ручаться СВЕРХ этого — за google.com
// или почту. Список ровно это и исключает.
//
// ⚠️ Хранилище ИЗОЛИРОВАННОЕ: системные хранилища Windows не трогаются вовсе, другие браузеры об
// этом доверии не узнают, удаление Oblako уносит его с собой.
//
// ⚠️ Мы НЕ подменяем проверку Chromium, а перекрываем ровно один её исход — «корень неизвестен».
// Просроченный сертификат, чужое имя в сертификате, отозванный промежуточный, слабая подпись —
// всё это по-прежнему решает Chromium, и его отказ остаётся отказом.
import { X509Certificate } from 'node:crypto'
import type { Session } from 'electron'
import { RUSSIAN_TRUSTED_ROOT_PEM } from './certs/russianTrustedRoot'

// Отпечаток дублирует вшитый PEM намеренно: PEM можно поправить одной строкой в диффе и не
// заметить, а расхождение с этой константой валит доверие целиком (см. проверку при загрузке).
const ROOT_SHA256 = 'D2:6D:2D:02:31:B7:C3:9F:92:CC:73:85:12:BA:54:10:35:19:E4:40:5D:68:B5:BD:70:3E:97:88:CA:8E:CF:31'

// Домены, которым это доверие выдаётся. Только те, что реально пользуются сертификатами Минцифры
// и без этого не открываются: банки под санкциями плюс платёжная инфраструктура. Госуслуги и
// налоговая сюда НЕ входят — у них общепризнанные УЦ, проверено.
// Совпадение — по домену и его поддоменам (online.sberbank.ru подходит под sberbank.ru).
// ⚠️ Список собран ЗАМЕРОМ, а не по памяти: у каждого домена проверено, кто выписал его живой
// сертификат. Кто пользуется общепризнанным УЦ — в списке НЕ нужен и сюда не попал (Газпромбанк —
// LiteSSL, Совкомбанк — HARICA, Госуслуги и налоговая — тоже обычные УЦ). Список короче ровно на
// эту разницу, и это не придирка: каждый лишний домен — это лишние полномочия чужого УЦ.
// Проверять командой из «Замеров» ниже, когда список понадобится пополнить.
const ALLOWED_DOMAINS = [
  'sberbank.ru', 'sber.ru', 'sberbank.com',
  'vtb.ru', 'vtb24.ru',
  'psbank.ru', 'promsvyazbank.ru',
  'rshb.ru',
  'open.ru',
  'mkb.ru',
  'alfabank.ru',
  'rosbank.ru',
  'uralsib.ru',
  'nspk.ru',
]

let rootCert: X509Certificate | null = null
let rootOk = false

function ensureRoot(): boolean {
  if (rootCert) return rootOk
  try {
    const cert = new X509Certificate(RUSSIAN_TRUSTED_ROOT_PEM)
    rootCert = cert
    // Сверка с константой — единственное, что превращает «какой-то вшитый PEM» в «именно тот
    // корень, который мы проверили руками». Не сошлось — доверие не включается вовсе.
    rootOk = cert.fingerprint256 === ROOT_SHA256
    if (!rootOk) console.error('[certs] отпечаток вшитого корня не совпал с ожидаемым — доверие отключено')
  } catch (e) {
    console.error('[certs] вшитый корень не разобрался:', e)
    rootOk = false
  }
  return rootOk
}

function isAllowedHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return ALLOWED_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`))
}

// Цепочка от Electron приходит связанным списком: certificate.issuerCert → … Разворачиваем в
// массив, обрывая на самоподписанном (у корня issuerCert указывает сам на себя) и на разумной
// глубине — зацикленная цепочка не должна превращаться в вечный цикл.
function chainOf(leaf: Electron.Certificate): Electron.Certificate[] {
  const out: Electron.Certificate[] = []
  let cur: Electron.Certificate | undefined = leaf
  const seen = new Set<string>()
  while (cur && out.length < 10 && !seen.has(cur.fingerprint)) {
    seen.add(cur.fingerprint)
    out.push(cur)
    cur = cur.issuerCert
  }
  return out
}

function withinDates(cert: X509Certificate): boolean {
  const t = Date.now()
  return t >= Date.parse(cert.validFrom) && t <= Date.parse(cert.validTo)
}

/**
 * Проверяем цепочку сами — так же строго, как это делал бы браузер, только якорь другой: имя
 * домена в листе, живые сроки у каждого звена и настоящая подпись на каждом шаге вверх, вплоть
 * до нашего вшитого корня.
 *
 * ⚠️ ПОРЯДОК ПРИСЛАННЫХ СЕРТИФИКАТОВ НИ О ЧЁМ НЕ ГОВОРИТ. Первая версия шла по цепочке подряд
 * («каждый подписан следующим») и споткнулась на живом сайте: www.uralsib.ru присылает лист,
 * потом КОРЕНЬ, и только потом промежуточный. По стандарту порядок и не обязан соблюдаться, а
 * серверы им регулярно пренебрегают. Поэтому путь строится поиском: на каждом шаге берём из
 * присланного набора тот сертификат, который РЕАЛЬНО подписал текущий, — подписью, а не порядком
 * и не совпадением имён.
 */
function verifyAgainstRussianRoot(hostname: string, leaf: Electron.Certificate): boolean {
  if (!ensureRoot() || !rootCert) return false
  const root = rootCert
  try {
    const pool = chainOf(leaf).map((c) => new X509Certificate(c.data))
    if (pool.length === 0) return false
    if (!pool[0].checkHost(hostname)) return false // SAN/wildcard разбирает сам Node
    if (!withinDates(root)) return false

    let cur = pool[0]
    const used = new Set<string>([cur.fingerprint256])
    // Глубина с запасом: у настоящих цепочек два-три звена, больше — либо экзотика, либо петля.
    for (let depth = 0; depth < 6; depth++) {
      if (!withinDates(cur)) return false
      if (cur.fingerprint256 === root.fingerprint256) return true // дошли до самого корня
      if (cur.verify(root.publicKey)) return true                 // корень подписал это звено
      const next = pool.find((c) => !used.has(c.fingerprint256) && cur.verify(c.publicKey))
      if (!next) return false
      used.add(next.fingerprint256)
      cur = next
    }
    return false
  } catch (e) {
    console.warn('[certs] проверка цепочки не удалась:', e)
    return false
  }
}

/**
 * Ставится на сессию (боевую и инкогнито) один раз при старте.
 * ⚠️ callback(-3) означает «оставить вердикт Chromium» — это ответ по умолчанию во ВСЕХ ветках,
 * кроме одной. Ошибка здесь стоит дорого: callback(0) без разбора принял бы любой сертификат.
 */
export function installCertificateTrust(session: Session): void {
  session.setCertificateVerifyProc((request, callback) => {
    // Chromium доволен — вмешиваться незачем.
    if (request.errorCode === 0) { callback(-3); return }
    // Перекрываем ТОЛЬКО «неизвестный корень» и ТОЛЬКО для перечисленных доменов.
    if (request.verificationResult !== 'net::ERR_CERT_AUTHORITY_INVALID') { callback(-3); return }
    if (!isAllowedHost(request.hostname)) { callback(-3); return }

    if (verifyAgainstRussianRoot(request.hostname, request.certificate)) {
      console.log(`[certs] ${request.hostname}: цепочка сошлась к корню Минцифры — принято`)
      callback(0)
      return
    }
    callback(-3)
  })
}
