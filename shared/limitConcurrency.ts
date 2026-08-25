// Ограничитель одновременных задач — «не больше N разом, остальные ждут очереди».
//
// ⚠️ Заведён по разбору задержки библиотеки (25.08.2026). Список истории просит значки сайтов, и
// при холодном кэше каждый незнакомый домен это поход в сеть СЕССИЕЙ ПРОФИЛЯ, то есть через VPN,
// если он включён, и до трёх запросов на домен (/favicon.ico → страница → apple-touch-icon).
// Пятнадцать видимых строк давали залп из полусотни запросов в один момент: они конкурируют за
// туннель между собой и с самой страницей, которую человек в это время открывает.
//
// ⚠️ Очередь, а не «отбросить лишние»: значок, который не приехал, оставляет букву-заглушку
// навсегда — задача обязана выполниться, вопрос только когда.
//
// ⚠️ Значимых импортов быть не должно: проверка (scripts/limit-concurrency-check.mjs) гоняется
// голым node — то же правило, что у shared/sessionTree.ts.

export interface Limiter {
  /** Поставить задачу в очередь. Промис разрешается результатом задачи. */
  run<T>(task: () => Promise<T>): Promise<T>;
  /** Сколько задач выполняется прямо сейчас — для проверок и диагностики. */
  active(): number;
  /** Сколько ждёт очереди. */
  pending(): number;
}

export function createLimiter(max: number): Limiter {
  // Меньше единицы бессмысленно и означало бы намертво вставшую очередь.
  const limit = Math.max(1, Math.floor(max));
  let running = 0;
  const queue: (() => void)[] = [];

  const next = (): void => {
    if (running >= limit) return;
    const start = queue.shift();
    if (start) start();
  };

  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        const start = (): void => {
          running++;
          // ⚠️ Задача оборачивается в Promise.resolve().then, а не вызывается голой: синхронное
          // исключение внутри task() иначе прошло бы мимо catch и навсегда заняло бы слот —
          // очередь встала бы целиком из-за одной кривой задачи.
          //
          // ⚠️ Слот освобождается ДО resolve/reject, а не в finally. Разница не теоретическая:
          // finally стоит в цепочке ПОСЛЕ обработчика, то есть тот, кто дождался результата,
          // видел бы счётчик ещё занятым и очередь трогалась бы на микротаску позже. Поймано
          // проверкой (scripts/limit-concurrency-check.mjs, «слоты свободны»).
          const settle = (fn: () => void): void => {
            running--;
            next();
            fn();
          };
          void Promise.resolve()
            .then(task)
            .then(
              (value) => settle(() => resolve(value)),
              (err: unknown) => settle(() => reject(err instanceof Error ? err : new Error(String(err)))),
            );
        };
        if (running < limit) start();
        else queue.push(start);
      });
    },
    active: () => running,
    pending: () => queue.length,
  };
}
