// Main-процесс-сторона Bergamot: спавнит/держит BergamotWorkerEntry.ts как отдельный
// node:worker_threads.Worker и говорит с ним через простое postMessage-RPC. НЕ реализует
// ITranslationEngine — это Этап 2 (изолированный сервис + CLI-смоук, см. scripts/bergamot-smoke.mjs),
// обёртка в ITranslationEngine (BergamotTranslationEngine) и регистрация в
// TranslationEngineRegistry — Этап 3.
//
// userDataPath передаётся явно в конструктор (не читается из electron.app здесь) — так этот же
// класс можно поднять и из standalone-скрипта (scripts/bergamot-smoke.mjs), не завязываясь на то,
// что electron.app доступен и инициализирован в вызывающем контексте.
import { Worker } from 'node:worker_threads'
import path from 'node:path'

export interface BergamotItem {
  id: number
  text: string
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
}

export class BergamotService {
  #worker: Worker | null = null
  #ready = false
  #broken = false
  #pending = new Map<number, Pending>()
  #nextReqId = 0
  readonly #userDataPath: string
  readonly #workerEntryPath: string

  // workerEntryPath — по умолчанию рядом с этим же скомпилированным файлом (dist-electron/electron/
  // BergamotWorkerEntry.js), переопределяемо для standalone-запуска (bergamot-smoke.mjs собирает
  // main-процесс тем же tsc, но зовёт этот класс из другого места на диске).
  constructor(userDataPath: string, workerEntryPath?: string) {
    this.#userDataPath = userDataPath
    this.#workerEntryPath = workerEntryPath ?? path.join(__dirname, 'BergamotWorkerEntry.js')
  }

  isReady(): boolean {
    return this.#ready && !this.#broken
  }

  isBroken(): boolean {
    return this.#broken
  }

  // Спавнит воркер (если ещё не спавнен) и ждёт первого 'ready' от него. Idempotent — повторный
  // вызов, пока воркер уже поднимается/поднят, просто ждёт тот же результат.
  async warmup(): Promise<void> {
    if (this.#broken) throw new Error('[bergamot] движок помечен недоступным (см. лог краша воркера)')
    if (this.#ready) return
    if (!this.#worker) this.#spawn()

    await new Promise<void>((resolve, reject) => {
      const onReady = () => { cleanup(); resolve() }
      const onFail = (e: unknown) => { cleanup(); reject(e instanceof Error ? e : new Error(String(e))) }
      const cleanup = () => {
        this.#worker?.off('message', onMessage)
        this.#worker?.off('error', onFail)
      }
      const onMessage = (msg: { type: string; message?: string }) => {
        if (msg.type === 'ready') onReady()
        else if (msg.type === 'init-error') onFail(new Error(msg.message))
      }
      if (this.#ready) { resolve(); return }
      this.#worker!.on('message', onMessage)
      this.#worker!.on('error', onFail)
    })
  }

  #spawn(): void {
    console.log(`[bergamot] запускаю воркер: ${this.#workerEntryPath}`)
    const worker = new Worker(this.#workerEntryPath, { workerData: { userDataPath: this.#userDataPath } })
    this.#worker = worker

    worker.on('message', (msg: { type: string; reqId?: number; results?: unknown; message?: string }) => {
      if (msg.type === 'ready') {
        this.#ready = true
        return
      }
      if (msg.type === 'init-error') {
        console.error('[bergamot] инициализация воркера упала:', msg.message)
        this.#markBroken(new Error(msg.message))
        return
      }
      if (msg.reqId === undefined) return
      const pending = this.#pending.get(msg.reqId)
      if (!pending) return
      this.#pending.delete(msg.reqId)
      if (msg.type === 'error') pending.reject(new Error(msg.message))
      else pending.resolve(msg)
    })

    // Краш воркера (необработанное исключение внутри WASM/JS) — main-процесс, вкладка, Qwen не
    // затронуты: этот 'error' долетает ТОЛЬКО сюда, дальше просто помечаем движок недоступным.
    worker.on('error', (err) => {
      console.error('[bergamot] воркер упал:', err)
      this.#markBroken(err)
    })

    worker.on('exit', (code) => {
      if (code !== 0 && !this.#broken) {
        console.error(`[bergamot] воркер неожиданно завершился (код ${code})`)
        this.#markBroken(new Error(`worker exited with code ${code}`))
      }
      this.#worker = null
      this.#ready = false
    })
  }

  #markBroken(err: Error): void {
    this.#broken = true
    this.#ready = false
    for (const [, p] of this.#pending) p.reject(err)
    this.#pending.clear()
  }

  // text у items — уже то, что решил вызывающий (см. план: на Этапе 2 это может быть сырой HTML,
  // конвертация ⟪N⟫-маркеров DOM-слоя в HTML и обратно — забота BergamotTranslationEngine, Этап 3,
  // этот сервис про неё ничего не знает).
  async translateBatch(items: BergamotItem[], from: string, to: string): Promise<BergamotItem[]> {
    if (this.#broken) throw new Error('[bergamot] движок недоступен')
    if (!this.#ready) await this.warmup()

    const reqId = this.#nextReqId++
    return new Promise<BergamotItem[]>((resolve, reject) => {
      this.#pending.set(reqId, {
        resolve: (msg) => resolve((msg as { results: BergamotItem[] }).results),
        reject,
      })
      this.#worker!.postMessage({ type: 'translate-batch', reqId, from, to, items })
    })
  }

  async dispose(): Promise<void> {
    if (!this.#worker) return
    this.#worker.postMessage({ type: 'dispose' })
    await new Promise<void>((resolve) => {
      this.#worker!.once('exit', () => resolve())
      setTimeout(resolve, 2000) // не ждём вечно, если воркер не ответил на dispose
    })
    this.#worker = null
    this.#ready = false
  }
}
