// Ссылки в чужие ПРИЛОЖЕНИЯ: sbolpay://, bank100000000111://, tg://, itms-apps:// и прочее.
// Без этого слоя такая навигация просто ничем не заканчивалась: Chromium не знает схему, страница
// остаётся на месте, и человек видит «кнопка оплаты не работает» — при том что банковское
// приложение у него установлено. Самый частый живой случай — оплата по СБП.
//
// ⚠️ ЭТО ДВЕРЬ НАРУЖУ, И ОНА ОБЯЗАНА СПРАШИВАТЬ. Переход по такой ссылке запускает на машине
// ЧУЖУЮ ПРОГРАММУ с аргументами, которые выбрал сайт. Поэтому: явный вопрос человеку (как в
// Chrome), список заведомо опасных схем, которые не открываются никогда, и согласие, действующее
// только на пару «сайт + схема».
import { dialog, shell } from 'electron'
import type { BrowserWindow } from 'electron'

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

// Согласия живут ДО перезапуска браузера и только в памяти. Постоянный список «разрешено
// навсегда» — это отдельная сущность с экраном управления и правом на отзыв; заводить её,
// не имея такого экрана, значит выдать разрешение, которое человек потом не найдёт и не отменит.
const allowedThisSession = new Set<string>()

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
 * fromOrigin — откуда пришли: в вопросе обязателен, иначе «разрешить приложение?» — это вопрос
 * без предмета. Возвращает true, если ссылка ушла наружу.
 */
export async function openExternalWithConsent(
  win: BrowserWindow | null, url: string, fromOrigin: string,
): Promise<boolean> {
  const scheme = schemeOf(url)
  if (!isExternalAppUrl(url)) return false

  if (SILENT.has(scheme)) {
    await shell.openExternal(url).catch(() => { /* нет обработчика — молча, как и раньше */ })
    return true
  }

  const key = `${fromOrigin}|${scheme}`
  if (allowedThisSession.has(key)) {
    await shell.openExternal(url).catch((e: unknown) => console.warn('[external] не открылось:', e))
    return true
  }

  const site = fromOrigin || 'Эта страница'
  const { response, checkboxChecked } = await dialog.showMessageBox(win ?? undefined as never, {
    type: 'question',
    buttons: ['Открыть приложение', 'Отмена'],
    defaultId: 0,
    cancelId: 1,
    title: 'Открыть в другом приложении',
    message: `${site} хочет открыть приложение на вашем компьютере`,
    // Полный адрес показываем: именно в нём живёт то, что сайт передаёт чужой программе.
    detail: `Ссылка: ${url.slice(0, 300)}`,
    checkboxLabel: 'Больше не спрашивать для этого сайта',
    noLink: true,
  })
  if (response !== 0) return false
  if (checkboxChecked) allowedThisSession.add(key)
  await shell.openExternal(url).catch((e: unknown) => console.warn('[external] не открылось:', e))
  return true
}
