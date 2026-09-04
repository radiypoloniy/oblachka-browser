// Список моделей у провайдера и поиск локальных раннеров на этой машине.
//
// ⚠️ Отдельно от connections.ts намеренно: там снимок состояния и проба ПОДКЛЮЧЕНИЯ (доедет ли
// запрос, примут ли ключ), здесь — вопрос «что у тебя есть», который задаётся ещё до того, как
// подключение заведено. Смешать их значило бы получить функцию, половина параметров которой не
// нужна половине вызовов.
//
// ⚠️ В сеть ходим ТОЛЬКО через fetchInProfile. Глобальный fetch идёт мимо сессии Electron, то есть
// мимо прокси, мимо kill switch и мимо адблока (см. шапку providers/openaiCompatible.ts).
//
// ⚠️ Локальные раннеры при включённом VPN работают, и это не случайность: Chromium обходит
// loopback в обход прокси сам, а снимаем мы этот обход только в kill switch (см. KILL_SWITCH_BYPASS
// в main.ts). Раннер в ЛОКАЛЬНОЙ СЕТИ (машина с видеокартой в соседней комнате) в туннель уйдёт и
// не дойдёт — это отдельная задача, и решать её молчаливым исключением для приватных диапазонов
// нельзя: то же исключение открывает локальную сеть странице во вкладке.

import { PROVIDER_PRESETS, type Connection, type ProviderKind } from '../../shared/aiProviders';
import type { AiModelList, AiRunnerFound } from '../../shared/ipc';
import { looksLikeModelList, modelsUrl, normalizeBase, parseModelList } from '../../shared/modelList';
import { fetchInProfile } from '../ProfileSession';
import * as ConnectionStore from './ConnectionStore';
import * as KeyStore from './KeyStore';

/** Версия API Anthropic. ⚠️ Обязательный заголовок: без него отвечают отказом, а не значением по умолчанию. */
const ANTHROPIC_VERSION = '2023-06-01';

/** Ждём ответа от провайдера. Список у OpenRouter — три сотни записей, но это всё равно один GET. */
const LIST_TIMEOUT_MS = 10_000;

/**
 * Ждём ответа от локального раннера.
 *
 * ⚠️ Коротко и жёстко: это ПРОБА ПОРТА при открытии раздела настроек, а не запрос по просьбе
 * человека. У выключенной Ollama соединение отваливается мгновенно, а вот у порта, занятого чем-то
 * посторонним, ответ может не прийти вовсе — и раздел настроек будет ждать его молча.
 */
const DISCOVER_TIMEOUT_MS = 1200;

/**
 * Что провайдер отдаёт по GET /models.
 *
 * ⚠️ Ключ приходит ПАРАМЕТРОМ, а `null` означает «возьми сохранённый» — ровно как у
 * probeConnection: список нужен и до сохранения (человек только вводит ключ), и после (кнопка у
 * заведённой карточки, а ключа у интерфейса нет и быть не должно).
 */
