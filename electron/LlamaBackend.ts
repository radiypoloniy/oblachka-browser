// Единственная точка получения инстанса node-llama-cpp llama-бэкенда (GPU/CPU-детект backend'а) и
// самого модуля node-llama-cpp. Вынесено из TranslationService.ts, чтобы будущий детект железа
// (HardwareInfo.ts) мог переиспользовать ТОТ ЖЕ llama-инстанс, а не создавать свой — два
// независимых getLlama() на одном GPU-устройстве завели бы два независимых бэкенда, чего надо
// избегать. Поведение TranslationService.ts не меняется — только источник инстанса.

// ⚠️ Smart App Control (Windows 11) блокирует загрузку неподписанных DLL при ПЕРВОЙ встрече с
// конкретным файлом: пока служба репутации Microsoft отвечает, LoadLibrary отдаёт 4551
// («An Application Control policy has blocked this file»), а зависимые библиотеки следом — 126
// («не найден указанный модуль», потому что не загрузилась ggml-base.dll). Получив вердикт
// «известен как безопасный», система пускает файл и дальше молчит.
// Замерено на живой машине: тот же ggml-base.dll, только что отказавший с 4551, через несколько
// минут загрузился без единой правки; в журнале CodeIntegrity блокировки идут вспышками в дни,
// когда на диске появлялись файлы с новыми хэшами (npm install, сборка установщика), а не
// сплошным потоком. То есть отказ ВРЕМЕННЫЙ, и единственная верная реакция на него — повторить.
// Кого это касается на самом деле: не разработчика (у него бинарники репутацию уже набрали), а
// человека, запускающего браузер на чистой машине впервые. Настоящее лекарство — подпись кода,
// пункт 0 дорожной карты; здесь мы лишь переживаем паузу, а не маскируем её.
const INIT_ATTEMPTS = 3
const INIT_RETRY_MS = 1200

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// Опознание причины — ДВУХ уровней, и это не перестраховка.
//
// Уверенно (`blocked`) — Windows прямо назвала политику: код 4551 или её текст. Так выглядит
// отказ, когда блокируют сам загружаемый файл.
//
// Предположительно (`dlopen`) — отказ загрузки нативного модуля без внятной причины. Так
// выглядит РЕАЛЬНЫЙ случай: блокируют не сам `llama-addon.node`, а его зависимость
// (`ggml-base.dll`), и наверх Windows отдаёт уже 126 «не найден указанный модуль» — про политику
// в сообщении не будет ни слова. Ровно это и наблюдалось при замере. Отличить такой отказ от
// честно недокачанных файлов по одному тексту нельзя, поэтому и сообщение называет обе причины,
// а не выбирает одну наугад: соврать про причину хуже, чем назвать две.
//
// Текст проверяем на двух языках, а код `ERR_DLOPEN_FAILED` (его ставит сам Node) — главный
// признак: он от языка системы не зависит, а Windows свои сообщения переводит.
type LoadFailure = 'blocked' | 'dlopen' | 'other'

function classifyLoadFailure(e: unknown): LoadFailure {
  const s = String((e as { message?: unknown })?.message ?? e)
  if (/\b4551\b/.test(s)
    || /application control policy/i.test(s)
    || /политик[аои][^.]{0,40}управления приложениями/i.test(s)) return 'blocked'

  if ((e as { code?: unknown })?.code === 'ERR_DLOPEN_FAILED'
    || /specified module could not be found/i.test(s)
    || /не найден указанный модуль/i.test(s)
    || /dynamic link library|библиотек[аи] dll/i.test(s)) return 'dlopen'

  return 'other'
}

const BLOCKED_MESSAGE =
  'Windows заблокировал запуск локального ИИ: Smart App Control не пропускает библиотеки без '
  + 'подписи издателя. Обычно это разовая задержка при первом запуске — попробуйте ещё раз через '
  + 'минуту. Если повторяется, Smart App Control отключается в «Безопасность Windows → Управление '
  + 'приложениями и браузером» (учтите: включить его обратно можно только переустановкой Windows).'

