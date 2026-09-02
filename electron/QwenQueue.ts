// Очередь обращений к локальной модели — ДВЕ полосы: человек и фон.
//
// Зачем вообще очередь: contextSequence в TranslationService.ts — один-единственный слот KV-cache
// на весь процесс. Конкурентный вызов на одном sequence либо портит генерацию, либо роняет
// исключение внутри node-llama-cpp, поэтому все обращения строго сериализованы.
//
// ⚠️ Зачем ВТОРАЯ полоса. Раньше очередь была одна и честно FIFO — а значит любая фоновая затея
// (итоги дня, «ты это уже читал», разбор полей формы) вставала ПЕРЕД человеком, который в этот
// момент нажал «перевести». На модели, где один прогон занимает секунды, это прямая потеря
// отзывчивости: браузер думает над тем, чего никто не просил. Теперь фоновая задача начинается,
// только когда в пользовательской полосе пусто.
//
// ⚠️ Чего эта очередь НЕ умеет и уметь не может: прервать УЖЕ ИДУЩУЮ генерацию.
// node-llama-cpp такого не даёт (то же ограничение записано в GraphEngine.ts про отмену прогона),
// поэтому «отмена» здесь означает «не начинать»: задача, снятая до старта, не выполнится вовсе,
// а начатую придётся дождаться. Отсюда правило для фоновых фич: дробить работу на короткие
// прогоны, а не запускать один длинный.

export type QueueLane = 'user' | 'background';

/** Ошибка снятой до старта фоновой задачи — отличима от настоящего сбоя генерации. */
export class QueueCancelled extends Error {
  constructor() {
    super('Задача снята из очереди до начала выполнения');
    this.name = 'QueueCancelled';
  }
}

interface Job {
  run: () => Promise<unknown>;
  settle: (result: { ok: true; value: unknown } | { ok: false; error: unknown }) => void;
  signal?: { aborted: boolean };
}

const lanes: Record<QueueLane, Job[]> = { user: [], background: [] };
let running = false;

// Когда человек в последний раз просил модель. ⚠️ Отмечается ТОЛЬКО пользовательская полоса:
// политика выгрузки (shared/modelIdle.ts) считает простоем время без просьб ЧЕЛОВЕКА, а фоновые
// задачи ездят на тёплой модели и своего времени ей не покупают — иначе выгрузка не наступит
// никогда, ведь фон и запускается-то лишь потому, что модель тёплая.
//
// ⚠️ Сама выгрузка тоже идёт через пользовательскую полосу и, значит, тоже ставит отметку. Это
// безвредно: политика смотрит на отметку, только пока модель ЗАГРУЖЕНА, а после выгрузки её
// поднимет заново лишь новая просьба человека — и она поставит свою.
let lastUserRequestAt = Date.now();

function nextJob(): Job | null {
  // Человек всегда первый. Фоновую берём, только когда его полоса пуста.
  return lanes.user.shift() ?? lanes.background.shift() ?? null;
}

function pump(): void {
  if (running) return;
  const job = nextJob();
  if (!job) return;
  // Снятая, пока стояла в очереди, — не выполняется вовсе.
  if (job.signal?.aborted) {
    job.settle({ ok: false, error: new QueueCancelled() });
    pump();
    return;
  }
  running = true;
  // ⚠️ Насос обязан крутиться при ЛЮБОМ исходе. Забытая ветка здесь означает подвешенную очередь
  // для ВСЕХ AI-функций процесса разом (перевод, действия, чат), а не для одного вызывающего —
  // ровно та цена ошибки, что была у прежней реализации на цепочке промисов.
  void (async () => {
    try {
      const value = await job.run();
      job.settle({ ok: true, value });
    } catch (error) {
      job.settle({ ok: false, error });
    } finally {
      running = false;
      pump();
    }
  })();
}

/**
 * Поставить обращение к модели в очередь.
 *
 * @param lane   'user' — человек ждёт результат прямо сейчас; 'background' — можно подождать.
 * @param signal объект с полем aborted (подойдёт и AbortSignal): снимает задачу, пока она ЖДЁТ.
 */
export function enqueueQwen<T>(fn: () => Promise<T>, lane: QueueLane = 'user', signal?: { aborted: boolean }): Promise<T> {
  if (lane === 'user') lastUserRequestAt = Date.now();
  return new Promise<T>((resolve, reject) => {
    lanes[lane].push({
      run: fn as () => Promise<unknown>,
      signal,
      settle: (r) => (r.ok ? resolve(r.value as T) : reject(r.error)),
    });
    pump();
  });
}

/** Занята ли модель прямо сейчас (или уже есть очередь). Для фоновых фич — повод не лезть. */
export function isQwenBusy(): boolean {
  return running || lanes.user.length > 0 || lanes.background.length > 0;
}

/** Когда человек в последний раз просил модель (ms epoch). Для политики выгрузки по простою. */
export function lastQwenUserRequestAt(): number {
  return lastUserRequestAt;
}

/** Сколько задач ждёт в полосе — только для диагностики и тестов. */
export function queueDepth(lane: QueueLane): number {
  return lanes[lane].length;
}

// ── Очередь Qwen-вызовов (диагностика "заход на умный поиск, п.4") ──────────────────────────
// contextSequence из ensureLoaded() — один-единственный слот KV-cache на весь процесс. До этой
// правки runPrompt (перевод/AI-действия) и runChatMessage (чат/быстрый перевод страницы, см.
// AiPanelManager.ts::quick-translate) звали его независимо, без всякой сериализации — конкурентный
// вызов на одном sequence либо портит генерацию, либо роняет исключение внутри node-llama-cpp.
// Тот же приём, что уже проверен на EmbeddingService.ts::embed (queueTail: Promise<unknown>
// chaining) — там нашли ровно этот класс гонки на общем worker'е. Хвост ОДИН на весь модуль и
// оборачивает ОБЕ точки входа (runPrompt И runChatMessage), а не только новую фичу поиска —
// иначе следующий добавленный потребитель Qwen снова пробил бы ту же гонку.
// ⚠️ Сама очередь переехала в electron/QwenQueue.ts и стала ДВУХПОЛОСНОЙ: фоновая задача
// начинается только тогда, когда человеку ничего не нужно. Раньше полоса была одна и честно
// FIFO — то есть любая фоновая затея вставала перед человеком, нажавшим «перевести». Вынесена
// отдельным модулем не ради красоты: без импортов node-llama-cpp её можно прогнать прямыми
// вызовами и доказать порядок, а не надеяться на него.
export function withQwenQueue<T>(fn: () => Promise<T>): Promise<T> {
  return enqueueQwen(fn, 'user')
}

/**
 * То же самое, но полосой ниже: для того, чего человек не заказывал (итоги дня, разбор полей,
 * «уже читал»). Пока в пользовательской полосе есть работа, эта задача не начнётся.
 * `signal` снимает задачу, ПОКА ОНА ЖДЁТ. Прервать УЖЕ ИДУЩУЮ генерацию — это `abort` у
 * runTabOrganizePrompt: он доезжает до llama.cpp через отдельное сообщение воркеру.
 */
export function withQwenQueueBackground<T>(fn: () => Promise<T>, signal?: { aborted: boolean }): Promise<T> {
  return enqueueQwen(fn, 'background', signal)
}
