import crypto from 'node:crypto';
import {
  MCP_CONFIRM_TTL_MS, approvalFits, canRemember, confirmSubject, confirmTitle,
  type McpApproval, type McpTool,
} from '../../shared/mcpPolicy';
import { askMcp } from '../McpPromptManager';
import { setStance } from './McpClients';

// Спросить человека перед тем, как чужая программа что-то изменит в браузере.
//
// ⚠️ КАРТОЧКА ЖИВЁТ В НАШЕМ ОКНЕ, А НЕ У КЛИЕНТА, и это главное решение файла. У протокола есть
// свой механизм спросить — MRTR: сервер отвечает `input_required` с `elicitation/create`, клиент
// показывает вопрос и повторяет вызов с ответом. Красиво, но вопрос при этом рисует ТА САМАЯ
// ПРОГРАММА, которая просит разрешение, и она же приносит ответ. Для честного клиента это удобно,
// для нечестного — пустая формальность: он ответит себе «да» сам. Разрешение на чужой браузер
// обязано спрашиваться там, куда чужая программа не дотянется, — в самом браузере.
//
// ⚠️ Карточка НАША, а не системное окно, — и это правка прежнего решения. Сначала здесь стоял
// dialog.showMessageBox с обоснованием «страница не подделает системное окно». Обоснование верное,
// вывод был неверным: карточка живёт в отдельной WebContentsView поверх страницы, куда страница не
// дотянется точно так же. Вопрос от браузера должен выглядеть как браузер (см. McpPromptManager).
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
  const remembering = canRemember(req.tool);
  const res = await askMcp({
    kind: 'action',
    client: req.clientLabel,
    title: confirmTitle(req.tool),
    detail: confirmSubject(req.tool, req.args),
    canRemember: remembering,
  });
  // ⚠️ «Разрешать всегда» пишется В НАСТРОЙКИ КЛИЕНТА, а не в память процесса: человек ответил
  // на вопрос «как поступать с этим инструментом», а не «как поступить сейчас», и после
  // перезапуска браузера ответ обязан остаться. Отменяется он там же, в разделе настроек.
  if (res.granted && res.remember && remembering) {
    setStance(req.clientKey, req.tool.name, 'allow');
  }
  return res.granted;
}

/** Забыть выданные разрешения — при отзыве клиента и при выключении сервера. */
export function forgetApprovals(clientKey?: string): void {
  if (clientKey) approvals.delete(clientKey);
  else approvals.clear();
}

export { MCP_CONFIRM_TTL_MS };