const DLOPEN_MESSAGE =
  'Не удалось загрузить библиотеки локального ИИ. Две обычные причины: их придержал Smart App '
  + 'Control (Windows 11 не пропускает неподписанные библиотеки при первой встрече — тогда через '
  + 'минуту всё заработает само) либо файлы повреждены или не докачались — это чинится '
  + 'переустановкой браузера.'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let llama: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nlc: any = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let initPromise: Promise<any> | null = null

// Ленивая инициализация — дедупликация конкурентных вызовов через initPromise, тот же приём, что
// loadPromise в TranslationService.ts::ensureLoaded(): проверка и присвоение initPromise
// синхронны, без await между ними, поэтому конкурентные вызовы, попавшие в это окно, разделяют
// одну попытку, а не порождают две.
export async function getLlamaBackend(): Promise<any> {
  if (initPromise) return initPromise
  const attempt = (async () => {
    // Повторяем ЛЮБОЙ отказ инициализации, а не только опознанный как блокировка ОС. Причины две:
    // инициализация дешёвая (детект GPU, модель ещё не грузится — см. комментарий в catch ниже),
    // и опознать блокировку по тексту надёжно нельзя — Windows отдаёт его на языке системы,
    // а обёртки node-llama-cpp текст ещё и пересобирают. Три попытки на ~2.4 с — цена, которую
    // платит только по-настоящему сломанный запуск, и то один раз за процесс.
    let last: unknown
    for (let i = 0; i < INIT_ATTEMPTS; i++) {
      if (i > 0) await sleep(INIT_RETRY_MS)
      try {
        // ESM-only пакет, main собран в CommonJS — обычный import() tsc превратил бы в require(),
        // а у node-llama-cpp top-level await внутри графа модулей (ERR_REQUIRE_ASYNC_MODULE).
        // Официальный обход из доков библиотеки: спрятать import() внутри Function(), чтобы tsc его
        // не транспилировал — тогда это настоящий динамический import. Дословно тот же приём, что был
        // в TranslationService.ts/llamatest.ts — переписывать на обычный import нельзя.
        nlc = await Function('return import("node-llama-cpp")')()
        llama = await nlc.getLlama()
        if (i > 0) console.log(`[gen] llama backend поднялся с попытки ${i + 1} (первая была отбита)`)
        return llama
      } catch (e) {
        last = e
      }
    }
    const kind = classifyLoadFailure(last)
    // Сырую ошибку не проглатываем: человеку идёт понятный текст, а в логе остаётся то, по чему
    // потом разбираться.
    if (kind !== 'other') console.error('[gen] бэкенд не поднялся за', INIT_ATTEMPTS, 'попытки:', last)
    if (kind === 'blocked') throw new Error(BLOCKED_MESSAGE)
    if (kind === 'dlopen') throw new Error(DLOPEN_MESSAGE)
    throw last
  })()
  initPromise = attempt
  try {
    return await attempt
  } catch (e) {
    // Не загрузка модели — только инициализация backend'а (GPU-детект), повтор дешёвый. В отличие
    // от loadPromise в TranslationService.ts сбрасываем безусловно и сразу, без разбора кодов
    // ошибок — здесь нет дорогого/дешёвого различия между причинами отказа.
    initPromise = null
    throw e
  }
}

// Тот же закэшированный результат динамического импорта node-llama-cpp, что использует
// getLlamaBackend() изнутри — TranslationService.ts нужен не только getLlama() (LlamaChatSession,
// QwenChatWrapper), второго независимого import() node-llama-cpp быть не должно.
export async function getNlc(): Promise<any> {
  await getLlamaBackend()
  return nlc
}

// Синхронный доступ к уже созданному инстансу, без побочной инициализации. null, если
// getLlamaBackend()/getNlc() ещё ни разу не отработали успешно.
export function getLlamaBackendIfInitialized(): any | null {
  return llama
}
