
// ── Полностраничный перевод (см. electron/PageTranslateManager.ts) ───────────
// 'idle' — не переведена (или отключена: hub/history/settings, см. Toolbar.tsx). 'translating' —
// идёт батчевый прогон через Qwen. 'translated' — все батчи применены, повторный клик кнопки
// откатывает на оригинал (см. PAGE_TRANSLATE_TOGGLE) обратно в 'idle'.
export type PageTranslateState = 'idle' | 'translating' | 'translated';

// Прогресс во время 'translating' — batchIndex/batchCount (батч из скольких известен сразу после
// обхода DOM, см. PageTranslateManager.ts::runTranslation) и charsStreamed — суммарные символы,
// сгенерированные моделью с начала перевода СТРАНИЦЫ (растёт непрерывно по мере токен-стриминга
// внутри каждого батча, не только на границах батчей) — единственная задача этого поля: дать
// тулбару "живой" сигнал вместо голого спиннера на все 7-10+ секунд одного батча. null — сейчас
// не 'translating' (см. pushProgress в PageTranslateManager.ts — гасится вместе с состоянием).
export interface PageTranslateProgress {
  batchIndex: number;
  batchCount: number;
  charsStreamed: number;
}

// Движки полностраничного перевода (см. electron/ITranslationEngine.ts::ITranslationEngine) — общий
// тип, нужен и main (electron/TranslationEngineRegistry.ts, electron/SettingsManager.ts), и renderer
// (Settings.tsx), поэтому живёт здесь, а не в electron/-only файле.
export type TranslationEngineId = 'qwen' | 'bergamot';

// Статус Bergamot-движка (см. electron/BergamotService.ts) — только push, не завязан на то, какой
// движок сейчас АКТИВЕН в настройках: греется в фоне независимо (см. main.ts), чтобы переключатель
// в Settings.tsx мог показать актуальный статус ДО того, как пользователь вообще попробует его
// выбрать. 'unavailable' — воркер не поднялся или файлов моделей нет (см. живой лог main-процесса),
// UI показывает «модель перевода не загружена», TranslationEngineRegistry тихо остаётся на Qwen.
export type BergamotStatus = 'loading' | 'ready' | 'unavailable';

// ── AI-чат на Hub ───────────────────────────────────────────────────────────
// 'graph' — граф-воркспейс (src/components/GraphCanvas.tsx). Пока живёт рядом с блокнотом:
// по плану граф его поглотит (Источники и Студия станут типами узлов), но миграция
// сохранённых источников — отдельный, более рискованный заход.
export type HubMode = 'tiles' | 'ai' | 'graph';

// Режим загрузки GGUF-модели (SettingsManager.ts): 'startup' — прогрев сразу после показа окна
// (см. main.ts, warmupTranslation), модель занимает ~6 ГБ RAM постоянно, но первый AI-ответ
// быстрый. 'on-demand' (дефолт) — прогрев откладывается до явного намерения пользователя
// поработать с AI (открытие AI-панели/хаба в режиме AI, см. main.ts), экономит память, но первый
// ответ ждёт полную загрузку модели (~30с). Не путать с Bergamot — тот всегда греется безусловно
// (свой лёгкий движок, к GGUF отношения не имеет).
export type ModelLoadMode = 'startup' | 'on-demand';

export interface HubChatMessage {
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
}

export interface HubChatSessionMeta {
  id: number;
  title: string;      // начало первого сообщения пользователя
  updatedAt: number;
}

export type HubChatOutcome =
  | { ok: true; out: string }
  | { ok: false; error: string };

// ── Разрешения сайтов ────────────────────────────────────────────────────────

// Ключи разрешений (используются и как ключи в БД, и в UI).
// «camera+microphone» — виртуальный ключ для одновременного запроса обоих.
export type PermKey =
  | 'camera' | 'microphone' | 'camera+microphone'
  | 'geolocation' | 'notifications' | 'fullscreen'
  | 'clipboard-read' | 'clipboard-sanitized-write'
  // ⚠️ Единственный вид, который просит НЕ Chromium, а мы сами (см. PermissionManager.askOwn):
  // открытие ссылки в чужом приложении — tg://, sbolpay://, itms-apps://. Живёт в общей таблице
  // не ради экономии, а ради отзыва: разрешение, которое человек не может найти и отменить,
  // выдавать нельзя, а раздел «Разрешения» — ровно то место, где он его ищет.
  | 'external-app';

