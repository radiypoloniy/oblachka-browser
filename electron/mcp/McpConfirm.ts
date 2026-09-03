import crypto from 'node:crypto';
import { BrowserWindow, dialog } from 'electron';
import {
  MCP_CONFIRM_TTL_MS, approvalFits, confirmText, type McpApproval, type McpTool,
} from '../../shared/mcpPolicy';

// Спросить человека перед тем, как чужая программа что-то изменит в браузере.
//
// ⚠️ КАРТОЧКА ЖИВЁТ В НАШЕМ ОКНЕ, А НЕ У КЛИЕНТА, и это главное решение файла. У протокола есть
// свой механизм спросить — MRTR: сервер отвечает `input_required` с `elicitation/create`, клиент
// показывает вопрос и повторяет вызов с ответом. Красиво, но вопрос при этом рисует ТА САМАЯ
// ПРОГРАММА, которая просит разрешение, и она же приносит ответ. Для честного клиента это удобно,
// для нечестного — пустая формальность: он ответит себе «да» сам. Разрешение на чужой браузер
// обязано спрашиваться там, куда чужая программа не дотянется, — в самом браузере.
//
// ⚠️ Диалог НАТИВНЫЙ, а не наш собственный поповер, и это тоже про доверие: окно, нарисованное
// операционной системой поверх приложения, нельзя подделать содержимым страницы. Ровно тем же
// приёмом (osAuth) закрыт показ сохранённого пароля.
//
// ⚠️ Вызов ЖДЁТ решения человека, а не отвечает «попробуй позже». Агент в это время показывает,
// что инструмент работает, — это честная картина: он и правда ждёт. Отказ по времени приходит
// словами, а не молчанием.

/** Сколько ждём человека, прежде чем считать вызов неотвеченным. */
const WAIT_MS = 60_000;

/**
 * Слепок вызова: подтверждение годится ровно для тех аргументов, которые человек прочитал.
 *
 * ⚠️ Ключи сортируются — иначе тот же вызов с переставленными полями дал бы другой слепок, и
 * повтор после подтверждения снова спрашивал бы человека.
 */
export function callDigest(tool: string, args: Record<string, unknown>): string {
  const keys = Object.keys(args).sort();
  const flat = keys.map((k) => `${k}=${JSON.stringify(args[k])}`).join('&');
  return crypto.createHash('sha256').update(`${tool}?${flat}`).digest('hex').slice(0, 32);
}

/** Последнее выданное подтверждение на клиента. Живёт минуту (MCP_CONFIRM_TTL_MS). */
const approvals = new Map<string, McpApproval>();

/** Идущий вопрос на клиента: второй такой же вызов не поднимает второе окно. */
const pending = new Map<string, Promise<boolean>>();

export interface ConfirmRequest {
  clientKey: string;
  clientLabel: string;
  tool: McpTool;
  args: Record<string, unknown>;
}

/**
 * Спросить человека. `true` — разрешил.
 *
 * ⚠️ Уже выданное подтверждение на ТОТ ЖЕ вызов не спрашивается заново: агент, получивший
 * «разрешено», часто повторяет вызов (переподключение, ретрай клиента), и второе окно на то же
 * самое человек читает как сбой.
 */
export async function confirmWrite(req: ConfirmRequest): Promise<boolean> {
  const digest = callDigest(req.tool.name, req.args);
  const key = req.clientKey;

  if (approvalFits(approvals.get(key) ?? null, { tool: req.tool.name, digest }, Date.now())) {
    return true;
  }

  // ⚠️ Один вопрос на клиента за раз. Без этого агент, пославший пять вызовов подряд, накрыл бы
  // человека пятью модальными окнами, и «Отказать» в первом ничего не значило бы.
  let ask = pending.get(key);
  if (!ask) {
    ask = askHuman(req).then((allowed) => {
      pending.delete(key);
      if (allowed) approvals.set(key, { tool: req.tool.name, digest, at: Date.now() });
      return allowed;
    });
    pending.set(key, ask);
  }

  // ⚠️ ТАЙМАУТ РЕШАЕТ, ЧТО ОТВЕТИТЬ АГЕНТУ, А НЕ ЗАКРЫВАЕТ ОКНО. Разница неочевидна и стоила бы
  // дорого: снимая вместе с ожиданием и запись о заданном вопросе, мы оставили бы на экране
  // висящее окно, а следующий вызов открыл бы поверх него второе. Человек, ответивший через
  // минуту, всё равно будет услышан — подтверждение запишется, и повтор вызова пройдёт молча.
  const timeout = new Promise<boolean>((resolve) => { setTimeout(() => resolve(false), WAIT_MS); });
  return Promise.race([ask, timeout]);
}

async function askHuman(req: ConfirmRequest): Promise<boolean> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
  const detail = `${confirmText(req.tool, req.args)}\n\n`
    // ⚠️ Про непроверенность имени сказано ПРЯМО в карточке: человек решает, зная, чего мы не
    // знаем сами. «Claude Code просит разрешение» звучало бы как удостоверение личности.
    + `Программа представилась так: «${req.clientLabel}». Проверить это мы не можем.`;

  const options = {
    type: 'question' as const,
    buttons: ['Разрешить', 'Отказать'],
    defaultId: 1, // ⚠️ По умолчанию ОТКАЗ: Enter вслепую не должен открывать чужие вкладки.
    cancelId: 1,
    noLink: true,
    title: 'Внешний агент',
    message: 'Разрешить внешней программе изменить браузер?',
    detail,
  };

  const { response } = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  return response === 0;
}

/** Забыть выданные разрешения — при отзыве клиента и при выключении сервера. */
export function forgetApprovals(clientKey?: string): void {
  if (clientKey) approvals.delete(clientKey);
  else approvals.clear();
}

export { MCP_CONFIRM_TTL_MS };
