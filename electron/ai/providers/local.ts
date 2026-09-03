// Встроенная Qwen как ОБЫЧНЫЙ провайдер.
//
// ⚠️ Смысл этого файла — не в коде (он тонкий), а в том, что после него локальная модель перестаёт
// быть особым случаем. Пока «локально» зашито в каждую из тринадцати функций, любое подключение
// извне означает тринадцать развилок `if (облако) … else …`. Как только локальная стала одной из
// реализаций общего контракта, развилка остаётся ровно одна — выбор провайдера по роли.
//
// ⚠️ Загрузка модели приходит СНАРУЖИ, параметром `ensureLoaded`, а не импортом из
// TranslationService. Причина простая и скучная: TranslationService будет импортировать этот
// модуль, и обратный импорт замкнул бы круг. Заодно так виднее, что грев модели — забота хозяина
// очереди, а не провайдера.

import * as Inference from '../../inference/InferenceHost';
import { capsFor, localConnection, LOCAL_CONNECTION_ID, type Connection, type ProviderCaps } from '../../../shared/aiProviders';
import * as UsageStore from '../UsageStore';
import { extractJson, type JsonSchema } from '../../../shared/aiSchema';
import { ProviderError, viaOf, type ChatResult, type GenOpts, type GenResult, type Provider } from '../Provider';

export interface LocalDeps {
  /** Поднять модель, если она ещё не поднята. Возвращает время загрузки (0 — была тёплой). */
  ensureLoaded: () => Promise<number>;
  /** Что сейчас загружено. Идёт в подпись подключения, чтобы человек видел имя модели. */
  modelId: () => string | null;
}

export function createLocalProvider(deps: LocalDeps): Provider {
  const connection = (): Connection => localConnection(deps.modelId() ?? 'не загружена');

  return {
    get connection() { return connection(); },

    caps(): ProviderCaps {
      return capsFor(connection());
    },

    async generate(prompt: string, opts?: GenOpts): Promise<GenResult> {
      await deps.ensureLoaded();
      try {
        const { out, tokens, stopReason } = await Inference.runPrompt(
          prompt, opts?.maxTokens ?? 512, opts?.onChunk, opts?.schema, opts?.abort,
        );
        // ⚠️ Встроенная модель тоже попадает в счёт, хотя денег не стоит: без неё в плитках
        // расхода не с чем сравнить облако, а «сколько на самом деле ушло наружу» — как раз тот
        // вопрос, ради которого счёт и заведён.
        UsageStore.record(LOCAL_CONNECTION_ID, { completionTokens: tokens });
        return { out, tokens, stopReason };
      } catch (e) {
        throw toProviderError(e);
      }
    },

    async generateStructured(schema: JsonSchema, prompt: string, opts?: GenOpts): Promise<unknown> {
      await deps.ensureLoaded();
      try {
        // ⚠️ Схема уходит в процесс инференса как ДАННЫЕ и становится там грамматикой. Переводить
        // её в диалект (toDialect) здесь НЕ надо и нельзя: грамматика понимает наш исходный вид, а
        // диалекты существуют ровно потому, что чужие API его не понимают.
        const { out } = await Inference.runPrompt(
          prompt, opts?.maxTokens ?? 512, opts?.onChunk, schema, opts?.abort,
        );
        const parsed = extractJson(out);
        if (!parsed.ok) {
          // Под грамматикой это недостижимо — значит сломалось что-то ниже, и молчать нельзя.
          throw new ProviderError('schema', `под грамматикой пришёл неразбираемый ответ: ${parsed.error}`);
        }
        return parsed.value;
      } catch (e) {
        throw toProviderError(e);
      }
    },

    async chat(userText: string, history: unknown[], systemPrompt: string, opts?: GenOpts): Promise<ChatResult> {
      await deps.ensureLoaded();
      try {
        const r = await Inference.runChat(
          userText, history, opts?.maxTokens ?? 512, systemPrompt, opts?.onChunk, opts?.abort,
        );
        UsageStore.record(LOCAL_CONNECTION_ID, { completionTokens: r.tokens });
        return { out: r.out, history: r.history, ms: r.ms, tokens: r.tokens, via: viaOf(connection()) };
      } catch (e) {
        throw toProviderError(e);
      }
    },
  };
}

/**
 * Отказ процесса инференса → общий код провайдера.
 *
 * ⚠️ ОШИБКИ С КОДОМ МОДЕЛИ ПРОБРАСЫВАЮТСЯ КАК ЕСТЬ, а не переводятся в код провайдера. Коды
 * NO_MODEL_INSTALLED / MODEL_FILE_MISSING / LOAD_FAILED — это домен ВСЕГО приложения: их читают
 * TranslationService, TabOrganizer и интерфейс, чтобы сказать человеку, что именно делать
 * («модель не установлена» против «файл модели пропал»). Завернув их в общий 'no-key', слой стёр
 * бы различие, которое приложение уже умеет объяснять, — и это было бы изменением поведения там,
 * где заход обязан ничего не менять.
 *
 * ⚠️ Значит, общий код тут получают только те отказы, у которых своего кода НЕ БЫЛО.
 */
function toProviderError(e: unknown): unknown {
  if (e instanceof ProviderError) return e;
  const code = (e as { code?: string } | null)?.code;
  if (code === 'NO_MODEL_INSTALLED' || code === 'MODEL_FILE_MISSING' || code === 'LOAD_FAILED') return e;
  const message = e instanceof Error ? e.message : String(e);
  if (/abort/i.test(message)) return new ProviderError('aborted', message);
  return new ProviderError('provider', message);
}
