// Кто отвечает за роль прямо сейчас: подключения + ключи + адаптеры в одном месте.
//
// ⚠️ Это единственная развилка «локально или облако» во всём приложении. Пока «локально» зашито в
// каждую AI-функцию, подключение извне означает тринадцать одинаковых `if`; здесь развилка одна, и
// вызывающему достаётся готовый Provider, который он не отличает от встроенной Qwen.
//
// ⚠️ Локальный провайдер собирается из зависимостей, переданных СНАРУЖИ (init). Иначе реестр
// импортировал бы TranslationService, а тот — реестр, и получилось бы кольцо. Заодно так видно, что
// грев модели — забота хозяина очереди, а не слоя.

import { capsFor, concurrencyFor, localConnection, LOCAL_CONNECTION_ID, type Connection } from '../../shared/aiProviders';
import { resolveRoute, type AiRole, type Route, type RoutingTable } from '../../shared/aiRouting';
import { createLimiter } from '../../shared/limiter';
import * as KeyStore from './KeyStore';
import { createLocalProvider, type LocalDeps } from './providers/local';
import { createOpenAiCompatibleProvider } from './providers/openaiCompatible';
import { createAnthropicProvider } from './providers/anthropic';
import { createGeminiProvider } from './providers/gemini';
import type { Provider } from './Provider';
export type { JsonSchema } from '../../shared/aiSchema';

let localDeps: LocalDeps | null = null;
let connections: Connection[] = [];
let table: RoutingTable = {};

// Провайдеры живут между вызовами: у них нет состояния запроса, зато есть ограничитель
// одновременности, который обязан быть общим для всех вызовов одного подключения.
const cache = new Map<string, { conn: Connection; provider: Provider }>();

export function init(deps: LocalDeps): void {
  localDeps = deps;
}

/** Заведённые человеком подключения (без встроенной локальной — она есть всегда). */
export function setConnections(next: readonly Connection[]): void {
  connections = next.filter((c) => c.id !== LOCAL_CONNECTION_ID).map((c) => ({ ...c }));
  // ⚠️ Чистим кэш выборочно: адрес или модель могли смениться, и старый провайдер продолжил бы
  // ходить по прежнему адресу до перезапуска — то есть человек «сохранил», а ничего не изменилось.
  for (const [id, entry] of cache) {
    const fresh = connections.find((c) => c.id === id);
    if (!fresh || !sameConnection(fresh, entry.conn)) cache.delete(id);
  }
}

export function setRoutingTable(next: RoutingTable): void {
  table = { ...next };
}

function sameConnection(a: Connection, b: Connection): boolean {
  return a.kind === b.kind && a.baseUrl === b.baseUrl && a.model === b.model
    && a.concurrency === b.concurrency && a.schema === b.schema;
}

/**
 * Какое подключение отвечает за роль и почему.
 *
 * ⚠️ `ready` считается ПО КЛЮЧАМ, а не по последней удачной попытке. Ключ — то, что человек может
 * поправить сам; «сервер не ответил в прошлый раз» — состояние, которое устареет к следующему
 * запросу, и держать по нему маршрут значило бы наказывать человека за чужую пятисекундную аварию.
 */
export function routeFor(role: AiRole): Route {
  return resolveRoute(role, table, {
    connections,
    ready: connections.filter((c) => capsFor(c).local || KeyStore.hasKey(c.id)).map((c) => c.id),
    localIds: connections.filter((c) => capsFor(c).local).map((c) => c.id),
  });
}

/** Готовый провайдер для роли плюс объяснение, если случился откат. */
export function providerFor(role: AiRole): { provider: Provider; route: Route } {
  const route = routeFor(role);
  return { provider: providerById(route.connectionId), route };
}

