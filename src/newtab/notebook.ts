// Модель данных «блокнота» большого AI-экрана (NotebookLM-подобный хаб, см. Notebook.tsx).
// Заход 1 (каркас): источники храним в localStorage — тот же приём, что newtab/settings.ts
// (общий origin index.html). Извлечение текста URL и переезд крупного текста в notebooks.sqlite —
// заход 2. Чат (центр) остаётся на HubChatManager и своей БД, здесь не дублируется.

export interface NotebookSource {
  id: string;
  kind: 'url' | 'text';
  title: string;
  content: string;   // текст источника; для kind==='url' наполнится извлечением (заход 2)
  addedAt: number;
}

const KEY = 'oblako-notebook-sources';

export function loadSources(): NotebookSource[] {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr as NotebookSource[] : [];
  } catch {
    return [];
  }
}

export function saveSources(list: NotebookSource[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* квота/приватный режим — останется в памяти на сессию */ }
}

// Разбор пользовательского ввода в источник: похоже на адрес → URL (title = хост), иначе — текст
// (title = первая строка). Извлечение содержимого URL — заход 2.
export function sourceFromInput(raw: string): NotebookSource | null {
  const v = raw.trim();
  if (!v) return null;
  const id = (globalThis.crypto?.randomUUID?.() ?? String(Date.now() + Math.random()));
  const looksUrl = /^https?:\/\//i.test(v) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v);
  if (looksUrl) {
    const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    let host = v;
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* оставим как есть */ }
    return { id, kind: 'url', title: host, content: '', addedAt: Date.now() };
  }
  const title = v.split('\n')[0]!.slice(0, 60);
  return { id, kind: 'text', title, content: v, addedAt: Date.now() };
}
