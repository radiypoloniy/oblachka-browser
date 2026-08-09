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
import { dialog, type Session } from 'electron'
import { RUSSIAN_TRUSTED_ROOT_PEM } from './certs/russianTrustedRoot'
import { isUserTrusted, addUserTrusted } from './CertTrustStore'

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

// Человек ответил «доверять», но снял галочку «запомнить» — доверие живёт до перезапуска и на
// диск не пишется. Без этого множества снятая галочка означала бы вопрос на КАЖДЫЙ подзапрос
// того же сайта: разрешение не сохранено, значит следующая картинка спросит заново.
const sessionAllowed = new Set<string>()

function isAllowedHost(hostname: string): boolean {
  const h = hostname.toLowerCase()
  // Вшитый список плюс то, что человек разрешил сам (см. CertTrustStore.ts). Вшитый неизбежно
  // отстаёт от жизни: сайты переезжают на Минцифры по мере того, как кончаются западные
  // сертификаты, и без второй половины человек упирался бы в тупик до следующей версии браузера.
  return ALLOWED_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`))
    || isUserTrusted(h)
    || sessionAllowed.has(h)
}

// Хосты, у которых цепочка ЧЕСТНО сходится к корню Минцифры, но разрешения нет. Ровно им странице
// ошибки есть что объяснить — а не всякому сайту со сломанным сертификатом. Живёт в памяти: это
// подсказка интерфейсу, а не состояние.
const russianCaCandidates = new Set<string>()

/**
 * Объяснять ли на странице ошибки, что дело в корне Минцифры (см. TabError.tsx). Разрешённый хост
 * сюда не попадает: если сайт открывается, а ошибка другая, рассказ про сертификат только соврёт.
 */
export function isRussianCaCandidate(hostname: string): boolean {
  const h = hostname.toLowerCase()
  return russianCaCandidates.has(h) && !isAllowedHost(h)
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

// Хосты, по которым вопрос уже задан (несколько запросов к одному сайту не должны поднимать
// несколько окон) и по которым человек отказал в этом запуске — переспрашивать на каждой
// картинке с того же домена невыносимо.
const asking = new Map<string, Array<(v: number) => void>>()
const deniedThisSession = new Set<string>()

async function askAboutHost(hostname: string, callback: (v: number) => void): Promise<void> {
  const host = hostname.toLowerCase()
  if (deniedThisSession.has(host)) { callback(-3); return }
  const queued = asking.get(host)
  if (queued) { queued.push(callback); return } // вопрос уже висит — ждём общий ответ
  asking.set(host, [callback])

  let allow = false
  try {
    const { response, checkboxChecked } = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Доверять этому сайту', 'Не открывать'],
      defaultId: 1,
      cancelId: 1,
      title: 'Сертификат от УЦ Минцифры',
      message: `${host} подтверждает себя сертификатом Минцифры`,
      detail: 'Этому удостоверяющему центру браузер доверяет только для сайтов, которым вы это '
        + 'разрешили (по умолчанию — банки, у которых другого сертификата не бывает).\n\n'
        + 'Разрешайте, если узнаёте адрес и пришли сюда сами. Доверие получит ТОЛЬКО этот сайт; '
        + 'отозвать можно в Настройках → Разрешения.',
      checkboxLabel: 'Запомнить для этого сайта',
      checkboxChecked: true,
      noLink: true,
    })
    allow = response === 0
    // Галочка решает только ДОЛГОВЕЧНОСТЬ разрешения, а не его наличие: без неё доверие живёт до
    // перезапуска (см. sessionAllowed), с ней ложится на диск и попадает в экран отзыва.
    if (allow) { if (checkboxChecked) addUserTrusted(host); else sessionAllowed.add(host) }
    else deniedThisSession.add(host)
  } catch (e) {
    console.warn('[certs] вопрос о доверии не показался:', e)
  }
  const waiting = asking.get(host) ?? []
  asking.delete(host)
  for (const cb of waiting) cb(allow ? 0 : -3)
}

// Сессии, на которые слой уже поставлен — чтобы переустановить проверку после изменения списка
// доверия (см. refreshCertificateTrust).
const installedSessions: Session[] = []

/**
 * Зовётся после ОТЗЫВА доверия: запрет обязан действовать сразу, а не после перезапуска.
 * ⚠️ Гарантии тут нет, и это надо знать. Вердикт по сертификату кэширует сетевая служба, и
 * замерено, что разубедить её нечем: ни переустановка процедуры проверки, ни сброс кэша, ни
 * закрытие живых соединений вердикт не отменяют — на уже открытой странице он доживает до
 * перезапуска. Делаем всё, что можно сделать; на этом же ограничении держится решение спрашивать
 * человека ДО ответа Chromium, а не после (см. applyProc).
 */
export function refreshCertificateTrust(): void {
  for (const s of installedSessions) {
    applyProc(s)
    void s.clearCache()
    void s.clearHostResolverCache()
    void s.closeAllConnections()
  }
}

/**
 * ⚠️ callback(-3) означает «оставить вердикт Chromium» — это ответ по умолчанию во ВСЕХ ветках,
 * кроме одной. Ошибка здесь стоит дорого: callback(0) без разбора принял бы любой сертификат.
 */
function applyProc(session: Session): void {
  session.setCertificateVerifyProc((request, callback) => {
    // Chromium доволен — вмешиваться незачем.
    if (request.errorCode === 0) { callback(-3); return }
    // Перекрываем ТОЛЬКО «неизвестный корень» и ТОЛЬКО для перечисленных доменов.
    if (request.verificationResult !== 'net::ERR_CERT_AUTHORITY_INVALID') { callback(-3); return }
    if (!isAllowedHost(request.hostname)) {
      // ⚠️ СПРАШИВАЕМ ЗДЕСЬ, А НЕ ПОСЛЕ ОТКАЗА. Первая версия отказывала и предлагала кнопку
      // «разрешить» на странице ошибки — и это не работало: Chromium кэширует вердикт по
      // сертификату, поэтому разрешённый сайт продолжал получать -202, а проверка при повторной
      // попытке даже не вызывалась (замерено; ни сброс кэша, ни переустановка процедуры, ни
      // закрытие соединений вердикт не отменяли). Ответ на этот вызов можно дать и позже — чем
      // мы и пользуемся: держим запрос, пока человек отвечает. Так делают все браузеры со своими
      // предупреждениями о сертификате, и никакой отказ в кэш не попадает.
      // ⚠️ Известная грубость: проверка не различает переход человека и подзапрос страницы, то
      // есть вопрос теоретически может всплыть из-за чужой врезки на постороннем сайте. Отсюда
      // «Разрешайте, если узнаёте адрес и пришли сюда сами» в самом вопросе и «Не открывать»
      // ответом по умолчанию. Развести это можно только сверкой с адресом вкладки, а он к моменту
      // проверки сертификата ещё не закреплён за вкладкой — пока не разменивали.
      if (verifyAgainstRussianRoot(request.hostname, request.certificate)) {
        russianCaCandidates.add(request.hostname.toLowerCase())
        void askAboutHost(request.hostname, callback)
        return
      }
      callback(-3)
      return
    }

    if (verifyAgainstRussianRoot(request.hostname, request.certificate)) {
      console.log(`[certs] ${request.hostname}: цепочка сошлась к корню Минцифры — принято`)
      callback(0)
      return
    }
    callback(-3)
  })
}

/** Ставится на сессию (боевую и инкогнито) один раз при старте. */
export function installCertificateTrust(session: Session): void {
  installedSessions.push(session)
  applyProc(session)
}
