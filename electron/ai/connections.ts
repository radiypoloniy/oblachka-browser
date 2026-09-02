// Снимок подключений для интерфейса и живая проба подключения.
//
// ⚠️ Отдельно от хранилищ намеренно: снимок СОБИРАЕТСЯ из двух источников — список и маршруты
// лежат в ConnectionStore, а «есть ли ключ» знает KeyStore. Держать склейку внутри одного из них
// значило бы, что он читает чужое состояние; держать третьим хранилищем — завести копию, которая
// умеет разъехаться с обоими.

import { capsFor, type Connection } from '../../shared/aiProviders';
import type { AiConnectionsState, AiConnectionTest } from '../../shared/ipc';
import * as ConnectionStore from './ConnectionStore';
import * as KeyStore from './KeyStore';
import { createAnthropicProvider } from './providers/anthropic';
import { createGeminiProvider } from './providers/gemini';
import { createOpenAiCompatibleProvider } from './providers/openaiCompatible';
import { isProviderError, type Provider } from './Provider';

/**
 * Что интерфейс знает о подключениях.
 *
 * ⚠️ Ключей здесь нет: наружу уходит только список тех, у кого ключ на месте. Сам ключ границу IPC
 * не пересекает никогда.
 *
 * ⚠️ Локальные раннеры (Ollama, LM Studio) считаются готовыми БЕЗ ключа — у них его не бывает по
 * устройству, и требовать его значило бы не пускать их вовсе.
 */
export function connectionsState(): AiConnectionsState {
  const connections = ConnectionStore.list();
  return {
    connections,
    routing: ConnectionStore.table() as Record<string, string>,
    ready: connections.filter((c) => capsFor(c).local || KeyStore.hasKey(c.id)).map((c) => c.id),
  };
}

/**
 * Живая проба: доедет ли запрос и примут ли ключ.
 *
 * ⚠️ Проба ОБЯЗАТЕЛЬНА в интерфейсе, а не «на всякий случай». Без неё человек узнаёт об опечатке в
 * ключе или адресе через полминуты в чате, посреди работы, и не понимает, что случилось: ответ
 * просто не приходит.
 *
 * ⚠️ Запрос НАСТОЯЩИЙ, но крошечный: один токен на выходе. Списка моделей у половины совместимых
 * адресов нет, а «проверить ключ, не потратив ни доли цента» на этих API не бывает — зато так
 * проверяется весь путь целиком: адрес, ключ, форма запроса и разбор ответа. Ровно то, что
 * сломается в бою.
 *
 * ⚠️ Ключ приходит ПАРАМЕТРОМ, а не читается из хранилища: проба нужна и до сохранения — человек
 * жмёт «Проверить» на ещё не заведённом подключении.
 */
export async function probeConnection(conn: Connection, key: string | null): Promise<AiConnectionTest> {
  let provider: Provider;
  try {
    provider = buildProvider(conn, key);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  try {
    await provider.generate('ping', { maxTokens: 1 });
    return { ok: true };
  } catch (e) {
    if (isProviderError(e)) return { ok: false, error: explain(e.code, e.message, conn.label) };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

function buildProvider(conn: Connection, key: string | null): Provider {
  const getKey = (): string | null => key;
  switch (conn.kind) {
    case 'anthropic': return createAnthropicProvider({ connection: conn, getKey });
    case 'gemini': return createGeminiProvider({ connection: conn, getKey });
    case 'openai-compatible': return createOpenAiCompatibleProvider({ connection: conn, getKey });
    case 'local': throw new Error('Встроенная модель не требует проверки');
  }
}

/**
 * Код отказа → фраза для человека.
 *
 * ⚠️ Текст провайдера сюда не попадает целиком намеренно: там встречается и простыня на десять
 * строк, и — у некоторых шлюзов — эхо запроса вместе с ключом. Показываем то, что человек может
 * исправить, а подробности остаются в логе.
 */
function explain(code: string, message: string, label: string): string {
  switch (code) {
    case 'no-key': return 'Ключ не принят — проверьте, что скопировали его целиком.';
    case 'unreachable': return `Не удалось достучаться до «${label}». Проверьте адрес и подключение к сети.`;
    case 'rate-limited': return 'Провайдер отвечает «слишком много запросов» — попробуйте через минуту.';
    case 'context': return 'Адрес отвечает, но отвергает даже пробный запрос — проверьте имя модели.';
    default: return message.slice(0, 200);
  }
}
