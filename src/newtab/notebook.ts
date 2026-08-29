// Модель данных «блокнота» большого AI-экрана (NotebookLM-подобный хаб, см. Notebook.tsx).
// Источники + выбор храним в localStorage (общий origin index.html — и вкладка, и чат-центр
// AiChatView читают отсюда). Крупный текст статьи (десятки КБ) складывается в content после
// извлечения (electron/NotebookExtract). saveSources/saveSelected шлют window-событие →
// открытая панель и чат применяют изменения живьём (subscribeNotebook).

export interface NotebookSource {
  id: string;
  kind: 'url' | 'text' | 'file';
  title: string;
  content: string;   // текст источника; для url наполняется извлечением, до тех пор пуст
  /**
   * Адрес — только у kind 'url'.
   *
   * ⚠️ Отдельное поле, а не content: извлечение ЗАТИРАЕТ content текстом статьи, и адрес
   * после этого терялся навсегда. Пока источник нельзя было открыть, это не мешало; теперь
   * мешало бы сразу — открывать было бы нечего.
   */
  url?: string;
  /** Путь на диске — только у kind 'file'. Нужен и для извлечения, и чтобы открыть документ. */
  path?: string;
  addedAt: number;
  status: 'ready' | 'loading' | 'error'; // loading — идёт извлечение url/файла; error — не удалось
}

/**
 * Локальный документ источником. Текста ещё нет — его читает main (extractFileText), поэтому
 * источник заводится в 'loading', как и ссылка.
 *
 * ⚠️ Путь живёт в отдельном поле, а не в content: у ссылки content до извлечения занят самим
 * адресом, и текст его затирает — а путь к файлу нужен и ПОСЛЕ извлечения, чтобы документ
 * можно было открыть.
 */
export function sourceFromFile(file: { path: string; name: string }): NotebookSource {
  const id = (globalThis.crypto?.randomUUID?.() ?? String(Date.now() + Math.random()));
  return { id, kind: 'file', title: file.name, content: '', path: file.path, addedAt: Date.now(), status: 'loading' };
}

const KEY = 'oblako-notebook-sources';
const SEL_KEY = 'oblako-notebook-selected';
const EVENT = 'oblako-notebook-changed';
// Бюджет текста источников на грунтинг чата — модель локальная и небольшая; даже при большом
// контексте (Q8_0 KV) слишком длинный ввод замедляет ответ. Режем суммарно (см. getSelectedSourceContext).
const GROUNDING_MAX_CHARS = 24_000;

export function loadSources(): NotebookSource[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    // Терпимость к старому формату: без status и без url. Адрес у старых записей лежал в
    // content и уцелел только у тех, кого ещё не извлекли, — восстанавливаем что можем.
    return (arr as NotebookSource[]).map((s) => ({
      ...s,
      status: s.status ?? 'ready',
      url: s.url ?? (s.kind === 'url' && /^https?:\/\//i.test(s.content) ? s.content : undefined),
    }));
  } catch {
    return [];
  }
}

export function saveSources(list: NotebookSource[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)); window.dispatchEvent(new CustomEvent(EVENT)); }
  catch { /* квота/приватный режим — останется в памяти на сессию */ }
}

// Выбранные источники (id). null в хранилище → выбраны все (поведение по умолчанию как у NotebookLM).
export function loadSelectedIds(): string[] | null {
  try {
    const raw = localStorage.getItem(SEL_KEY);
    if (raw === null) return null;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr as string[] : null;
  } catch { return null; }
}

export function saveSelectedIds(ids: string[]): void {
  try { localStorage.setItem(SEL_KEY, JSON.stringify(ids)); window.dispatchEvent(new CustomEvent(EVENT)); }
  catch { /* см. saveSources */ }
}

export function subscribeNotebook(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(EVENT, handler);
  window.addEventListener('storage', handler); // изменение из другой вкладки того же origin
  return () => { window.removeEventListener(EVENT, handler); window.removeEventListener('storage', handler); };
}

// Разбор ввода в источник: похоже на адрес → URL (status 'loading' — ждёт извлечения), иначе текст
// (сразу 'ready'). Извлечение url запускает вызывающая сторона (Notebook.tsx) через IPC.
export function sourceFromInput(raw: string): NotebookSource | null {
  const v = raw.trim();
  if (!v) return null;
  const id = (globalThis.crypto?.randomUUID?.() ?? String(Date.now() + Math.random()));
  const looksUrl = /^https?:\/\//i.test(v) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v);
  if (looksUrl) {
    const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    let host = v;
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* оставим как есть */ }
    // content до извлечения тоже держит адрес — так работает повторное извлечение у источников,
    // добавленных до появления поля url (терпимость к старому формату, см. loadSources).
    return { id, kind: 'url', title: host, content: url, url, addedAt: Date.now(), status: 'loading' };
  }
  const title = v.split('\n')[0]!.slice(0, 60);
  return { id, kind: 'text', title, content: v, addedAt: Date.now(), status: 'ready' };
}

// Текст выбранных готовых источников для грунтинга чата (см. заход 3). null — нечего подмешивать.
export function getSelectedSourceContext(): string | null {
  const sources = loadSources();
  const sel = loadSelectedIds();
  const isSel = (id: string) => sel === null || sel.includes(id);
  const parts: string[] = [];
  let total = 0;
  for (const s of sources) {
    if (!isSel(s.id) || s.status !== 'ready' || !s.content.trim()) continue;
    const chunk = `## Источник: ${s.title}\n${s.content.trim()}`;
    if (total + chunk.length > GROUNDING_MAX_CHARS) {
      parts.push(chunk.slice(0, Math.max(0, GROUNDING_MAX_CHARS - total)));
      break;
    }
    parts.push(chunk);
    total += chunk.length;
  }
  return parts.length ? parts.join('\n\n') : null;
}
