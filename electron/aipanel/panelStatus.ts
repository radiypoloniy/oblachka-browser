// Что панель узнаёт о состоянии приложения: ключ фактчека, веб-поиск, скиллы, подключения к моделям.
//
// ⚠️ ВЫНЕСЕНО ИЗ AiPanelManager.ts не ради красоты. Каждый такой пуш — функция в три строки плюс
// подписка, и четвёртый по счёту уже не влезал: файл под сторожем структуры и расти ему некуда.
// Здесь же видно, что это ОДНА вещь — снимок общего состояния приложения, который панель не может
// получить сама: её мост знает только про свои каналы, а источники живут в разных хранилищах.
//
// ⚠️ Панель приходит ГЕТТЕРОМ, а не ссылкой. WebContentsView пересоздаётся (закрыли панель —
// прежний вид уничтожен), и захваченная при загрузке модуля ссылка указывала бы на мёртвый вид:
// send() в него молча ничего не делает, а снаружи это выглядит как «настройки не доезжают».
//
// ⚠️ ПОДПИСКИ ЗДЕСЬ, А НЕ В ВЫЗЫВАЮЩЕМ. Модуль импортируется один раз за жизнь процесса, поэтому
// регистрация на верхнем уровне безопасна и, главное, не забывается: добавляя пуш, ты в одном
// месте пишешь и «что послать», и «когда».
import type { WebContentsView } from 'electron'
import * as aiKeyStore from '../AiKeyStore'
import * as searxngKeyStore from '../SearxngKeyStore'
import * as skillsStore from '../SkillsStore'
import * as ConnectionStore from '../ai/ConnectionStore'
import * as KeyStore from '../ai/KeyStore'
import { connectionsState } from '../ai/connections'
import { IPC } from '../../shared/ipc'

let getPanel: () => WebContentsView | null = () => null

export function setPanelSource(get: () => WebContentsView | null): void {
  getPanel = get
}

function send(channel: string, payload: unknown): void {
  const view = getPanel()
  if (!view || view.webContents.isDestroyed()) return
  view.webContents.send(channel, payload)
}

/** Ключ Gemini: по нему панель показывает или прячет кнопку фактчека. Сам ключ сюда не попадает. */
function sendKeyStatus(): void {
  send('ai-panel:key-status', aiKeyStore.getKeyStatus())
}

/** Веб-поиск: только булев статус, конфиг (endpoint/токен) наружу не уходит. */
function sendSearxngStatus(): void {
  send('ai-panel:searxng-status', searxngKeyStore.getStatus())
}

/** Реестр скиллов: prompt-кнопки панели — данные, а не хардкод. */
function sendSkillsList(): void {
  send('ai-panel:skills-list', skillsStore.list())
}

/**
 * Подключённые модели и маршруты ролей.
 *
 * ⚠️ ЗАВЕДЕНО ПО ЖИВОЙ ЖАЛОБЕ «метка не переключается». Снимок рассылался через
 * `broadcastToChrome`, а панель — ОТДЕЛЬНЫЙ WebContentsView, и до неё он не доезжал никогда.
 * Метка модели читала состояние один раз при открытии и после этого застывала: человек выбирал
 * другую модель, маршрут в main честно менялся, а надпись оставалась прежней — то есть выглядело
 * это ровно как неработающая кнопка.
 *
 * ⚠️ ТОТ ЖЕ канал, что у чрома (IPC.AI_CONN_CHANGED), и тот же сборщик снимка. Свой канал
 * «для панели» означал бы два ответа на вопрос «что подключено», расходящихся при первой же правке.
 */
function sendConnections(): void {
  send(IPC.AI_CONN_CHANGED, connectionsState())
}

/** Всё разом — при загрузке панели и при её повторном показе. */
export function sendPanelStatuses(): void {
  sendKeyStatus()
  sendSearxngStatus()
  sendSkillsList()
  sendConnections()
}

aiKeyStore.onKeyStatusChanged(() => sendKeyStatus())
searxngKeyStore.onStatusChanged(() => sendSearxngStatus())
skillsStore.onSkillsChanged(() => sendSkillsList())
// ⚠️ Подключение и ключ к нему живут в РАЗНЫХ хранилищах, а метка зависит от обоих: подключение
// без ключа непригодно. Поэтому слушаем оба — иначе введённый ключ не оживил бы метку до перезапуска.
ConnectionStore.onChanged(() => sendConnections())
KeyStore.onChanged(() => sendConnections())
