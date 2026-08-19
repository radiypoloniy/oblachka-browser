// Реестр команд: что человек может вызвать и откуда. Устройство — как у SkillsStore.ts
// (свой файл в userData, атомарная запись, слушатели), разбор слоя целиком —
// docs/commands-architecture.md.
//
// ⚠️ Состояние ДВЕРИ В ОМНИБОКСЕ хранится ЗДЕСЬ ЖЕ, а не в общих настройках. Причина не в лени:
// это свойство самого слоя команд, и человек меняет его на экране команд, глядя на их список.
// Настройка, живущая отдельно от того, чем управляет, теряется — а эта обязана быть найдена
// первым, кого новая сущность в адресной строке раздражает.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { CommandDef, OmniboxDoorMode } from '../shared/commands';
import { BUILTIN_COMMANDS, COMMANDS_MAX, OMNIBOX_DOOR_MODES, validateCommand } from '../shared/commands';

interface Persisted {
  door: OmniboxDoorMode;
  items: CommandDef[];
}

type Listener = (commands: CommandDef[]) => void;

let items: CommandDef[] = [];
let door: OmniboxDoorMode = 'always';
const listeners = new Set<Listener>();

function filePath(): string {
  return path.join(app.getPath('userData'), 'commands.json');
}

function seedBuiltins(): CommandDef[] {
  const now = Date.now();
  return BUILTIN_COMMANDS.map((c) => ({ ...c, createdAt: now, lastRunAt: 0, runs: 0 }));
}

// Атомарная запись tmp+rename — как у settings.json и skills.json: половина файла на диске хуже,
// чем его отсутствие.
function write(): void {
  try {
    const file = filePath();
    const tmp = `${file}.tmp`;
    const data: Persisted = { door, items };
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch (e) {
    console.warn('[CommandStore] не удалось записать commands.json:', (e as Error).message);
  }
}

function notify(): void {
  const snapshot = list();
  for (const cb of listeners) cb(snapshot);
}

/**
 * Загрузка при старте — явным вызовом из main.ts, а не побочным эффектом импорта (тот же приём,
 * что у остальных *Store).
 *
 * ⚠️ Встроенные команды ДОБАВЛЯЮТСЯ к тому, что на диске, по id. Так новая встроенная команда
 * появляется у человека, уже пользовавшегося браузером, а его собственные и его правки —
 * переживают обновление. Затирать файл дефолтами нельзя: это его данные.
 */
export function loadFromDisk(): void {
  try {
    const raw = fs.readFileSync(filePath(), 'utf8');
    const data = JSON.parse(raw) as Partial<Persisted>;
    const parsed = Array.isArray(data.items)
      ? data.items.map(validateCommand).filter((c): c is CommandDef => c !== null)
      : [];
    items = parsed;
    door = OMNIBOX_DOOR_MODES.includes(data.door as OmniboxDoorMode) ? (data.door as OmniboxDoorMode) : 'always';
  } catch {
    items = [];   // файла нет — первый запуск
  }

  const known = new Set(items.map((c) => c.id));
  const missing = seedBuiltins().filter((c) => !known.has(c.id));
  if (missing.length > 0) items = [...items, ...missing];
  write();
}

export function list(): CommandDef[] {
  return items.map((c) => ({ ...c }));
}

export function getDoor(): OmniboxDoorMode {
  return door;
}

export function setDoor(mode: OmniboxDoorMode): boolean {
  if (!OMNIBOX_DOOR_MODES.includes(mode)) return false;
  door = mode;
  write();
  notify();
  return true;
}

export function byId(id: string): CommandDef | null {
  return items.find((c) => c.id === id) ?? null;
}

export function add(input: unknown): boolean {
  if (items.length >= COMMANDS_MAX) return false;
  const candidate = validateCommand(input);
  if (!candidate) return false;
  if (items.some((c) => c.id === candidate.id)) return false;
  // ⚠️ Пользовательская команда НИКОГДА не builtin и не получает инструментов: их выдаёт только
  // третий этап вместе с предпросмотром и откатом, и выдаёт код, а не запись на диске.
  items = [...items, { ...candidate, builtin: false, tools: [] }];
  write();
  notify();
  return true;
}

export function update(id: string, patch: Partial<Pick<CommandDef, 'name' | 'phrase' | 'prompt' | 'doors'>>): boolean {
  const idx = items.findIndex((c) => c.id === id);
  if (idx === -1) return false;
  const next = validateCommand({ ...items[idx], ...patch });
  if (!next) return false;
  // Права и происхождение через этот путь не правятся — только то, что человек видит на экране.
  items = items.map((c, i) => (i === idx ? { ...next, builtin: c.builtin, needs: c.needs, tools: c.tools } : c));
  write();
  notify();
  return true;
}

/** ⚠️ Встроенные не удаляются — их можно только убрать из двери (doors), см. update. */
export function remove(id: string): boolean {
  const target = items.find((c) => c.id === id);
  if (!target || target.builtin) return false;
  items = items.filter((c) => c.id !== id);
  write();
  notify();
  return true;
}

/** Отметить запуск. Счётчик живёт в самой команде — по нему видно, что в списке заросло. */
export function touch(id: string): void {
  const idx = items.findIndex((c) => c.id === id);
  if (idx === -1) return;
  items = items.map((c, i) => (i === idx ? { ...c, runs: c.runs + 1, lastRunAt: Date.now() } : c));
  write();
  notify();
}

export function subscribe(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
