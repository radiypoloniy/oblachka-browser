// Счёт расхода по подключениям: сколько запросов, токенов и денег ушло на каждое.
//
// ⚠️ ЗАЧЕМ ЭТО ВООБЩЕ. Ключ у человека свой, платит он провайдеру напрямую, и браузер — последнее
// место, где он ждёт счёт. Но именно браузер решает, какое подключение отвечает за какую роль, и
// без счёта человек не может проверить это решение: «почему на OpenRouter уходит вдвое больше,
// чем я думал» — вопрос про маршруты, а не про тариф.
//
// ⚠️ ЭТО НЕ БУХГАЛТЕРИЯ ПРОВАЙДЕРА, и обещать точность до цента нельзя. Считаем то, что провайдер
// сам вернул в ответе: часть шлюзов не отдаёт usage вовсе, часть отдаёт только токены, стоимость
// возвращает по сути один OpenRouter. Правда об этом живёт в shared/aiUsage.ts (costKnown).
//
// ⚠️ Пишем на диск ОТЛОЖЕННО. Запись после каждого ответа — это файловая операция на каждый чанк
// беседы; при этом терять счёт нельзя, поэтому окно короткое и есть принудительный сброс.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { addUsage, emptyUsage, type AiUsage, type UsageDelta } from '../../shared/aiUsage';

const FLUSH_MS = 2_000;

let file = '';
let usage: Record<string, AiUsage> = {};
let timer: NodeJS.Timeout | null = null;
const listeners = new Set<() => void>();

export function init(): void {
  file = path.join(app.getPath('userData'), 'ai-usage.json');
  try {
    usage = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, AiUsage>;
  } catch {
    // Файла нет (первый запуск) или он битый — начинаем с нуля. Счёт расхода не пользовательские
    // данные в том смысле, в каком ими являются пароли: терять его неприятно, но не страшно.
    usage = {};
  }
}

export function record(connectionId: string, delta: UsageDelta): void {
  if (file === '') return;
  usage[connectionId] = addUsage(usage[connectionId], delta, Date.now());
  for (const cb of listeners) cb();
  if (timer === null) timer = setTimeout(flush, FLUSH_MS);
}

export function snapshot(): Record<string, AiUsage> {
  return usage;
}

/** Обнулить счёт: одного подключения или весь. Человек вправе начать считать заново. */
export function reset(connectionId?: string): void {
  if (connectionId === undefined) usage = {};
  else delete usage[connectionId];
  for (const cb of listeners) cb();
  flush();
}

export function onChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Счёт удалённого подключения уходит вместе с ним: осиротевшая строка никому не нужна. */
export function forget(connectionId: string): void {
  if (usage[connectionId] === undefined) return;
  delete usage[connectionId];
  flush();
}

export function flush(): void {
  if (timer !== null) { clearTimeout(timer); timer = null; }
  if (file === '') return;
  // Атомарно: временный файл рядом и переименование — обрыв посреди записи иначе оставит
  // обрезанный JSON, и следующий запуск потеряет счёт целиком.
  const tmp = `${file}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(usage), 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) {
    console.error('[ai-usage] счёт не записан:', e);
  }
}

/** Для мест, где нужен пустой счёт «как будто подключение только завели». */
export function blank(): AiUsage {
  return emptyUsage(Date.now());
}