export interface PermissionRequest {
  requestId: string;
  origin: string;    // e.g. "https://meet.google.com"
  permission: PermKey;
}

// Сохранённое решение по сайту — то, что показывает и правит раздел настроек «Разрешения».
// ⚠️ Отсутствие записи и запрет — РАЗНЫЕ вещи: нет записи означает «спросим», а не «нельзя».
// Поэтому «Забыть» и «Запретить» — две отдельные операции, а не одна.
export interface PermissionRecord {
  origin: string;
  permission: PermKey;
  decision: 'granted' | 'denied';
  updatedAt: number;
}

// ── AI-действия над выделением (перевод / пересказ / объяснение / выжимка) ───
// Общая труба: выделение → координаты → Qwen (промпт зависит от action) → поповер → стриминг.
// Добавить новое действие = добавить пункт меню (TabManager.ts) + промпт (TranslationService.ts) —
// без нового поповер-кода, см. AiActionOutcome ниже (один контракт результата на все действия).

// ⚠️ Последние три — действия НАД СВОИМ ТЕКСТОМ в поле ввода, а не над чужой страницей. Разница
// не косметическая: их результат человек вставляет обратно в форму (см. canReplace в поповере),
// поэтому модель обязана вернуть ТОЛЬКО текст, без «Вот исправленный вариант:» — маленькая модель
// это правило нарушает, и ответ дочищается кодом (тот же приём, что в TabRenamer.ts).
// Почему это уместно локальной модели: правка своего черновика — короткий вход, короткий выход,
// один шаг; и главное, недописанное письмо не уезжает в чужое облако.
export type AiAction = 'translate' | 'summarize' | 'simplify' | 'explain' | 'fix' | 'shorten' | 'polite';

// Любая пара языков после автоопределения ('fr->ru', 'ru->en', ...), не только ru/en.
// Заполняется только для action:'translate' — остальные действия отвечают на языке оригинала,
// у них нет пары src->tgt.
export type TranslateDirection = `${string}->${string}`;

// Дискриминируемый код причины отказа генерации, когда она известна (реестр GGUF-моделей,
// см. electron/ModelRegistry.ts) — рядом с человекочитаемым error, а не вместо него. Опционально:
// прочие ошибки (не про модель — франк, парсинг и т.п.) errorCode не выставляют, как и раньше.
export type ModelErrorCode = 'NO_MODEL_INSTALLED' | 'MODEL_FILE_MISSING' | 'LOAD_FAILED';

// Снапшот железа (см. electron/HardwareInfo.ts) — задел под подбор GGUF-модели по доступной VRAM.
// vram*/gpuBackend — null, если детект упал (нет подходящего GPU/драйвера) или ещё не запускался;
// ram*/cpuCores — всегда заполнены (через os, от llama/GPU не зависят). error — причина отказа
// детекта VRAM/GPU, если она есть; null означает "vram*/gpuBackend успешно определены".
export interface HardwareSnapshot {
  vramTotalBytes: number | null;
  vramFreeBytes: number | null;
  // 'vulkan' | 'cuda' | ... — бэкенд поднялся; 'false' — llama.cpp НЕ нашёл ни одного GPU и
  // считает на процессоре; null — детект не выполнился (см. error).
  // ⚠️ Различать 'false' и маленькую карту обязательно: интерфейс не имеет права говорить
  // «устройство не потянет», когда он видеокарту просто не увидел. Ровно так выглядела жалоба
  // владельца ноутбука с хорошей картой — и ровно так же выглядел баг упакованной сборки
  // (разбор — scripts/patch-llama-gpu-test.mjs).
  gpuBackend: string | null;
  // Что llama.cpp перечислил как GPU-устройства. Пусто, если бэкенда GPU нет. Нужны, чтобы на
  // гибридном ноутбуке было видно, ВЗЯЛИ ЛИ ТУ карту, а не только сколько у неё памяти.
  gpuDeviceNames: string[];
  ramTotalBytes: number;
  ramFreeBytes: number;
  cpuCores: number;
  detectedAt: number;
  error: string | null;
}

