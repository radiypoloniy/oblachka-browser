// История хранит ссылки, а не base64: байты подставляет main только при запросе.
export interface AiInputMeta {
  id: string; name: string; mime: string; size: number; kind: 'image' | 'pdf' | 'text';
}
export type InputResult = { ok: true; files: AiInputMeta[] } | { ok: false; error: string };
export const INPUT_FILE_MAX = 5 * 1024 * 1024;
export const INPUT_COUNT_MAX = 5;
export const INPUT_TEXT_MAX = 40000;
export const INPUT_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'docx', 'txt', 'md', 'csv', 'json'] as const;

export function inputIds(raw: unknown): string[] | null {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.length > INPUT_COUNT_MAX) return null;
  if (!raw.every(id => typeof id === 'string' && /^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id))) return null;
  return new Set(raw).size === raw.length ? raw : null;
}

export interface ChatTurn { role: 'user' | 'assistant'; content: string; inputIds?: string[] }

/** Понимает прежние текстовые истории Gemini и сохраняет ссылки при смене облачного адаптера. */
export function chatTurns(history: unknown[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (const item of history) {
    if (!item || typeof item !== 'object') continue;
    const value = item as Record<string, unknown>;
    const role = value.role === 'user' ? 'user' : value.role === 'assistant' || value.role === 'model' ? 'assistant' : null;
    if (!role) continue;
    const content = typeof value.content === 'string' ? value.content : Array.isArray(value.parts)
      ? value.parts.map(part => part && typeof part === 'object' && typeof part.text === 'string' ? part.text : '').join('') : '';
    const ids = inputIds(value.inputIds);
    if (ids === null) throw new Error('Некорректные ссылки на вложения в истории');
    if (content || ids.length) turns.push({ role, content, ...(ids.length ? { inputIds: ids } : {}) });
  }
  return turns;
}
