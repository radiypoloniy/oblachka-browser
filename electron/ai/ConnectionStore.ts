// Заведённые подключения и таблица маршрутов. НЕ секреты — ключи живут в KeyStore под safeStorage.
//
// ⚠️ Отдельным файлом, а не в settings.json, по той же причине, что список доверенных сертификатов
// (см. CertTrustStore.ts): это не настройка удобства, а подсистема со своей формой и своей
// миграцией. Заодно она лежит рядом со своим ключным хранилищем — вместе их и читать.
//
// ⚠️ ЧТЕНИЕ ТЕРПИМОЕ, а запись атомарная. Файл переживёт правку руками и обновление формата: чужие
// и битые записи выбрасываются поштучно, а не роняют весь список. Потерять здесь можно только
// удобство (человек заведёт подключение заново), но уронить старт браузера из-за одной кривой
// строки нельзя.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { PROVIDER_KINDS, validateConnection, type Connection, type ProviderKind, type SchemaMode } from '../../shared/aiProviders';
import { AI_ROLES, type AiRole, type RoutingTable } from '../../shared/aiRouting';

const FILE = 'ai-connections.json';

interface StoreFile {
  version: 1;
  connections: Connection[];
  routing: RoutingTable;
}

type Listener = () => void;

let connections: Connection[] = [];
let routing: RoutingTable = {};
const listeners = new Set<Listener>();

function filePath(): string {
  return path.join(app.getPath('userData'), FILE);
}

/** Вызывается один раз при старте, после app.whenReady(). */
export function loadFromDisk(): void {
  connections = [];
  routing = {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(filePath(), 'utf8'));
    if (typeof parsed !== 'object' || parsed === null) return;
    const o = parsed as Record<string, unknown>;
    connections = Array.isArray(o['connections']) ? o['connections'].flatMap(readConnection) : [];
    routing = readRouting(o['routing']);
  } catch {
    // Файла нет (первый запуск) или он не читается — начинаем с пустого, это норма.
  }
  notify();
}

/**
 * ⚠️ Валидируем ТЕМ ЖЕ правилом, что и форма добавления (validateConnection), а не отдельной
 * проверкой «похоже на объект». Иначе запись, отвергнутая интерфейсом, могла бы приехать с диска и
 * работать — например, ключ по открытому http на чужой адрес.
 */
function readConnection(raw: unknown): Connection[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const o = raw as Record<string, unknown>;
  const kind = o['kind'];
  if (typeof o['id'] !== 'string' || typeof o['label'] !== 'string') return [];
  if (typeof kind !== 'string' || !(PROVIDER_KINDS as readonly string[]).includes(kind)) return [];
  const conn: Connection = {
    id: o['id'],
    label: o['label'],
    kind: kind as ProviderKind,
    baseUrl: typeof o['baseUrl'] === 'string' ? o['baseUrl'] : '',
    model: typeof o['model'] === 'string' ? o['model'] : '',
    concurrency: typeof o['concurrency'] === 'number' ? o['concurrency'] : 4,
    ...(typeof o['schema'] === 'string' ? { schema: o['schema'] as SchemaMode } : {}),
  };
  return validateConnection(conn).ok ? [conn] : [];
}

function readRouting(raw: unknown): RoutingTable {
  if (typeof raw !== 'object' || raw === null) return {};
  const o = raw as Record<string, unknown>;
  const out: RoutingTable = {};
  for (const role of AI_ROLES) {
    const v = o[role];
    if (typeof v === 'string') out[role] = v;
  }
  return out;
}

export function list(): Connection[] {
  return connections.map((c) => ({ ...c }));
}

export function table(): RoutingTable {
  return { ...routing };
}

/** Завести подключение или переписать существующее с тем же id. */
export function upsert(conn: Connection): boolean {
  if (!validateConnection(conn).ok) return false;
  const next = connections.filter((c) => c.id !== conn.id).concat({ ...conn });
  return write(next, routing);
}

/**
 * ⚠️ Удаление подключения СНИМАЕТ И МАРШРУТЫ на него. Иначе в таблице осталась бы ссылка на
 * несуществующее, и каждый запрос этой роли шёл бы через откат «подключение удалено» — то есть
 * работал, но с лишним объяснением в интерфейсе на каждом ответе.
 */
export function remove(id: string): boolean {
  const nextRouting: RoutingTable = {};
  for (const role of AI_ROLES) {
    const v = routing[role];
    if (v !== undefined && v !== id) nextRouting[role] = v;
  }
  return write(connections.filter((c) => c.id !== id), nextRouting);
}

export function setRoute(role: AiRole, connectionId: string | null): boolean {
  const next: RoutingTable = { ...routing };
  if (connectionId === null) delete next[role]; else next[role] = connectionId;
  return write(connections, next);
}

function write(nextConnections: Connection[], nextRouting: RoutingTable): boolean {
  const payload: StoreFile = { version: 1, connections: nextConnections, routing: nextRouting };
  try {
    const target = filePath();
    const tmp = `${target}.tmp`;
    // Через временный файл и переименование — как settings.json и downloads.json: обрыв записи не
    // должен оставить половину файла вместо всего списка.
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmp, target);
  } catch (e) {
    console.error('[ai/ConnectionStore] не удалось записать подключения:', e);
    return false;
  }
  connections = nextConnections;
  routing = nextRouting;
  notify();
  return true;
}

export function onChanged(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify(): void {
  for (const cb of listeners) cb();
}
