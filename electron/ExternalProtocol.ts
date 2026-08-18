// Ссылки в чужие ПРИЛОЖЕНИЯ: sbolpay://, bank100000000111://, tg://, itms-apps:// и прочее.
// Без этого слоя такая навигация просто ничем не заканчивалась: Chromium не знает схему, страница
// остаётся на месте, и человек видит «кнопка оплаты не работает» — при том что банковское
// приложение у него установлено. Самый частый живой случай — оплата по СБП.
//
// ⚠️ ЭТО ДВЕРЬ НАРУЖУ, И ОНА ОБЯЗАНА СПРАШИВАТЬ. Переход по такой ссылке запускает на машине
// ЧУЖУЮ ПРОГРАММУ с аргументами, которые выбрал сайт. Поэтому: явный вопрос человеку (как в
// Chrome), список заведомо опасных схем, которые не открываются никогда, и согласие, действующее
// только на пару «сайт + схема».
import { shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { hostOfUrl } from '../shared/rules'

// Схемы, которые обслуживает сам браузер или которые нельзя отдавать наружу ни при каких условиях.
// file/javascript/data — классические способы превратить «открыть ссылку» в исполнение чужого кода;
// ms-msdt/search-ms/shell — известные windows-схемы, через которые запускали произвольные команды.
const NEVER_EXTERNAL = new Set([
  'http', 'https', 'about', 'blob', 'data', 'javascript', 'chrome', 'chrome-extension',
  'devtools', 'oblako-chrome', 'file', 'vbscript', 'ms-msdt', 'search-ms', 'shell',
  'ms-appinstaller', 'ms-officecmd',
])

// Почта и телефон открывались и раньше, без вопросов — поведение сохраняем: обработчик у них
// системный и предсказуемый, а лишний вопрос на каждый mailto раздражал бы без всякой пользы.
const SILENT = new Set(['mailto', 'tel'])

// Кто задаёт вопрос и помнит ответ. Ставится из main при инициализации разрешений — модуль не
// знает ни про базу, ни про поповер, его дело — политика схем.
//
// ⚠️ Согласие ХРАНИТСЯ ПОСТОЯННО и лежит в общей таблице разрешений сайта, рядом с камерой и
// геопозицией. Раньше оно жило в памяти до перезапуска, потому что не было экрана, где его
// отозвать; экран есть (раздел «Разрешения»), и памяти процесса тут не место: человек ставит
// галочку «больше не спрашивать» и читает её как «навсегда», а получал «до следующего запуска».
type ConsentAsk = (origin: string, requesterWcId: number | null) => Promise<boolean>
let askConsent: ConsentAsk | null = null
export function setExternalConsentAsk(fn: ConsentAsk): void { askConsent = fn }

export function schemeOf(url: string): string {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(url)
  return m ? m[1].toLowerCase() : ''
}

/** Ссылка ведёт в стороннее приложение — браузеру такую навигацию выполнять нечем. */
export function isExternalAppUrl(url: string): boolean {
  const scheme = schemeOf(url)
  return scheme !== '' && !NEVER_EXTERNAL.has(scheme)
}

/**
 * Спросить человека и, если он согласен, отдать ссылку операционной системе.
 *
 * fromPageUrl — АДРЕС СТРАНИЦЫ, откуда пришли, целиком, а не готовый хост.
 *
 * ⚠️ Раньше сюда передавали уже вычисленный хост, и вычисляли его В ДВУХ МЕСТАХ ПО-РАЗНОМУ:
 * переход по ссылке считал `new URL(u).host` (с «www.» и портом), а window.open — hostOfUrl()
 * (без «www.», в нижнем регистре). Ключ согласия писался одним, а искался другим — и галочка
 * «больше не спрашивать» не работала вообще, though выглядела рабочей. Теперь источник один и
 * нормализация одна, по построению.
 */
export async function openExternalWithConsent(
  win: BrowserWindow | null, url: string, fromPageUrl: string, requesterWcId: number | null = null,
): Promise<boolean> {
  void win // окно больше не нужно: вопрос задаёт свой поповер, а не системный диалог
  const scheme = schemeOf(url)
  if (!isExternalAppUrl(url)) return false

  if (SILENT.has(scheme)) {
    await shell.openExternal(url).catch(() => { /* нет обработчика — молча, как и раньше */ })
    return true
  }

  // Origin в том же виде, в каком его пишут остальные разрешения: раздел настроек группирует
  // записи по сайту, и «tg для sberbank.ru» обязан лежать рядом с «камера для sberbank.ru».
  const host = hostOfUrl(fromPageUrl)
  const origin = host ? `https://${host}` : 'about:blank'

  if (!askConsent) return false
  const granted = await askConsent(origin, requesterWcId)
  if (!granted) return false

  await shell.openExternal(url).catch((e: unknown) => console.warn('[external] не открылось:', e))
  return true
}