// Загрузчик GGUF-моделей (см. electron/ModelDownloader.ts) — задел, потребителей в UI пока нет.
// Одновременно допускается только одна загрузка на процесс. modelId — slug (та же slugify(), что
// у ModelRegistry.ts) целевого файла, известен с самого начала (до появления файла на диске).
// ── Бэнги омнибокса (electron/BangStore.ts) ───────────────────────────────────

// Три источника разом, чтобы UI мог показать их раздельно: встроенные удалить нельзя,
// пользовательские правятся, импортированные существуют только числом (список на ~13 000
// записей в renderer не отдаём — незачем гонять его через IPC).
export interface BangsSnapshot {
  user: BangDefWire[];
  builtin: BangDefWire[];
  importedCount: number;
}

// Тот же BangDef, что в shared/bangs.ts, — продублирован здесь как «форма на проводе», чтобы
// contract-файл не зависел от модуля с данными (в остальном контракте так же).
export interface BangDefWire {
  key: string;
  name: string;
  template: string;
  home?: string;
}

export interface ImportBangsResult {
  ok: boolean;
  imported: number;
  error: string | null;
}

// Заготовка бэнга, распознанная по адресу открытой вкладки (см. deriveBangFromUrl).
// tabTitle/tabUrl — чтобы пользователь понял, из какой именно вкладки взята заготовка.
export interface DerivedBangCandidate {
  key: string;
  name: string;
  template: string;
  param: string;
  tabTitle: string;
  tabUrl: string;
}

// ── Автообновление (electron/UpdateManager.ts) ────────────────────────────────

// 'disabled' — не ошибка, а штатное состояние: electron-updater работает только с установленным
// приложением, в dev-режиме (npm run dev / npm start) он физически неприменим. UI в этом случае
// честно пишет «доступно только в установленной версии», а не притворяется, что всё в порядке.
export type UpdateStatusKind =
  | 'disabled'
  | 'idle'
  | 'checking'
  | 'not-available'
  | 'available'      // нашли версию новее — ждём решения пользователя, сами НЕ качаем
  | 'downloading'
  | 'downloaded'     // скачано, ждём согласия перезапуститься
  | 'error';

export interface UpdateStatus {
  kind: UpdateStatusKind;
  currentVersion: string;
  // Версия, доступная к установке. Не null только при available/downloading/downloaded.
  newVersion: string | null;
  // Прогресс загрузки, 0..100. Осмыслен только при downloading.
  percent: number;
  // Причина отказа для показа пользователю. Не null только при error.
  error: string | null;
  // Момент последней УСПЕШНОЙ проверки (Date.now()), чтобы UI мог написать «проверено тогда-то».
  // null — успешных проверок в этой установке ещё не было.
  lastCheckedAt: number | null;
}

export interface DownloadProgress {
  modelId: string | null;
  receivedBytes: number;
  totalBytes: number | null;
  running: boolean;
  cancelled: boolean;
  error: string | null;
}

// Параметры одной загрузки — курируемый каталог моделей будет отдельным заходом (6c), сейчас
// приходят снаружи как есть.
export interface ModelDownloadSpec {
  url: string;
  fileName: string;
  label: string;
  // Эталонный SHA256 (см. electron/ModelDownloader.ts) — сверяется потоково во время скачивания,
  // без отдельного прохода по файлу после. null — модель без снятого хэша (см. CatalogModel),
  // тогда проверка пропускается с предупреждением в лог, а не блокирует загрузку.
  expectedSha256?: string | null;
}

