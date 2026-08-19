// Слой команд — модель данных и разбор фразы. Разбор устройства целиком: docs/commands-architecture.md.
//
// ⚠️ Файл БЕЗ ЗНАЧИМЫХ ИМПОРТОВ и без electron: он нужен main (исполнение), renderer (омнибокс и
// экран команд) и проверке, которая гоняется голым node. То же ограничение, что у shared/rules.ts
// и shared/sessionTree.ts (см. CLAUDE.md).
//
// ⚠️ ГРАНИЦА ДОВЕРИЯ ЖИВЁТ ЗДЕСЬ. `needs` и `tools` — закрытые перечисления, и validateCommand()
// принимает только перечисленное. Это прямое продолжение приёма из shared/rules.ts: что бы ни
// придумала модель, оно не может стать правами команды.

/** Что команде разрешено ВИДЕТЬ. Каждый ключ — отдельный сборщик контекста с своим лимитом. */
export type ContextKey = 'page' | 'selection' | 'tabs' | 'history' | 'notebook' | 'downloads';

/** Что команде разрешено ДЕЛАТЬ. Пустой список — команда-ответ, она не меняет ничего. */
export type ToolId =
  | 'tabs.group' | 'tabs.close' | 'tabs.open'
  | 'notebook.write' | 'autofill.fill' | 'tracking.watch' | 'rules.create';

/** Откуда команду можно вызвать. */
export type DoorKind = 'omnibox' | 'selection' | 'event';

export const CONTEXT_KEYS: readonly ContextKey[] = ['page', 'selection', 'tabs', 'history', 'notebook', 'downloads'];
export const TOOL_IDS: readonly ToolId[] = [
  'tabs.group', 'tabs.close', 'tabs.open',
  'notebook.write', 'autofill.fill', 'tracking.watch', 'rules.create',
];
export const DOOR_KINDS: readonly DoorKind[] = ['omnibox', 'selection', 'event'];

/** Человеческие подписи прав — их видит и человек в списке команд, и мы в карточке. */
export const CONTEXT_LABELS: Record<ContextKey, string> = {
  page: 'эта страница',
  selection: 'выделенный текст',
  tabs: 'открытые вкладки',
  history: 'история',
  notebook: 'блокнот',
  downloads: 'загрузки',
};

export const TOOL_LABELS: Record<ToolId, string> = {
  'tabs.group': 'группировать вкладки',
  'tabs.close': 'закрывать вкладки',
  'tabs.open': 'открывать вкладки',
  'notebook.write': 'писать в блокнот',
  'autofill.fill': 'заполнять формы',
  'tracking.watch': 'ставить отслеживание',
  'rules.create': 'заводить правила',
};

export interface CommandDef {
  id: string;
  /** Имя в списке и в строке подсказки. */
  name: string;
  /**
   * Формулировка человека — по ней команда и находится в омнибоксе.
   *
   * ⚠️ Хранится не из сентиментальности (та же причина, что у phrase в AutomationRule): в списке
   * команд она объясняет, ЗАЧЕМ команда заведена, лучше любой сгенерированной подписи.
   */
  phrase: string;
  /** Что уходит модели. */
  prompt: string;
  builtin: boolean;
  needs: ContextKey[];
  tools: ToolId[];
  doors: DoorKind[];
  createdAt: number;
  lastRunAt: number;
  runs: number;
}

/** Состояние двери в адресной строке. См. разбор в docs/commands-architecture.md §6. */
export type OmniboxDoorMode = 'always' | 'slash' | 'off';
export const OMNIBOX_DOOR_MODES: readonly OmniboxDoorMode[] = ['always', 'slash', 'off'];

/** Больше человек в голове не удержит, а каждая команда — строка в разборе на каждый символ. */
export const COMMANDS_MAX = 60;
export const COMMAND_NAME_MAX = 40;

// ── Встроенные ────────────────────────────────────────────────────────────────
//
// ⚠️ Все стартовые команды — ОТВЕТЫ (tools пустой). Инструменты появляются только вместе с
// карточкой предпросмотра и откатом (этап 3): инструмент без предпросмотра — это уже агент.
export const BUILTIN_COMMANDS: Omit<CommandDef, 'createdAt' | 'lastRunAt' | 'runs'>[] = [
  {
    id: 'page.gist',
    name: 'Что тут по делу',
    phrase: 'что тут по делу',
    prompt: 'Коротко и по делу: о чём эта страница и что из неё стоит вынести. Без вступлений.',
    builtin: true,
    needs: ['page'],
    tools: [],
    doors: ['omnibox', 'selection'],
  },
  {
    id: 'page.explain',
    name: 'Объяснить простыми словами',
    phrase: 'объясни простыми словами',
    prompt: 'Объясни простыми словами, о чём здесь речь. Термины расшифруй.',
    builtin: true,
    needs: ['page', 'selection'],
    tools: [],
    doors: ['omnibox', 'selection'],
  },
  {
    id: 'tabs.digest',
    name: 'Дайджест открытого',
    phrase: 'дайджест открытого',
    prompt: 'Вот список открытых вкладок. Дай по одной строке на каждую: что это и зачем оно открыто.',
    builtin: true,
    needs: ['tabs'],
    tools: [],
    doors: ['omnibox'],
  },
  {
    id: 'page.risks',
    name: 'На что обратить внимание',
    phrase: 'на что обратить внимание',
    prompt: 'Что на этой странице стоит прочитать внимательно: условия, ограничения, сроки, цены. Если ничего такого нет — так и скажи.',
    builtin: true,
    needs: ['page'],
    tools: [],
    doors: ['omnibox', 'selection'],
  },
];