export function providerById(id: string): Provider {
  if (id === LOCAL_CONNECTION_ID) return local();

  const conn = connections.find((c) => c.id === id);
  // Подключение исчезло между решением и вызовом — не падаем, отвечает локальная.
  if (!conn) return local();

  const hit = cache.get(id);
  if (hit && sameConnection(hit.conn, conn)) return hit.provider;

  const provider = limited(create(conn), concurrencyFor(conn));
  cache.set(id, { conn: { ...conn }, provider });
  return provider;
}

function create(conn: Connection): Provider {
  const getKey = (): string | null => KeyStore.getKey(conn.id);
  switch (conn.kind) {
    case 'anthropic': return createAnthropicProvider({ connection: conn, getKey });
    case 'gemini': return createGeminiProvider({ connection: conn, getKey });
    case 'openai-compatible': return createOpenAiCompatibleProvider({ connection: conn, getKey });
    case 'local': return local();
  }
}

function local(): Provider {
  if (localDeps === null) throw new Error('[ai/registry] init() не вызван — локальный провайдер не собран');
  const key = LOCAL_CONNECTION_ID;
  const hit = cache.get(key);
  if (hit) return hit.provider;
  // ⚠️ Ограничитель на единицу для локальной — не политика, а физика: у node-llama-cpp один
  // контекст на процесс, второй одновременный запрос не «медленнее», а невозможен.
  const provider = limited(createLocalProvider(localDeps), 1);
  cache.set(key, { conn: localConnection(localDeps.modelId() ?? ''), provider });
  return provider;
}

/**
 * Обёртка, пропускающая не больше N запросов разом.
 *
 * ⚠️ Предел живёт У ПОДКЛЮЧЕНИЯ, а не один на приложение. Единая очередь существует сегодня
 * потому, что у локальной модели один контекст на процесс; облаку это ограничение чужое, и держать
 * облачный чат за локальным переводом страницы было бы выдуманной задержкой.
 *
 * ⚠️ Сам счётчик — в shared/limiter.ts под проверкой, и это не церемония: наивная версия («release
 * уменьшает счётчик, разбуженный увеличивает») ПРЕВЫШАЕТ предел, что для локальной модели означает
 * два одновременных запроса к единственному контексту llama.cpp. Разбор — в шапке того модуля.
 */
function limited(inner: Provider, max: number): Provider {
  const lim = createLimiter(max);
  return {
    get connection() { return inner.connection; },
    caps: () => inner.caps(),
    generate: (p, o) => lim.run(() => inner.generate(p, o)),
    generateStructured: (sc, p, o) => lim.run(() => inner.generateStructured(sc, p, o)),
    chat: (t, h, sp, o) => lim.run(() => inner.chat(t, h, sp, o)),
  };
}


/**
 * Встроенная Qwen как провайдер, со сборкой слоя при первом обращении.
 *
 * ⚠️ Живёт ЗДЕСЬ, а не у вызывающего: собрать слой нужно один раз на приложение, а зовут его из
 * TranslationService, который сам и поставляет зависимости. Держать эту склейку у него значило бы
 * тащить в файл ленивый флаг и знание про идентификатор локального подключения — ровно то, от чего
 * слой и избавляет.
 *
 * ⚠️ Инициализация ЛЕНИВАЯ: провайдер трогает Electron-приложение, и на верхнем уровне модуля это
 * выполнилось бы до app.whenReady().
 *
 * ⚠️ Подключение берётся ПО ИМЕНИ, а не по роли. Роль объявляет вызывающий, а у трубы
 * TranslationService их семнадцать — раздать роли значит поменять семнадцать мест, то есть другой
 * заход. Пока подключений нет ни одного, routeFor всё равно вернул бы локальную.
 */
export function localProvider(ensureLoaded: LocalDeps['ensureLoaded'], modelId: LocalDeps['modelId']): Provider {
  if (localDeps === null) init({ ensureLoaded, modelId });
  return providerById(LOCAL_CONNECTION_ID);
}

/** Для диагностики и для шапки настроек: что заведено и у чего есть ключ. */
export function status(): { connections: readonly Connection[]; ready: readonly string[] } {
  return { connections, ready: KeyStore.readyIds() };
}