// Курируемый каталог моделей (см. electron/ModelCatalog.ts::CatalogModel/ModelFit) — структурно
// идентичная копия здесь, а не импорт: shared/ipc.ts бандлится и в renderer (Vite), а
// ModelCatalog.ts тянет ModelRegistry.ts → 'electron' (app.getPath), которые в renderer-бандл
// тащить нельзя. Тот же приём, что Skill/SkillsStore.ts ниже.
export interface CatalogModel {
  id: string;
  fileName: string;
  label: string;
  quant: string;
  url: string;
  sizeBytes: number;
  totalLayers: number;
  vramFullOffloadBytes: number;
  contextVramPerToken: number;
  contextVramBaseBytes: number;
  // Разреженная нумерация (шаг 10: 10/20/30/40/50/...) — НАМЕРЕННО, не 1/2/3/4/5: вставка новой
  // ступени между существующими (напр. Gemma 4 12B между 9B и 27B) получает своё число из
  // промежутка (45) и не требует перенумеровывать соседей. number, а не union конкретных значений —
  // union пришлось бы расширять на каждую новую ступень (см. историю этого поля).
  qualityTier: number;
  // lfs.oid с HF API (tree/main) — сверяется потоково при скачивании (см. ModelDownloader.ts).
  // null допустим (модель без снятого хэша) — тогда проверка при загрузке пропускается,
  // не блокирует её.
  expectedSha256: string | null;
}

export type FitCategory = 'light' | 'recommended' | 'heavy' | 'not-recommended';

export interface ModelFit {
  fitQuality: FitCategory;
  // maxContextTokens калибрована ТОЛЬКО для случая, когда модель целиком помещается в GPU —
  // если fitsFullyOnGpu===false, число недостоверно (формула не учитывает частичный оффлоад на
  // CPU). contextEstimateReliable дублирует fitsFullyOnGpu как явный сигнал для UI: не показывать
  // число контекста, когда false, а не полагаться на то, что потребитель сам вспомнит про эту связь.
  maxContextTokens: number;
  fitsFullyOnGpu: boolean;
  contextEstimateReliable: boolean;
  note: string | null;
}

// Роль модели ОТНОСИТЕЛЬНО ВСЕГО КАТАЛОГА на данном железе (см. electron/ModelCatalog.ts::assignRoles)
// — в отличие от ModelFit.fitQuality (объективная характеристика ОДНОЙ модели самой по себе).
// ⚠️ Ролей ровно две, и это решение, а не упрощение. Прежние три (light/recommended/heavy)
// строили «окно» вокруг самой крупной влезающей модели и показывали в том числе то, что на этом
// железе работать не будет (27B на карте с 8 ГБ), — человек скачивал гигабайты и получал
// неработающее. Теперь предлагается минимум выбора и только то, что реально поедет:
//  • 'recommended' — с неё начинать: самая лёгкая модель, качество которой ИЗМЕРЕНО стендом;
//  • 'stronger'    — заметно тяжелее, берут ради связного текста, и только если влезает с запасом.
// Всё остальное роли не получает и в интерфейсе не показывается вовсе.
export type ModelRole = 'recommended' | 'stronger';

export interface CatalogEntry {
  model: CatalogModel;
  fit: ModelFit;
  role: ModelRole | null; // null = не предлагаем на этом железе (в интерфейс не попадает)
  visibleByDefault: boolean;
  // Чем эта модель отличается ДЛЯ ЧЕЛОВЕКА — одной строкой, из наших же замеров (см. ai-bench).
  // Живёт в каталоге, а не в UI: числа и выводы получены рядом с моделью, и расходиться им нельзя.
  summary: string;
  // Сколько видеопамяти реально нужно — ВМЕСТЕ с резервом под систему и запасом самого движка.
  // ⚠️ Считается в ModelCatalog.ts, где эти резервы и живут, а не в интерфейсе: без них выходит
  // заниженное число (у 9B — «6 ГБ» вместо честных 7), и человек с картой на 6 ГБ скачивает
  // модель, которая у него не поедет.
  minVramBytes: number;
}

// Результат удаления модели (см. electron/ModelRegistry.ts::deleteModel) — структурно идентичная
// копия здесь, а не импорт: та же причина, что у CatalogModel/ModelFit выше — ModelRegistry.ts
// тянет 'electron' (app.getPath), чего в renderer-бандл тащить нельзя. reason — свободная строка
// (не union литералов): NOT_FOUND/LEGACY_NOT_DELETABLE/LAST_MODEL — фиксированные, но FS_ERROR
// включает динамический текст исключения ФС.
export type DeleteModelResult = { ok: true } | { ok: false; reason: string };

