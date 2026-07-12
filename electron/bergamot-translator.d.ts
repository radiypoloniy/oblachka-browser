// @browsermt/bergamot-translator не публикует типы — минимальная декларация под наши нужды
// (BergamotWorkerEntry.ts кастует конкретные сигнатуры сам, здесь только чтобы `import type`
// резолвился и tsc не требовал @types-пакет, которого не существует).
declare module '@browsermt/bergamot-translator' {
  export class TranslatorBacking {
    constructor(options?: unknown)
  }
  export class BatchTranslator {
    constructor(options?: unknown, backing?: unknown)
  }
  export class SupersededError extends Error {}
  export class CancelledError extends Error {}
}
