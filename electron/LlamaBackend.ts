// Единственная точка получения инстанса node-llama-cpp llama-бэкенда (GPU/CPU-детект backend'а) и
// самого модуля node-llama-cpp. Вынесено из TranslationService.ts, чтобы будущий детект железа
// (HardwareInfo.ts) мог переиспользовать ТОТ ЖЕ llama-инстанс, а не создавать свой — два
// независимых getLlama() на одном GPU-устройстве завели бы два независимых бэкенда, чего надо
// избегать. Поведение TranslationService.ts не меняется — только источник инстанса.

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
    // ESM-only пакет, main собран в CommonJS — обычный import() tsc превратил бы в require(),
    // а у node-llama-cpp top-level await внутри графа модулей (ERR_REQUIRE_ASYNC_MODULE).
    // Официальный обход из доков библиотеки: спрятать import() внутри Function(), чтобы tsc его
    // не транспилировал — тогда это настоящий динамический import. Дословно тот же приём, что был
    // в TranslationService.ts/llamatest.ts — переписывать на обычный import нельзя.
    nlc = await Function('return import("node-llama-cpp")')()
    llama = await nlc.getLlama()
    return llama
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
