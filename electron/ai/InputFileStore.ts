// Входящие файлы живут только до очистки беседы/закрытия окна. Выходной FileStore не затрагиваем:
// его вытеснение старых файлов не должно удалять изображения из активной истории.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { nativeImage } from 'electron';
import { extractFileText } from '../FileExtract';
import { INPUT_EXTENSIONS, INPUT_FILE_MAX, INPUT_TEXT_MAX, type AiInputMeta } from '../../shared/aiChatInputs';
import type { ResolvedInput, ChatInputs } from './chatInputs';

interface Entry { owner: string; meta: AiInputMeta; bytes?: Buffer; text?: string; used: boolean; cost: number }
const entries = new Map<string, Entry>();
const mimeByExt: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  webp: 'image/webp', gif: 'image/gif', pdf: 'application/pdf' };

function keep(owner: string, name: string, mime: string, kind: AiInputMeta['kind'], size: number,
  bytes?: Buffer, text?: string): AiInputMeta {
  const cost = (bytes?.length ?? 0) + Buffer.byteLength(text ?? '');
  let total = 0, owned = 0;
  for (const entry of entries.values()) { total += entry.cost; if (entry.owner === owner) owned += entry.cost; }
  if (total + cost > 64 * 1024 * 1024 || owned + cost > 16 * 1024 * 1024) {
    throw new Error('Достигнут лимит вложений. Очистите беседу или удалите файлы из черновика.');
  }
  const meta = { id: randomUUID(), name, mime, kind, size };
  entries.set(meta.id, { owner, meta, bytes, text, used: false, cost });
  return meta;
}

export async function importFile(owner: string, filename: string, allowImages: boolean): Promise<AiInputMeta> {
  const ext = path.extname(filename).slice(1).toLowerCase();
  if (!(INPUT_EXTENSIONS as readonly string[]).includes(ext)) throw new Error('Этот формат не поддерживается');
  const stat = await fs.stat(filename);
  if (!stat.isFile() || stat.size > INPUT_FILE_MAX) throw new Error('Нужен файл размером не более 5 МБ');
  const name = path.basename(filename);
  const mime = mimeByExt[ext];
  if (mime?.startsWith('image/')) {
    if (!allowImages) throw new Error('Встроенная модель не читает фото. Выберите модель с поддержкой изображений.');
    return importImage(owner, await fs.readFile(filename), name);
  }
  const extracted = await extractFileText(filename);
  if (ext !== 'pdf' && !extracted.ok) throw new Error(extracted.error ?? 'Не удалось прочитать документ');
  const text = extracted.ok ? extracted.text : undefined;
  if (text && text.length > INPUT_TEXT_MAX) throw new Error('В документе больше 40 000 символов. Прикрепите нужный фрагмент.');
  if (ext === 'pdf') {
    if (!allowImages && !text) throw new Error('В PDF нет текста. Для скана выберите облачную модель с поддержкой PDF.');
    const bytes = await fs.readFile(filename);
    if (bytes.length > INPUT_FILE_MAX || !bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('Нужен корректный PDF не более 5 МБ');
    return keep(owner, name, 'application/pdf', 'pdf', bytes.length, bytes, text);
  }
  if (text?.includes('\u0000')) throw new Error('Документ содержит бинарные данные');
  return keep(owner, name, 'text/plain', 'text', stat.size, undefined, text);
}

export function importImage(owner: string, bytes: Buffer, name = 'Изображение.png'): AiInputMeta {
  if (bytes.length > INPUT_FILE_MAX) throw new Error('Изображение больше 5 МБ');
  let image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw new Error('Не удалось прочитать изображение');
  const size = image.getSize(), largest = Math.max(size.width, size.height);
  // Ограничиваем запрос к API и память превью; исходный файл пользователя не меняется.
  if (largest > 1600) image = image.resize({ width: Math.round(size.width * 1600 / largest), height: Math.round(size.height * 1600 / largest) });
  const png = image.toPNG();
  if (png.length > 3 * 1024 * 1024) throw new Error('Изображение слишком большое после обработки. Прикрепите меньший фрагмент.');
  return keep(owner, name, 'image/png', 'image', png.length, png);
}

export function metaFor(owner: string, id: string): AiInputMeta {
  const entry = entries.get(id);
  if (!entry || entry.owner !== owner) throw new Error('Вложение не принадлежит этой беседе или уже удалено');
  return entry.meta;
}
export function requestInputs(owner: string, ids: string[]): ChatInputs {
  ids.forEach(id => metaFor(owner, id));
  ids.forEach(id => { entries.get(id)!.used = true; });
  return { ids, resolve: async (id): Promise<ResolvedInput> => {
    const meta = metaFor(owner, id), entry = entries.get(id)!;
    return { name: meta.name, mime: meta.mime, kind: meta.kind, text: entry.text, base64: entry.bytes?.toString('base64') };
  } };
}
export function preview(owner: string, id: string): string | null {
  const entry = entries.get(id);
  return entry?.owner === owner && entry.meta.kind === 'image' ? `data:image/png;base64,${entry.bytes!.toString('base64')}` : null;
}
export function removeDraft(owner: string, id: string): void {
  const entry = entries.get(id);
  if (entry?.owner === owner && !entry.used) entries.delete(id);
}
export function releaseOwner(owner: string): void {
  for (const [id, entry] of entries) if (entry.owner === owner) entries.delete(id);
}