export async function listModels(conn: Connection, key: string | null): Promise<AiModelList> {
  const url = modelsUrl(conn.baseUrl, conn.kind);
  if (url === null) return { ok: false, error: 'У этого подключения списка моделей нет.' };

  const secret = key ?? KeyStore.getKey(conn.id);
  try {
    const res = await fetchInProfile(url, {
      headers: authHeaders(conn.kind, secret),
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: httpReason(res.status) };
    const json: unknown = await res.json().catch(() => null);
    const models = parseModelList(json, conn.kind);
    // ⚠️ Пустой список — это ОТКАЗ, а не успех: выпадашка без единой строки читается поломкой
    // интерфейса. Но причина у пустоты бывает разная, и путать их нельзя: список правильной формы
    // без записей означает «моделей ещё нет» (свежая Ollama), а всё остальное — «адрес ответил
    // чем-то посторонним». Человеку это разные задачи: скачать модель или исправить адрес.
    if (models.length === 0) {
      return looksLikeModelList(json)
        ? { ok: false, error: 'Адрес отвечает, но ни одной модели там нет.' }
        : { ok: false, error: 'Адрес ответил, но списка моделей в ответе нет.' };
    }
    return { ok: true, models };
  } catch (e) {
    return { ok: false, error: unreachable(e) };
  }
}

/**
 * Кто из локальных раннеров запущен прямо сейчас.
 *
 * ⚠️ Стучимся только в ПРЕСЕТЫ без ключа на loopback — то есть в Ollama и LM Studio на их
 * штатных портах. Сканировать порты мы не будем ни при каких условиях: это ровно то поведение,
 * за которое ругают чужие программы, и по ту сторону порта может оказаться что угодно чужое.
 *
 * ⚠️ Уже заведённое не предлагаем: карточка «нашли Ollama — подключить?» над списком, где Ollama
 * уже стоит, читается сбоем, а не находкой.
 */
export async function discoverRunners(): Promise<AiRunnerFound[]> {
  const known = new Set(ConnectionStore.list().map((c) => normalizeBase(c.baseUrl)));
  const candidates = PROVIDER_PRESETS.filter(
    (p) => !p.needsKey && p.kind === 'openai-compatible' && !known.has(normalizeBase(p.baseUrl)),
  );

  const found = await Promise.all(candidates.map(async (p): Promise<AiRunnerFound | null> => {
    const url = modelsUrl(p.baseUrl, p.kind);
    if (url === null) return null;
    try {
      const res = await fetchInProfile(url, { signal: AbortSignal.timeout(DISCOVER_TIMEOUT_MS) });
      if (!res.ok) return null;
      const json: unknown = await res.json().catch(() => null);
      // ⚠️ Форму ответа проверяем ОТДЕЛЬНО от содержимого: чужая служба на этом порту тоже может
      // ответить 200 своим JSON, и без проверки формы мы объявили бы её найденным раннером.
      if (!looksLikeModelList(json)) return null;
      // ⚠️ ПУСТОЙ СПИСОК — законная находка, а не повод промолчать. Свежая Ollama отвечает
      // `{"object":"list","data":null}`: она запущена, но моделей ещё нет. Молчание здесь читается
      // как «браузер её не увидел» — живой случай: человек поставил Ollama и не понял, почему в
      // настройках ничего не изменилось. Что делать дальше, говорит карточка.
      return { presetId: p.id, label: p.label, baseUrl: p.baseUrl, models: parseModelList(json, p.kind) };
    } catch {
      // Порт закрыт (раннер не запущен) или на нём кто-то посторонний — это норма, а не ошибка.
      return null;
    }
  }));

  return found.filter((f): f is AiRunnerFound => f !== null);
}

/**
 * ⚠️ Заголовки те же, что у боевых запросов адаптеров, и это не совпадение: список, полученный с
 * другой авторизацией, отвечал бы на другой вопрос. Разойдясь здесь на один заголовок, мы получили
 * бы «список показывается, а запрос не проходит» — самый непонятный вид поломки для человека.
 */
function authHeaders(kind: ProviderKind, key: string | null): Record<string, string> {
  if (key === null) return {};
  switch (kind) {
    case 'anthropic': return { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION };
    case 'gemini': return { 'x-goog-api-key': key };
    default: return { Authorization: `Bearer ${key}` };
  }
}

/**
 * Код ответа → фраза для человека.
 *
 * ⚠️ Тело ответа сюда не попадает (см. explain() в connections.ts): у части шлюзов там простыня на
 * десять строк, а у некоторых — эхо запроса вместе с ключом.
 */
function httpReason(status: number): string {
  if (status === 401 || status === 403) return 'Ключ не принят — проверьте, что скопировали его целиком.';
  if (status === 404) return 'Этот адрес списка моделей не отдаёт — впишите имя модели вручную.';
  if (status === 429) return 'Провайдер отвечает «слишком много запросов» — попробуйте через минуту.';
  return `Провайдер ответил ошибкой ${status}.`;
}

function unreachable(e: unknown): string {
  if (e instanceof Error && e.name === 'TimeoutError') return 'Адрес не ответил вовремя.';
  return 'Не удалось достучаться до адреса. Проверьте его и подключение к сети.';
}