// ── Проверка ──────────────────────────────────────────────────────────────────

/** Пропускает ТОЛЬКО то, что перечислено выше. Всё остальное — не команда. */
export function validateCommand(raw: unknown): CommandDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Partial<CommandDef>;
  if (typeof c.id !== 'string' || !c.id) return null;
  if (typeof c.name !== 'string' || !c.name.trim()) return null;
  if (typeof c.prompt !== 'string' || !c.prompt.trim()) return null;

  const needs = Array.isArray(c.needs) ? c.needs.filter((k): k is ContextKey => CONTEXT_KEYS.includes(k as ContextKey)) : [];
  const tools = Array.isArray(c.tools) ? c.tools.filter((t): t is ToolId => TOOL_IDS.includes(t as ToolId)) : [];
  const doors = Array.isArray(c.doors) ? c.doors.filter((d): d is DoorKind => DOOR_KINDS.includes(d as DoorKind)) : [];
  // ⚠️ Команда без единой двери недостижима — такая запись это мусор, а не настройка.
  if (doors.length === 0) return null;

  return {
    id: c.id,
    name: c.name.trim().slice(0, COMMAND_NAME_MAX),
    phrase: typeof c.phrase === 'string' ? c.phrase.trim() : '',
    prompt: c.prompt.trim(),
    builtin: c.builtin === true,
    needs,
    tools,
    doors,
    createdAt: typeof c.createdAt === 'number' ? c.createdAt : Date.now(),
    lastRunAt: typeof c.lastRunAt === 'number' ? c.lastRunAt : 0,
    runs: typeof c.runs === 'number' && c.runs >= 0 ? Math.floor(c.runs) : 0,
  };
}

// ── Разбор фразы в омнибоксе ──────────────────────────────────────────────────
//
// ⚠️ РАЗБОР ЛОКАЛЬНЫЙ И БЕЗ МОДЕЛИ — он идёт на КАЖДЫЙ набранный символ. Модель включается
// только после Enter. Иначе адресная строка перестаёт отвечать мгновенно, то есть ломается ровно
// то, чем человек пользуется каждый день.

export interface CommandMatch {
  id: string;
  name: string;
  /** Подпись строки: что команда увидит. */
  sub: string;
  /** 0..1. Ниже MATCH_MIN команда не показывается вовсе, ниже MATCH_FIRST — не встаёт первой. */
  score: number;
}

const MATCH_MIN = 0.34;
/** Порог «встать ПЕРВОЙ строкой», то есть перехватить Enter. */
export const MATCH_FIRST = 0.7;

/**
 * ⚠️ Похоже на адрес — команд не предлагаем ВООБЩЕ, даже слабых. Цена ошибки здесь «браузер не
 * открыл сайт», а это худшее, что может случиться с браузером; лучше не показать команду, чем
 * встать между человеком и его адресом.
 */
function looksLikeAddress(q: string): boolean {
  const s = q.trim();
  if (!s) return true;
  if (/\s/.test(s)) return false;               // с пробелом — это уже не адрес
  return /[./:]/.test(s) || /^localhost/i.test(s);
}

function words(s: string): string[] {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
}

/**
 * Кандидаты для строки омнибокса. Возвращает не больше трёх — список подсказок и так плотный.
 */
export function resolveCommands(
  query: string,
  commands: CommandDef[],
  mode: OmniboxDoorMode,
): CommandMatch[] {
  if (mode === 'off') return [];

  let q = query;
  if (mode === 'slash') {
    // ⚠️ В режиме префикса обычный ввод не трогаем вовсе — в этом и весь смысл режима.
    if (!q.startsWith('/')) return [];
    q = q.slice(1);
  }
  if (!q.trim()) return [];
  if (mode === 'always' && looksLikeAddress(q)) return [];

  const qw = words(q);
  if (qw.length === 0) return [];

  const out: CommandMatch[] = [];
  for (const c of commands) {
    if (!c.doors.includes('omnibox')) continue;
    const name = c.name.toLowerCase();
    const hay = new Set([...words(c.name), ...words(c.phrase)]);
    let score = 0;

    if (name.startsWith(q.trim().toLowerCase())) {
      score = 1;                                   // человек набирает само имя
    } else {
      const hit = qw.filter((w) => [...hay].some((h) => h.startsWith(w))).length;
      // Доля слов запроса, нашедшихся в имени и формулировке. Все нашлись — уверенное совпадение.
      score = hit / qw.length;
      if (score < 1) score *= 0.8;                 // частичное совпадение первой строкой не встаёт
    }
    if (score < MATCH_MIN) continue;
    out.push({ id: c.id, name: c.name, sub: describeNeeds(c), score });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, 3);
}

/** «увидит: эта страница» — человеку важно знать это ДО нажатия, а не после. */
export function describeNeeds(c: CommandDef): string {
  if (c.needs.length === 0) return 'ничего не читает';
  return `увидит: ${c.needs.map((k) => CONTEXT_LABELS[k]).join(', ')}`;
}