// Установленная на диске модель (см. electron/ModelRegistry.ts::InstalledModel) — структурно
// идентичная копия здесь, а не импорт: та же причина, что у CatalogModel/DeleteModelResult выше —
// ModelRegistry.ts тянет 'electron' (app.getPath), чего в renderer-бандл тащить нельзя. filePath
// отдаётся как есть, включая легаси-записи вне userData — UI сам решает, что показать пользователю.
export interface InstalledModel {
  id: string;
  label: string;
  filePath: string;
  sizeBytes: number;
  source: 'legacy' | 'downloaded';
}

// Результат смены дефолтной модели (см. electron/ModelRegistry.ts::setDefault). Валидация id
// (NOT_FOUND) сделана на уровне IPC-обработчика в main.ts — само ModelRegistry.setDefault() при
// неизвестном id молча ничего не делает (void), а не сообщает об ошибке. Важно: успешная смена
// дефолта НЕ выгружает уже загруженную модель из VRAM — та остаётся прежней до явного unloadModel(),
// UI обязан отражать дефолт и загруженную модель как два независимых состояния.
export type SetDefaultModelResult = { ok: true } | { ok: false; reason: string };

export type AiActionOutcome =
  | { ok: true; out: string; action: AiAction; dirUsed?: TranslateDirection; ms: number; tokPerSec: number; loadMs: number | null }
  | { ok: false; error: string; errorCode?: ModelErrorCode };

// ── Реестр пользовательских AI-скиллов (prompt-кнопок AI-панели) ─────────────────────────────
// Источник истины — electron/SkillsStore.ts::Skill (не трогаем, стор готов) — структурно
// идентичная копия здесь, а не импорт: shared/ipc.ts бандлится и в renderer (Vite), а
// SkillsStore.ts тянет 'electron'/node fs/path, которые в renderer-бандл тащить нельзя.
// ⚠️ Держать поля в синхроне с electron/SkillsStore.ts::Skill вручную при любой правке одного из них.
export interface Skill {
  id: string;
  label: string;
  prompt: string;
  icon?: string;
  builtin?: boolean;
  // Видимость кнопки в AI-панели — независима от builtin, тумблер в Settings может спрятать
  // даже встроенный скилл, не удаляя его (см. SkillsStore.ts::remove — builtin по-прежнему
  // неудаляем). Не optional — старые skills.json без этого поля мигрируются в SkillsStore.ts.
  visible: boolean;
}

// ── Что ИИ делает прямо сейчас (electron/AiActivity.ts) ──────────────────────────────────────
// ⚠️ Одно состояние на приложение, а не по одному на фичу: у node-llama-cpp один контекст на
// процесс и одна очередь к нему, значит «занят ли ИИ» — физически единственный факт.
export interface AiActivityState {
  /** Что именно идёт, словами человека: «Собираю документ», «Отвечаю в чате». */
  label: string;
  startedAt: number;
  /** Знаков сгенерировано. 0 — работа началась, но модель ещё не выдала ни знака. */
  chars: number;
}

// ── Объём страницы Студии ────────────────────────────────────────────────────────────────────
// ⚠️ Ступени, а не поле ввода: человек выбирает между «быстро» и «длинно», а не между 4100 и
// 4200. Цена выбора — ВРЕМЯ, и подпись в настройках говорит именно о нём: знаки его не удивят,
// а три минуты ожидания удивят.
export type PageLength = 'short' | 'normal' | 'long';

/**
 * Потолок вывода на каждую ступень, в токенах.
 *
 * ⚠️ Верхняя ступень посчитана, а не выбрана: окно контекста 16 384, вход (18 000 знаков
 * источников) съедает около 6 500, значит на выход остаётся с запасом. 6 000 — это 13–15 тысяч
 * знаков и две-три минуты работы.
 *
 * ⚠️ Выше поднимать НЕЛЬЗЯ, и дело не в контексте. Во-первых, пришлось бы трогать
 * CONTEXT_MAX_TOKENS, а над ним стоит разбор: без потолка createContext раздал 4B-модели
 * 218 000 токенов и сделал её медленнее 9B. Во-вторых, 4B на длинной дистанции начинает ходить
 * по кругу — больше знаков не значит больше смысла. Если понадобится длиннее, правильный ответ
 * не «ещё токенов», а по разделу за прогон.
 */
export const PAGE_LENGTH_TOKENS: Record<PageLength, number> = {
  short: 1800,
  normal: 3200,
  long: 6000,
};
