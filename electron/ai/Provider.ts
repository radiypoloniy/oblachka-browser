// Контракт «что умеет модель», один на локальную Qwen и на любое облако.
//
// ⚠️ Метод здесь ТРИ, и это предел намеренно. Слой заводится не ради обобщения, а ради одной
// задачи: перенести тринадцать существующих AI-функций на любого провайдера, не переписывая каждую.
// Всё, что они на самом деле просят у модели, — это «дай текст», «дай объект по схеме» и «продолжи
// беседу». Четвёртый метод появится тогда, когда появится четвёртая нужда, а не заранее.
//
// ⚠️ Загрузку модели контракт НЕ описывает и описывать не должен. Она есть только у локальной
// (тридцать секунд и гигабайты VRAM), у облака её нет вовсе, и «унифицировать» их значило бы
// придумать состояние, которого у половины реализаций не бывает. Локальный провайдер греет модель
// сам, внутри своих методов.

import { capsFor, type Connection, type ProviderCaps } from '../../shared/aiProviders';
import type { JsonSchema } from '../../shared/aiSchema';

export interface GenOpts {
  maxTokens?: number;
  /** Токены по мере генерации — там, где человек СМОТРИТ на сборку и обязан видеть, что она идёт. */
  onChunk?: (text: string) => void;
  /** Настоящее прерывание уже идущей генерации. */
  abort?: AbortSignal;
  /** Задача, которой человек не заказывал: ждёт, пока не опустеет пользовательская полоса. */
  background?: boolean;
  /**
   * Ограничить ответ схемой, но вернуть его СЫРЫМ ТЕКСТОМ.
   *
   * ⚠️ Зачем это отдельно от generateStructured. Часть вызывающих разбирает ответ сама и живёт с
   * его текстом: считает символы для индикатора, чинит края, отличает естественный конец от
   * обрыва по лимиту токенов. Отдать им готовый объект значит отнять всё это. Поэтому ограничение
   * генерации и разбор ответа — разные вещи: здесь первое, в structured.ts второе.
   */
  schema?: JsonSchema;
}

export interface GenResult {
  out: string;
  tokens: number;
  stopReason: string;
}

/**
 * Кто ответил.
 *
 * ⚠️ Подпись собирает САМ ПРОВАЙДЕР, а не вызывающий. Он единственный знает наверняка, кто он:
 * вызывающий видит лишь роль, а между ролью и провайдером стоит маршрут с откатами (нет ключа,
 * сервер не ответил). Собрав подпись снаружи, мы бы написали «GPT-5» под ответом, который на деле
 * дала локальная модель, — то есть соврали ровно в том месте, ради которого метку и заводили.
 *
 * ⚠️ `local` — это про АДРЕС, а не про тип: Ollama на localhost такое же «здесь», как встроенная
 * Qwen, и текст к ней машину не покидает.
 */
export interface ChatVia { label: string; local: boolean }

export interface ChatResult {
  out: string;
  history: unknown[];
  ms: number;
  tokens: number;
  via: ChatVia;
}

export interface Provider {
  readonly connection: Connection;
  caps(): ProviderCaps;

  /** Свободный текст. */
  generate(prompt: string, opts?: GenOpts): Promise<GenResult>;

  /**
   * Объект по схеме.
   *
   * ⚠️ Возвращает СЫРОЕ разобранное значение, а не проверенное. Проверка границ и ремонтный повтор
   * живут этажом выше (structured.ts) — общие для всех провайдеров, потому что теряют границы все,
   * просто по-разному. Дублировать эту работу в каждом адаптере значило бы получить четыре слегка
   * разных представления о том, что такое валидный ответ.
   */
  generateStructured(schema: JsonSchema, prompt: string, opts?: GenOpts): Promise<unknown>;

  /**
   * Продолжение беседы. `history` — непрозрачное для вызывающего значение: у локальной это формат
   * LlamaChatSession, у облака — массив сообщений. Кто выдал, тот и разбирает.
   */
  chat(userText: string, history: unknown[], systemPrompt: string, opts?: GenOpts): Promise<ChatResult>;
}

/** Коды отказа, различимые для интерфейса. Текст провайдера кладём в message. */
export type ProviderErrorCode =
  | 'no-key'          // ключа нет или он не принят
  | 'unreachable'     // endpoint не ответил
  | 'rate-limited'    // упёрлись в лимит провайдера
  | 'context'         // запрос не влез в контекст модели
  | 'schema'          // ответ не сошёлся со схемой даже после ремонта
  | 'aborted'         // прервал человек
  | 'provider';       // всё прочее, что сказал провайдер

export class ProviderError extends Error {
  constructor(readonly code: ProviderErrorCode, message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

export function isProviderError(e: unknown): e is ProviderError {
  return e instanceof ProviderError;
}

/** Подпись по подключению. Один рецепт на всех: иначе «здесь» считалось бы по-разному у каждого. */
export function viaOf(conn: Connection): ChatVia {
  return { label: conn.label, local: capsFor(conn).local };
}
