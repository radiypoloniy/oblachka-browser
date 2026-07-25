// Модель данных «блокнота» большого AI-экрана (NotebookLM-подобный хаб, см. Notebook.tsx).
// Источники + выбор храним в localStorage (общий origin index.html — и вкладка, и чат-центр
// AiChatView читают отсюда). Крупный текст статьи (десятки КБ) складывается в content после
// извлечения (electron/NotebookExtract). saveSources/saveSelected шлют window-событие →
// открытая панель и чат применяют изменения живьём (subscribeNotebook).

export interface NotebookSource {
  id: string;
  kind: 'url' | 'text';
  title: string;
  content: string;   // текст источника; для url наполняется извлечением, до тех пор пуст
  addedAt: number;
  status: 'ready' | 'loading' | 'error'; // loading — идёт извлечение url; error — не удалось
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
    // Терпимость к старому формату без status.
    return (arr as NotebookSource[]).map((s) => ({ ...s, status: s.status ?? 'ready' }));
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
    return { id, kind: 'url', title: host, content: url, addedAt: Date.now(), status: 'loading' };
    // NB: у url в content до извлечения лежит сам адрес (для повторного extract), текст затрёт его.
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
