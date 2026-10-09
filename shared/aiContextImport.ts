import type { AiContextPreset } from './aiContexts';

const CONTEXT_LIMIT = 12000;
export type ImportedContext = Pick<AiContextPreset, 'title' | 'text' | 'materials'>;

/** Переносится содержимое, а не id набора или подключение с чужой машины. */
export function parseContextFile(raw: string): ImportedContext {
  const value: unknown = JSON.parse(raw.replace(/^\uFEFF/, ''));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Нужен JSON набора с полями title, text и materials');
  const data = value as Record<string, unknown>;
  if (typeof data.text !== 'string' || !data.text.trim() || (data.materials !== undefined && typeof data.materials !== 'string')) {
    throw new Error('В наборе нужны инструкции text и необязательный текст materials');
  }
  const text = data.text.trim(), materials = typeof data.materials === 'string' ? data.materials.trim() : '';
  if (text.length + materials.length > CONTEXT_LIMIT) throw new Error('В наборе больше 12 000 символов. Текст не обрезается.');
  const title = typeof data.title === 'string' ? data.title.trim().slice(0, 60) : '';
  return { title, text, materials };
}

export function appendContextFiles(materials: string, files: { name: string; text: string }[]): string {
  if (files.some(file => file.text.includes('\u0000'))) throw new Error('Прикрепите текстовые файлы JSON, MD или TXT');
  return [materials.trim(), ...files.map(file => `--- ${file.name} ---\n${file.text.replace(/^\uFEFF/, '').trim()}`)].filter(Boolean).join('\n\n');
}
