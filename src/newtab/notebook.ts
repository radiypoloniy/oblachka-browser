// Модель данных «блокнота» большого AI-экрана (NotebookLM-подобный хаб, см. Notebook.tsx).
//
// ⚠️ Блокнотов НЕСКОЛЬКО, и это не украшательство. Раньше источники лежали в одном месте на всё
// приложение: чтобы взяться за другую тему, приходилось удалять всё, что собрано по прежней, —
// и вернуться к ней было уже нельзя. Живая формулировка: «сгенерировал документ, надо другой по
// другой теме и вернуться к этой».
//
// ⚠️ Наружу по-прежнему торчат ТЕ ЖЕ функции (loadSources/saveSources/…): они просто работают с
// активным блокнотом. Так переключение не потребовало трогать ни чат, ни Студию, ни панель —
// им и не нужно знать, что блокнотов стало много.
//
// Крупный текст статьи (десятки КБ) складывается в content после извлечения
// (electron/NotebookExtract, electron/FileExtract). Изменения рассылаются window-событием →
// открытая панель и чат применяют их живьём (subscribeNotebook).

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

export interface Notebook {
  id: string;
  /** Имя, заданное человеком. Пусто — показываем имя первого источника (см. notebookTitle). */
  title: string;
  createdAt: number;
  sources: NotebookSource[];
  /** Выбранные источники. null — выбраны все (поведение по умолчанию, как у NotebookLM). */
  selected: string[] | null;
}

interface Store { activeId: string; list: Notebook[] }

const KEY = 'oblako-notebooks';
// Ключи прежнего формата — ОДИН блокнот на всё приложение. Читаются один раз при переезде и
// больше не трогаются: удалять их незачем, а перезаписывать — тем более.
const OLD_KEY = 'oblako-notebook-sources';
const OLD_SEL_KEY = 'oblako-notebook-selected';
const EVENT = 'oblako-notebook-changed';
/** Сменился активный блокнот — это другое событие, чем «поменялись источники». */
const SWITCH_EVENT = 'oblako-notebook-switched';

// Бюджет текста источников на грунтинг чата — модель локальная и небольшая; даже при большом
// контексте (Q8_0 KV) слишком длинный ввод замедляет ответ. Режем суммарно.
const GROUNDING_MAX_CHARS = 24_000;

const newId = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? String(Date.now() + Math.random()));

function emptyNotebook(): Notebook {
  return { id: newId(), title: '', createdAt: Date.now(), sources: [], selected: null };
}

/** Терпимость к старому формату записи источника: без status и без url. */
function fixSource(s: NotebookSource): NotebookSource {
  return {
    ...s,
    status: s.status ?? 'ready',
    url: s.url ?? (s.kind === 'url' && /^https?:\/\//i.test(s.content) ? s.content : undefined),
  };
}

function readStore(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const st = JSON.parse(raw) as Store;
      if (st && Array.isArray(st.list) && st.list.length > 0) {
        const list = st.list.map((n) => ({ ...n, sources: (n.sources ?? []).map(fixSource) }));
        const activeId = list.some((n) => n.id === st.activeId) ? st.activeId : list[0]!.id;
        return { activeId, list };
      }
    }
  } catch { /* битый JSON — переезжаем со старого формата ниже */ }

  // ⚠️ Переезд со старого формата. Данные человека НЕ ТЕРЯЕМ: то, что было собрано одним
  // списком, становится первым блокнотом. Старые ключи остаются лежать нетронутыми — стирать
  // чужое ради чистоты не наше дело.
  const first = emptyNotebook();
  try {
    const arr = JSON.parse(localStorage.getItem(OLD_KEY) ?? '[]');
    if (Array.isArray(arr)) first.sources = (arr as NotebookSource[]).map(fixSource);
    const sel = localStorage.getItem(OLD_SEL_KEY);
    if (sel !== null) {
      const ids = JSON.parse(sel);
      if (Array.isArray(ids)) first.selected = ids as string[];
    }
  } catch { /* нечего переносить */ }
  return { activeId: first.id, list: [first] };
}

function writeStore(st: Store, switched = false): void {
  try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { /* квота — останется на сессию */ }
  window.dispatchEvent(new CustomEvent(EVENT));
  if (switched) window.dispatchEvent(new CustomEvent(SWITCH_EVENT));
}

function active(st: Store): Notebook {
  return st.list.find((n) => n.id === st.activeId) ?? st.list[0]!;
}

// ── Блокноты ────────────────────────────────────────────────────────────────

export function loadNotebooks(): { activeId: string; list: Notebook[] } {
  return readStore();
}

