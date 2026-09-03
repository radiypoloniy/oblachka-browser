// Файлы, которые вернула модель: байты на диске, описание — в интерфейс.
//
// ⚠️ БАЙТЫ ЧЕРЕЗ IPC НЕ ХОДЯТ, и это не осторожность ради осторожности. Картинка от модели — это
// один-три мегабайта base64; отдав её интерфейсу вместе с ответом, мы бы (а) держали её в состоянии
// React на каждое сообщение, (б) записали бы её в историю беседы в SQLite, где она осталась бы
// навсегда, и (в) заплатили бы за сериализацию на каждом пуше. Поэтому наружу уходит ОПИСАНИЕ —
// id, имя, тип, размер, — а картинку интерфейс просит отдельно и только когда её надо показать.
//
// ⚠️ Каталог свой (`userData/ai-files`) и чистится ТОЛЬКО этим модулем. Правило CLAUDE.md про
// пользовательские данные действует и здесь: ничего, кроме собственных файлов, отсюда не удаляется,
// а сам каталог не пересоздаётся «на всякий случай».
//
// ⚠️ Потолок объёма обязателен. Беседа с моделью, которая рисует, набирает сотни мегабайт за вечер,
// и без потолка это тихо съедало бы диск — то есть повторило бы ошибку любого кэша без выселения.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { attachmentName, base64Size, extForMime, isImageMime, type AiFileMeta } from '../../shared/aiAttachments';

/** Потолок каталога. Сверх него выселяются самые давние — беседы старше всего расстаются легче. */
const CAP_BYTES = 256 * 1024 * 1024;
/** Один файл крупнее этого не берём: столько не присылает ни одна модель, значит это не картинка. */
const MAX_FILE_BYTES = 32 * 1024 * 1024;

interface Entry { name: string; mime: string; size: number; at: number }

let dir = '';
let index: Record<string, Entry> = {};

function indexPath(): string {
  return path.join(dir, 'index.json');
}

export function init(): void {
  dir = path.join(app.getPath('userData'), 'ai-files');
  try {
    fs.mkdirSync(dir, { recursive: true });
    index = JSON.parse(fs.readFileSync(indexPath(), 'utf8')) as Record<string, Entry>;
  } catch {
    // Индекса нет (первый запуск) или он битый — начинаем с пустого. Сами файлы при этом остаются
    // на диске: удалять их из-за нечитаемого индекса значило бы терять чужое ради своего порядка.
    index = {};
  }
  evict();
}

function writeIndex(): void {
  // Атомарно: временный файл рядом и переименование. Иначе выключение питания посреди записи
  // оставляет обрезанный JSON, и следующий запуск теряет весь индекс разом.
  const tmp = `${indexPath()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(index), 'utf8');
    fs.renameSync(tmp, indexPath());
  } catch (e) {
    console.error('[ai-files] индекс не записан:', e);
  }
}

function fileOf(id: string): string {
  return path.join(dir, `${id}.${extForMime(index[id]?.mime ?? '')}`);
}

/**
 * Сохранить пришедшее от модели вложение.
 *
 * ⚠️ Имя даёт вызывающий через `index`, а не провайдер: у модели имени файла нет вовсе, а
 * порядковый номер понятен только в рамках одного ответа.
 */
export function save(mime: string, base64: string, ordinal: number): AiFileMeta | null {
  if (dir === '') return null;
  const size = base64Size(base64);
  if (size === 0 || size > MAX_FILE_BYTES) return null;

  const id = crypto.randomBytes(16).toString('hex');
  const entry: Entry = { name: attachmentName(mime, ordinal), mime, size, at: Date.now() };
  index[id] = entry;
  try {
    fs.writeFileSync(fileOf(id), Buffer.from(base64, 'base64'));
  } catch (e) {
    delete index[id];
    console.error('[ai-files] файл не записан:', e);
    return null;
  }
  writeIndex();
  evict();
  return { id, name: entry.name, mime, size, kind: isImageMime(mime) ? 'image' : 'file' };
}

/**
 * Сохранить все вложения одного ответа.
 *
 * ⚠️ Живёт ЗДЕСЬ, а не у вызывающего, ровно по той же причине, по которой адаптеры не ходят на
 * диск: место записи должно быть одно на всех провайдеров. Не сохранилось — файл молча выпадает
 * из списка: ответ человек уже видит, и ронять его целиком из-за неудавшейся записи картинки хуже,
 * чем показать ответ без неё.
 */
export function saveAll(raw: readonly { mime: string; base64: string }[] | undefined): AiFileMeta[] {
  return (raw ?? []).flatMap((f, i) => save(f.mime, f.base64, i) ?? []);
}

/**
 * Путь к файлу по id.
 *
 * ⚠️ id проверяется ФОРМОЙ, а не «лишь бы нашёлся в индексе»: он приезжает из renderer, и путь
 * собирается из него склейкой. Шестнадцатеричная строка фиксированной длины не может содержать ни
 * разделителя, ни «..» — то есть выйти за каталог нечем.
 */
export function pathOf(id: string): string | null {
  if (dir === '' || !/^[0-9a-f]{32}$/.test(id)) return null;
  if (index[id] === undefined) return null;
  const p = fileOf(id);
  return fs.existsSync(p) ? p : null;
}

export function metaOf(id: string): AiFileMeta | null {
  const p = pathOf(id);
  if (p === null) return null;
  const e = index[id];
  return { id, name: e.name, mime: e.mime, size: e.size, kind: isImageMime(e.mime) ? 'image' : 'file' };
}

/**
 * Содержимое как data-URL — для показа картинки в чате.
 *
 * ⚠️ Только для картинок и только по явной просьбе интерфейса. Отдавать так произвольный файл
 * значило бы завести способ прочитать что угодно из каталога одной строкой.
 */
export function dataUrl(id: string): string | null {
  const p = pathOf(id);
  if (p === null || !isImageMime(index[id].mime)) return null;
  try {
    return `data:${index[id].mime};base64,${fs.readFileSync(p).toString('base64')}`;
  } catch {
    return null;
  }
}

/** Выселение самых давних сверх потолка. */
function evict(): void {
  const ids = Object.keys(index);
  let total = 0;
  for (const id of ids) total += index[id].size;
  if (total <= CAP_BYTES) return;

  const oldestFirst = ids.sort((a, b) => index[a].at - index[b].at);
  for (const id of oldestFirst) {
    if (total <= CAP_BYTES) break;
    total -= index[id].size;
    try { fs.unlinkSync(fileOf(id)); } catch { /* уже нет — не беда, снимаем запись */ }
    delete index[id];
  }
  writeIndex();
}