/**
 * Имя блокнота для показа.
 *
 * ⚠️ Считается, а не хранится: заданное имя, иначе имя первого источника, иначе номер по
 * порядку. Так у блокнота есть осмысленное название сразу после добавления первой ссылки, и
 * человеку не приходится ничего называть руками, пока он сам не захочет.
 */
export function notebookTitle(n: Notebook, index: number): string {
  if (n.title.trim()) return n.title.trim();
  const first = n.sources[0]?.title?.trim();
  if (first) return first.length > 40 ? `${first.slice(0, 40)}…` : first;
  return `Блокнот ${index + 1}`;
}

/** Новый пустой блокнот. Текущий никуда не девается — к нему можно вернуться списком. */
export function createNotebook(): string {
  const st = readStore();
  const n = emptyNotebook();
  st.list.push(n);
  st.activeId = n.id;
  writeStore(st, true);
  return n.id;
}

export function switchNotebook(id: string): void {
  const st = readStore();
  if (!st.list.some((n) => n.id === id) || st.activeId === id) return;
  st.activeId = id;
  writeStore(st, true);
}

export function renameNotebook(id: string, title: string): void {
  const st = readStore();
  const n = st.list.find((x) => x.id === id);
  if (!n) return;
  n.title = title.slice(0, 80);
  writeStore(st);
}

/**
 * Удалить блокнот.
 *
 * ⚠️ Последний не удаляется, а ОЧИЩАЕТСЯ: экран без единого блокнота — состояние, которого в
 * интерфейсе нет, и городить его ради одного случая незачем.
 */
export function deleteNotebook(id: string): void {
  const st = readStore();
  if (st.list.length <= 1) {
    const n = emptyNotebook();
    writeStore({ activeId: n.id, list: [n] }, true);
    return;
  }
  const at = st.list.findIndex((n) => n.id === id);
  if (at < 0) return;
  st.list.splice(at, 1);
  const switched = st.activeId === id;
  if (switched) st.activeId = st.list[Math.max(0, at - 1)]!.id;
  writeStore(st, switched);
}

// ── Источники активного блокнота ────────────────────────────────────────────

export function loadSources(): NotebookSource[] {
  return active(readStore()).sources;
}

export function saveSources(list: NotebookSource[]): void {
  const st = readStore();
  active(st).sources = list;
  writeStore(st);
}

export function loadSelectedIds(): string[] | null {
  return active(readStore()).selected;
}

export function saveSelectedIds(ids: string[]): void {
  const st = readStore();
  active(st).selected = ids;
  writeStore(st);
}

export function subscribeNotebook(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(EVENT, handler);
  window.addEventListener('storage', handler); // изменение из другой вкладки того же origin
  return () => { window.removeEventListener(EVENT, handler); window.removeEventListener('storage', handler); };
}

/**
 * Сменился активный блокнот.
 *
 * ⚠️ Отдельная подписка от subscribeNotebook, потому что реакция другая: на смену источников
 * список просто перечитывается, а на смену БЛОКНОТА чат обязан начать новую беседу — иначе
 * ответы по прошлой теме останутся висеть под новыми источниками и будут выглядеть ответами
 * по ним.
 */
export function subscribeNotebookSwitch(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(SWITCH_EVENT, handler);
  return () => window.removeEventListener(SWITCH_EVENT, handler);
}

// ── Грунтинг чата ───────────────────────────────────────────────────────────

/** Текст выбранных готовых источников для грунтинга чата. null — нечего подмешивать. */
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

// ── Разбор ввода ────────────────────────────────────────────────────────────

/** Похоже на адрес → URL (ждёт извлечения), иначе текст (сразу готов). */
export function sourceFromInput(raw: string): NotebookSource | null {
  const v = raw.trim();
  if (!v) return null;
  const id = newId();
  const looksUrl = /^https?:\/\//i.test(v) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v);
  if (looksUrl) {
    const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    let host = v;
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* оставим как есть */ }
    // content до извлечения тоже держит адрес — так работает повторное извлечение у источников,
    // добавленных до появления поля url.
    return { id, kind: 'url', title: host, content: url, url, addedAt: Date.now(), status: 'loading' };
  }
  const title = v.split('\n')[0]!.slice(0, 60);
  return { id, kind: 'text', title, content: v, addedAt: Date.now(), status: 'ready' };
}

/**
 * Локальный документ источником. Текста ещё нет — его читает main (extractFileText), поэтому
 * источник заводится в 'loading', как и ссылка.
 */
export function sourceFromFile(file: { path: string; name: string }): NotebookSource {
  return {
    id: newId(), kind: 'file', title: file.name, content: '',
    path: file.path, addedAt: Date.now(), status: 'loading',
  };
}
