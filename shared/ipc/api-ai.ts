// Контракт main ↔ renderer, часть ai: ИИ и большие экраны: группировка, модели, блокнот, граф, перевод, настройки ИИ.
//
// ⚠️ Разрезано по ДОМЕНАМ, а не по объёму. Единый OblakoApi перевалил за 700 строк — порог, на
// котором список интерфейсов перестаёт читаться и начинает просматриваться. Домены выбраны те
// же, что у обработчиков в electron/ipc/ и у разделов документации, чтобы «где искать» был один
// вопрос, а не три.
//
// ⚠️ Сам OblakoApi по-прежнему ОДИН тип (api.ts наследует все части): звать его из renderer'а
// приходится как единое window.oblako, и дробить эту точку входа было бы правдой про файлы, а не
// про программу.
import type { PageLength, AiConnection, AiConnectionsState, AiConnectionTest } from './ai';
import type { AiUsage } from '../aiUsage';
import type { SearchEngineId } from '../searchEngines';
import type { GraphChatMessage, GraphDoc, GraphMeta, GraphNodeVersion, GraphProgress, GraphStructure } from '../graph';
import type { ImagePreset } from '../imagePresets';
import type { AutomationRule } from '../rules';
import type { ProfilesState, ProfileSettings, ProfileAvatar, ProfileLook } from '../profiles';
import type { ContentBounds, GenProgress, GenWebResult, McpCallLog, McpServerState, OrganizeCluster, OrganizeProposal, RuleParseOutcome, GenSpecOutcome, SearchChipCandidate, SearchChipsConfig } from './core';
import type { PasswordAddInput, PasswordCopyField, PasswordGenerateOptions, PasswordIndicatorState, PasswordMeta, PasswordUpdateInput, VpnConnectionState, VpnServerMeta, VpnStatus, VpnSubscriptionResult } from './security';
import type { OmniboxPanel, OmniboxRecommendEdit, RecommendedSite, SuggestDropdownItem } from './omnibox';
import type { BangDefWire, BangsSnapshot, BergamotStatus, CatalogEntry, DeleteModelResult, DerivedBangCandidate, DownloadProgress, HardwareSnapshot, HubChatMessage, HubChatOutcome, HubChatSessionMeta, HubMode, ImportBangsResult, InstalledModel, ModelDownloadSpec, ModelLoadMode, PageTranslateProgress, PageTranslateState, SetDefaultModelResult, Skill, TranslationEngineId, UpdateStatus } from './ai';
import type { AddressInput, AddressProfile, AddressUpdate, CardInput, CardMeta, CardUpdate, MediaCommand, MediaNowPlaying } from './app';


export interface AiApi {
  // AI-группировка вкладок (Phase 4)
  organizeApply(clusters: OrganizeCluster[]): Promise<void>;
  organizeRollback(): Promise<void>;
  // TabOrganizer.ts::suggestGroups() — Qwen-группировка открытых вкладок (заменяет
  // ClusteringService.ts как источник предложений, тот же формат применения через
  // organizeApply выше). Request/response, не fire-and-forget — как searchHistorySmart.
  suggestGroups(): Promise<OrganizeProposal>;

  // Правила-автоматизации. parseRule — единственный вызов с моделью (фраза → черновик),
  // остальное обычный CRUD: правило исполняется кодом, а не моделью.
  parseRule(phrase: string): Promise<RuleParseOutcome>;
  /**
   * Фраза → спека своего виджета (тип из каталога + данные). Модель кода не пишет.
   * url — ссылка, которую дал ЧЕЛОВЕК; с ней собирается виджет по фиду или JSON.
   */
  /**
   * Собрать свой виджет по фразе. `size` — выбранный человеком размер плитки В КЛЕТКАХ.
   *
   * ⚠️ Размер уезжает в main не для проверки, а В ПРОМПТ яруса 2: модель пишет вёрстку, и
   * квадрат 2×2 против широкой 4×2 — это разная вёрстка (см. electron/GenFreeBuilder.ts).
   * Какой ярус сработает, решает МАРШРУТ РОЛИ в main, а не студия.
   */
  buildGenWidget(phrase: string, url?: string, size?: { w: number; h: number }): Promise<GenSpecOutcome>;
  /** Сходить по ссылке человека. Запрос идёт из main сессией Electron, значит через VPN. */
  fetchGenWeb(url: string, force?: boolean): Promise<GenWebResult>;

  // ── Профили (shared/profiles.ts) ──────────────────────────────────────────
  // Свои куки и логины, свой VPN и адблок. Профиль по умолчанию сидит на сессии по умолчанию —
  // там уже лежат данные человека, и трогать их нельзя.
  getProfiles(): Promise<ProfilesState>;
  createProfile(name: string, color: string): Promise<ProfilesState>;
  removeProfile(id: string): Promise<ProfilesState>;
  renameProfile(id: string, name: string): Promise<ProfilesState>;
  setProfileSettings(id: string, patch: Partial<ProfileSettings>): Promise<ProfilesState>;
  /** Аватарка: буква имени, эмодзи или своё фото (data-URL в пределах PROFILE_PHOTO_MAX). */
  setProfileAvatar(id: string, avatar: ProfileAvatar): Promise<ProfilesState>;
  /** Своя тема/палитра/обои. null в поле — «как в приложении». */
  setProfileLook(id: string, patch: Partial<ProfileLook>): Promise<ProfilesState>;
  switchProfile(id: string): Promise<ProfilesState>;
  /** Закрепить профиль за запуском. null — спрашивать при каждом старте. */
  setStartupProfile(id: string | null): Promise<ProfilesState>;
  onProfilesChanged(cb: (s: ProfilesState) => void): () => void;
  /** Ход сборки — приходит только тому окну, которое её и запросило. */
  onGenWidgetProgress(cb: (p: GenProgress) => void): () => void;
  addRule(draft: AutomationRule): Promise<AutomationRule | null>;
  listRules(): Promise<AutomationRule[]>;
  setRuleEnabled(id: string, enabled: boolean): Promise<boolean>;
  removeRule(id: string): Promise<boolean>;
  onRulesChanged(cb: (rules: AutomationRule[]) => void): () => void;

  // Правая AI-панель (заход 3 — правый split-view-подобный док, см. AiPanelManager.ts)
  toggleAiPanel(): Promise<boolean>;
  getAiPanelWidth(): Promise<number>;
  resizeAiPanel(widthPx: number): void; // ad-hoc, fire-and-forget — тот же принцип, что остальная ai-panel:* механика
  // Источник истины для aiPanelOpen в App.tsx — единственный на ЛЮБОЕ закрытие/открытие
  // (крестик/Escape внутри панели, тоггл в тулбаре, будущие пути) — не полагаться на
  // возвращаемое значение toggleAiPanel() как на единственный сигнал.
  onAiPanelStateChanged(cb: (open: boolean) => void): () => void;

  // Полностраничный перевод (см. electron/PageTranslateManager.ts) — тоггл для активной вкладки,
  // fire-and-forget: актуальное состояние приходит через onPageTranslateStateChanged (main сам
  // решает idle/translating/translated, renderer ничего не считает сам). getPageTranslateState —
  // явный запрос на монтирование (та же пара get+onChanged, что getAdBlockState/onAdBlockStateChanged) —
  // push мог уйти ДО того, как renderer подписался (гонка старта окна).
  togglePageTranslate(): void;
  getPageTranslateState(): Promise<PageTranslateState>;
  onPageTranslateStateChanged(cb: (state: PageTranslateState) => void): () => void;
  // Прогресс во время 'translating' — только push, без get: коротко живёт (секунды), гонка старта
  // окна ей не грозит (пока подписка не пришла, идёт максимум idle→translating, кнопка и так уже
  // рисует спиннер по state). См. PageTranslateProgress.
  onPageTranslateProgressChanged(cb: (progress: PageTranslateProgress | null) => void): () => void;

  // Выбор движка перевода страниц (Settings.tsx, секция AI) — get+set как у searchEngine/hubMode
  // (SettingsManager.ts персистит значение). getBergamotStatus+onBergamotStatusChanged — та же
  // пара, что getPageTranslateState/onPageTranslateStateChanged: Bergamot греется в фоне на старте
  // main.ts независимо от того, что сейчас выбрано, и warmup мог УЖЕ завершиться до того, как
  // Settings.tsx смонтируется и подпишется — без явного get секция настроек молча зависла бы на
  // "Загрузка…" (гонка старта).
  getTranslationEngine(): Promise<TranslationEngineId>;
  setTranslationEngine(id: TranslationEngineId): Promise<void>;
  getBergamotStatus(): Promise<BergamotStatus>;
  onBergamotStatusChanged(cb: (status: BergamotStatus) => void): () => void;

  // Дропдаун подсказок омнибокса — временный тумблер тестовой нативной вью (заход 2/5,
  // см. SuggestDropdownManager.ts). Прямоугольник омнибокса — см. setOmniboxBounds выше.
  setSuggestDropdownOpen(open: boolean): Promise<void>;
  // Живой список подсказок (заход 3/5) — тот же массив, что buildSuggestions строит для
  // старого дропдауна, пересылается во вью нативного дропдауна.
  setSuggestDropdownItems(items: SuggestDropdownItem[]): Promise<void>;
  // Заход 11 — панель по нетронутой строке (см. OmniboxPanel). Второй режим ТОЙ ЖЕ вью: что
  // прислали последним, то и нарисовано.
  setSuggestDropdownPanel(panel: OmniboxPanel): Promise<void>;
  // Человек кликнул полоску сайта в панели — Toolbar.tsx открывает поповер замочка.
  onSuggestDropdownSiteInfo(cb: () => void): () => void;
  // Правка «Рекомендуемых» карандашом в панели (см. OmniboxRecommendEdit).
  onSuggestDropdownRecommend(cb: (edit: OmniboxRecommendEdit) => void): () => void;
  getRecommendedSites(): Promise<RecommendedSite[]>;
  setRecommendedSites(list: RecommendedSite[]): Promise<void>;

  // Сайты, защищённые от выгрузки из памяти. Ставится галочкой в ПКМ-меню вкладки, снимается там
  // же или здесь; правило про САЙТ, а не про вкладку — закрытая вкладка его не уносит.
  listNeverSleepSites(): Promise<string[]>;
  removeNeverSleepSite(host: string): Promise<void>;
  onNeverSleepChanged(cb: () => void): () => void;
  // Пользователь кликнул строку во вью дропдауна — Toolbar.tsx вызывает свой pickSuggestion().
  onSuggestDropdownPicked(cb: (item: SuggestDropdownItem) => void): () => void;
  // Клавиатурная подсветка (заход 4/5) — номер строки, -1 снимает подсветку. Омнибокс держит
  // selectedIdx, вью только рисует по этому номеру.
  setSuggestDropdownHighlight(idx: number): Promise<void>;
  // Заход 5 — реальный OS-фокус ушёл на контент активной вкладки (независимый от blur сигнал
  // закрытия дропдауна, см. IPC.SUGGEST_DROPDOWN_CONTENT_FOCUS).
  onSuggestDropdownContentFocus(cb: () => void): () => void;

  // Заход 10 — живые suggest-подсказки текущего поисковика (см. SearchSuggestFetcher.ts).
  // Пустой массив на любой сбой (нет сети/таймаут/лимит) — never throws, вызывающая сторона
  // (Toolbar.tsx::buildSuggestions) не обязана оборачивать в try/catch отдельно.
  fetchSuggestions(query: string): Promise<string[]>;

  // Настройки
  getSearchEngine(): Promise<SearchEngineId>;
  setSearchEngine(id: SearchEngineId): Promise<void>;
  getHubMode(): Promise<HubMode>;
  setHubMode(mode: HubMode): Promise<void>;
  getModelLoadMode(): Promise<ModelLoadMode>;
  setModelLoadMode(mode: ModelLoadMode): Promise<void>;
  /** Объём страницы Студии: ступень, а не число знаков (см. PAGE_LENGTH_TOKENS). */
  getPageLength(): Promise<PageLength>;
  setPageLength(v: PageLength): Promise<void>;

  // AI-чат на Hub (см. electron/HubChatManager.ts) — только локальная модель в этом заходе.
  // send — fire-and-forget, ответ идёт стримом через onHubChatChunk/onHubChatResult.
  // grounding — тоггл-глобус в хабе (свой, не общий с AI-панелью, см. Hub.tsx::AiChatView).
  /** notebook — лента живёт в блокноте: у него своя роль маршрутизации. */
  sendHubChatMessage(tabId: string, text: string, grounding: boolean, sourcesContext?: string, notebook?: boolean): void;
  onHubChatChunk(cb: (payload: { tabId: string; text: string }) => void): () => void;
  onHubChatResult(cb: (payload: { tabId: string; sessionId: number; outcome: HubChatOutcome }) => void): () => void;
  listHubChatSessions(): Promise<HubChatSessionMeta[]>;
  getHubChatSession(sessionId: number): Promise<HubChatMessage[]>;
  newHubChatSession(tabId: string): Promise<void>;
  resumeHubChatSession(tabId: string, sessionId: number): Promise<HubChatMessage[]>;
  deleteHubChatSession(sessionId: number): Promise<void>;

  // Граф-воркспейс (electron/GraphStore.ts + GraphEngine.ts).
  // saveGraph шлёт ТОЛЬКО структуру: результаты узлов принадлежат движку, и холст не должен
  // их затирать своей — уже устаревшей — копией (см. шапку GraphStore.ts).
  // runGraph — fire-and-forget: ход прогона приезжает через onGraphProgress.
  listGraphs(): Promise<GraphMeta[]>;
  createGraph(title: string): Promise<GraphMeta | null>;
  getGraph(graphId: number): Promise<GraphDoc | null>;
  saveGraph(graphId: number, structure: GraphStructure): Promise<void>;
  renameGraph(graphId: number, title: string): Promise<void>;
  deleteGraph(graphId: number): Promise<void>;
  runGraph(graphId: number, nodeId: string | null): void;
  // Нативный диалог выбора документа. Путь возвращается в renderer только чтобы показать
  // имя файла и положить его в конфиг узла; читает файл всегда main (electron/FileExtract.ts).
  pickGraphFile(): Promise<string | null>;
  pickGraphImage(): Promise<string | null>;
  // Забрать сгенерированную картинку из открытого веб-чата: main сохраняет файл и отдаёт
  // путь, холст заводит по нему узел «Картинка».
  captureWebAppImage(graphId: number, nodeId: string): Promise<{ ok: boolean; path?: string; error?: string }>;
  // Превью картинки узла: main читает файл с диска и отдаёт уменьшенный data-URL. Прямой
  // доступ к file:// у renderer закрыт, да и полноразмерный кадр в карточке ни к чему.
  graphImagePreview(path: string): Promise<string | null>;
  // Прошлые результаты узла (до пяти, свежие первыми) — для сравнения формулировок.
  listNodeHistory(graphId: number, nodeId: string): Promise<GraphNodeVersion[]>;

  // Узел-диалог: переписка живёт в main, наружу узел отдаёт последний ответ модели.
  listGraphChat(graphId: number, nodeId: string): Promise<GraphChatMessage[]>;
  sendGraphChat(graphId: number, nodeId: string, text: string): void;
  clearGraphChat(graphId: number, nodeId: string): Promise<void>;
  onGraphChatChunk(cb: (p: { graphId: number; nodeId: string; text: string }) => void): () => void;
  onGraphChatDone(
    cb: (p: { graphId: number; nodeId: string; ok: boolean; text?: string; error?: string }) => void,
  ): () => void;
  // Сохранение результата узла на диск. Диалог и запись — в main; renderer отдаёт только
  // текст и предлагаемое имя.
  saveGraphOutput(suggestedName: string, text: string): Promise<boolean>;
  // Пресеты генератора промптов для картинок. Встроенные лежат в shared/imagePresets.ts и
  // через IPC не ездят — сюда приходят только пользовательские.
  listImagePresets(): Promise<ImagePreset[]>;
  saveImagePreset(preset: ImagePreset): Promise<void>;
  deleteImagePreset(id: string): Promise<void>;
  cancelGraphRun(graphId: number): Promise<void>;
  onGraphProgress(cb: (p: GraphProgress) => void): () => void;
  // Граф пополнился снаружи — открытый холст должен перечитать его.
  onGraphChanged(cb: (graphId: number) => void): () => void;

  // Узел-веб-приложение. Промпт для вставки собирает main из сохранённого графа (renderer
  // его не считает — иначе состояние разъехалось бы), пойманный ответ main же и пишет в
  // результат узла с правильным отпечатком входов.
  showGraphWebApp(graphId: number, nodeId: string, url: string, bounds: ContentBounds): Promise<void>;
  setGraphWebAppBounds(graphId: number, nodeId: string, bounds: ContentBounds): Promise<void>;
  raiseGraphWebApp(graphId: number, nodeId: string): Promise<void>;
  closeGraphWebApp(graphId: number, nodeId: string): Promise<void>;
  insertGraphWebAppPrompt(graphId: number, nodeId: string): Promise<boolean>;
  captureGraphWebAppAnswer(graphId: number, nodeId: string, mode: 'selection' | 'last'): Promise<string>;

  // Заход D — ключ Gemini (AI-фактчек). Сам ключ никогда не приходит в renderer — только статус.
  getAiKeyStatus(): Promise<boolean>;
  saveAiKey(key: string): Promise<boolean>;
  deleteAiKey(): Promise<void>;
  onAiKeyStatusChanged(cb: (connected: boolean) => void): () => void;

  // Задел под web-grounding (SearXNG) — тот же контракт: endpoint/токен никогда не приходят
  // в renderer, только статус «настроено/нет» (см. electron/SearxngKeyStore.ts).
  getSearxngStatus(): Promise<boolean>;
  saveSearxngConfig(config: { endpoint: string; token: string }): Promise<boolean>;
  deleteSearxngConfig(): Promise<void>;
  onSearxngStatusChanged(cb: (configured: boolean) => void): () => void;

  // Реестр пользовательских AI-скиллов (см. Skill выше, electron/SkillsStore.ts) — CRUD для
  // редактора в Settings. id генерит main (crypto.randomUUID()) — renderer его не шлёт, см.
  // SKILLS_ADD. visible в patch — тумблер видимости на панели (доступен и для builtin).
  listSkills(): Promise<Skill[]>;
  addSkill(input: { label: string; prompt: string; icon?: string }): Promise<boolean>;
  updateSkill(id: string, patch: { label?: string; prompt?: string; icon?: string; visible?: boolean }): Promise<boolean>;
  removeSkill(id: string): Promise<boolean>;
  onSkillsChanged(cb: (skills: Skill[]) => void): () => void;

  // VPN, шаг 1 — подписка + список серверов (см. electron/VpnSubscription.ts). Ссылка подписки
  // и credential серверов никогда не приходят в renderer — см. VpnServerMeta/VpnStatus выше.
  getVpnStatus(): Promise<VpnStatus>;
  setVpnSubscription(url: string): Promise<VpnSubscriptionResult>;
  refreshVpnSubscription(): Promise<VpnSubscriptionResult>;
  deleteVpnSubscription(): Promise<void>;
  listVpnServers(): Promise<VpnServerMeta[]>;
  onVpnStatusChanged(cb: (status: VpnStatus) => void): () => void;

  // VPN, шаг 2 — только процесс + локальный SOCKS-порт, session.setProxy ещё не подключён
  // (см. electron/VpnProcess.ts). "connect" пока не переключает трафик вкладок.
  vpnConnect(serverId: string): Promise<{ ok: boolean; error?: string }>;
  vpnDisconnect(): Promise<void>;
  getVpnConnectionState(): Promise<VpnConnectionState>;
  onVpnConnectionStateChanged(cb: (state: VpnConnectionState) => void): () => void;

  // Менеджер паролей, шаг 1 (см. electron/PasswordManager.ts). Пароль пересекает IPC только
  // через revealPassword/generatePassword — listPasswords им не отдаёт, copyPasswordField сам
  // кладёт значение в буфер в main и наружу его не возвращает.
  listPasswords(): Promise<PasswordMeta[]>;
  revealPassword(id: number): Promise<string | null>;
  copyPasswordField(id: number, field: PasswordCopyField): Promise<boolean>;

  // Favicon сайта (data-URL) или null — тянется только с самого домена, кэш в main (FaviconService).
  getFavicon(host: string): Promise<string | null>;

  // OS-проверка (нативный диалог Windows) перед показом/копированием пароля — тумблер в настройках.
  getPasswordAuthEnabled(): Promise<boolean>;
  setPasswordAuthEnabled(enabled: boolean): Promise<boolean>;

  // Автозаполнение форм — адреса и карты (electron/AutofillManager.ts). Полный номер карты наружу
  // массово не отдаётся: list — только маска, полный номер — revealCardNumber под Windows Hello.
  listAddresses(): Promise<AddressProfile[]>;
  addAddress(input: AddressInput): Promise<boolean>;
  updateAddress(input: AddressUpdate): Promise<boolean>;
  deleteAddress(id: number): Promise<boolean>;
  listCards(): Promise<CardMeta[]>;
  addCard(input: CardInput): Promise<boolean>;
  updateCard(input: CardUpdate): Promise<boolean>;
  deleteCard(id: number): Promise<boolean>;
  revealCardNumber(id: number): Promise<string | null>;
  onAutofillChanged(cb: () => void): () => void;
  addPassword(input: PasswordAddInput): Promise<boolean>;
  updatePassword(input: PasswordUpdateInput): Promise<boolean>;
  deletePassword(id: number): Promise<void>;
  generatePassword(opts: PasswordGenerateOptions): Promise<string>;
  // Диалог сохранения/открытия файла — целиком в main (см. main.ts::registerIpc). Возвращает
  // false/0, если пользователь отменил диалог или passphrase не подошла — не бросает наружу.
  exportPasswords(passphrase: string): Promise<boolean>;
  importPasswords(passphrase: string): Promise<number>;
  onPasswordsChanged(cb: () => void): () => void;

  // Менеджер паролей, шаг 2 — индикатор-«ключ» + поповер (см. shared/ipc.ts::PasswordIndicatorState).
  onPasswordIndicatorChanged(cb: (state: PasswordIndicatorState | null) => void): () => void;
  savePendingPassword(): Promise<boolean>;
  updatePendingPassword(): Promise<boolean>;
  fillSavedPassword(id: number): Promise<boolean>;
  dismissPendingPassword(): Promise<void>;
  // Иконка на пустом поле пароля (offer-generate) — генерирует и сразу пишет в поле, без буфера.
  generatePendingPassword(): Promise<boolean>;
  setPasswordPopoverAnchorBounds(bounds: ContentBounds): Promise<void>;
  showPasswordPopover(state: PasswordIndicatorState): Promise<void>;
  closePasswordPopover(): Promise<void>;
  onPasswordPopoverClosed(cb: () => void): () => void;

  // Поповер загрузок (см. IPC.DOWNLOADS_POPOVER_*, electron/DownloadsPopoverManager.ts) —
  // как и у VPN, здесь только геометрия анкора и открытие/закрытие: список карточка берёт сама.
  setDownloadsPopoverAnchorBounds(bounds: ContentBounds): Promise<void>;
  showDownloadsPopover(): Promise<void>;
  closeDownloadsPopover(): Promise<void>;
  onDownloadsPopoverClosed(cb: () => void): () => void;

  // Main просит открыть поповер загрузок с вопросом «этот файл уже скачан»: позиция значка
  // известна только хрому, поэтому открывает он — обычным путём, как по клику.
  onDownloadDuplicateAsk(cb: () => void): () => void;

  // Поповер сведений о сайте у замочка в омнибоксе (см. electron/SitePopoverManager.ts).
  // toggle возвращает новое состояние — второго канала «открыт ли» не заводим.
  setSitePopoverAnchorBounds(bounds: ContentBounds): Promise<void>;
  toggleSitePopover(): Promise<boolean>;
  onSitePopoverClosed(cb: () => void): () => void;

  // Детект железа (см. electron/HardwareInfo.ts) — задел под подбор модели, потребителей в UI
  // пока нет. Read-only, из кэша main-процесса (или первый расчёт, если кэша ещё нет).
  getHardwareSnapshot(): Promise<HardwareSnapshot>;
  // Принудительный пересчёт снапшота — не кэш, см. HARDWARE_REFRESH_SNAPSHOT.
  refreshHardwareSnapshot(): Promise<HardwareSnapshot>;

  // Загрузчик GGUF-моделей (см. electron/ModelDownloader.ts) — задел, потребителей в UI пока нет.
  startModelDownload(spec: ModelDownloadSpec): void;
  cancelModelDownload(): void;
  getModelDownloadProgress(): Promise<DownloadProgress>;
  onModelDownloadProgress(cb: (p: DownloadProgress) => void): () => void;

  // Медиасессия: что играет прямо сейчас и управление этим (см. electron/MediaSessionManager.ts).
  getMediaState(): Promise<MediaNowPlaying | null>;
  sendMediaCommand(action: MediaCommand): Promise<boolean>;
  onMediaState(cb: (state: MediaNowPlaying | null) => void): () => void;

  // Курируемый каталог моделей (см. electron/ModelCatalog.ts) — задел, потребителей в UI пока нет.
  getModelCatalog(): Promise<CatalogEntry[]>;

  // Явная выгрузка текущей модели из VRAM (см. electron/TranslationService.ts::unloadModel) —
  // задел, потребителей в UI пока нет.
  unloadModel(): Promise<void>;

  // Удаление модели с диска (см. electron/ModelRegistry.ts::deleteModel) — задел, потребителей
  // в UI пока нет. Необратимо.
  deleteModel(id: string): Promise<DeleteModelResult>;

  // Список установленных моделей (см. electron/ModelRegistry.ts::list) — задел, потребителей
  // в UI пока нет. Read-only.
  getInstalledModels(): Promise<InstalledModel[]>;

  // Дефолтная модель (см. electron/ModelRegistry.ts::getDefault/setDefault) — задел, потребителей
  // в UI пока нет. Смена дефолта НЕ выгружает уже загруженную модель — см. SetDefaultModelResult.
  getDefaultModelId(): Promise<string | null>;
  setDefaultModel(id: string): Promise<SetDefaultModelResult>;

  // Модель, сейчас загруженная в VRAM (см. electron/TranslationService.ts::getLoadedModelId) —
  // задел, потребителей в UI пока нет. Read-only.
  getLoadedModelId(): Promise<string | null>;

  // Вернуть OS-фокус вебконтентам чрома (см. CHROME_FOCUS). Какой DOM-элемент внутри был
  // активен — renderer помнит сам, довозвращать вручную не нужно.
  focusChrome(): void;

  // Бэнги омнибокса (см. electron/BangStore.ts). upsertBang возвращает причину отказа строкой
  // или null при успехе — это ответ на пользовательский ввод, а не исключение.
  listBangs(): Promise<BangsSnapshot>;
  upsertBang(bang: BangDefWire): Promise<string | null>;
  removeBang(key: string): Promise<void>;
  // Заготовки бэнгов по адресам открытых вкладок — избавляет от ручного составления шаблона.
  deriveBangsFromTabs(): Promise<DerivedBangCandidate[]>;
  importDuckDuckGoBangs(): Promise<ImportBangsResult>;
  clearImportedBangs(): Promise<void>;

  // Полоса целей быстрого поиска (Ctrl+E)
  getSearchChips(): Promise<SearchChipsConfig>;
  setSearchChips(cfg: SearchChipsConfig): Promise<void>;
  // Поиск по целям (свои бэнги, выученные сайты, встроенные, импортированные из DDG). Пустая
  // строка — короткий список «что есть под рукой», импортированные в него не входят.
  searchSearchChipCandidates(query: string): Promise<SearchChipCandidate[]>;
  // Разрешение уже выбранных id в карточки — чтобы показать выбор, не листая тысячи целей.
  resolveSearchChipCandidates(ids: string[]): Promise<SearchChipCandidate[]>;

  // Автообновление (см. electron/UpdateManager.ts). checkForUpdate/downloadUpdate — команды без
  // ответа, результат приходит через onUpdateStatusChanged. installUpdate закрывает приложение.
  checkForUpdate(): void;
  downloadUpdate(): void;
  installUpdate(): void;
  getUpdateStatus(): Promise<UpdateStatus>;

  /**
   * Браузер как инструмент внешнего агента (electron/mcp/).
   *
   * ⚠️ Состояние спрашивается, а не хранится в интерфейсе: сервер могли выключить из другого окна
   * настроек, и «включено» на экране при молчащем канале — худший вид неправды.
   */
  getMcpState(): Promise<McpServerState>;
  setMcpEnabled(enabled: boolean): Promise<McpServerState>;
  getMcpCalls(): Promise<McpCallLog[]>;
  revokeMcpClient(key: string): Promise<McpServerState>;
  setMcpStance(key: string, tool: string, stance: 'ask' | 'allow' | 'deny'): Promise<McpServerState>;
  /** Пуш на каждый вызов извне — им живёт метка «браузером управляет внешний агент». */
  onMcpActivity(cb: (call: McpCallLog) => void): () => void;
  onUpdateStatusChanged(cb: (s: UpdateStatus) => void): () => void;

  // ── Подключения к моделям ────────────────────────────────────────────────
  aiConnections(): Promise<AiConnectionsState>;
  /** Ключ уходит только сюда и только в main; обратно он не возвращается никогда. */
  saveAiConnection(conn: AiConnection, key: string | null): Promise<boolean>;
  deleteAiConnection(id: string): Promise<boolean>;
  testAiConnection(conn: AiConnection, key: string | null): Promise<AiConnectionTest>;
  /** null — вернуть роль на модель этой машины. */
  setAiRoute(role: string, connectionId: string | null): Promise<boolean>;
  onAiConnectionsChanged(cb: (state: AiConnectionsState) => void): () => void;

  // ── Вложения из ответа модели ────────────────────────────────────────────
  /** Картинка как data-URL — только для показа. Нет файла (вычистили по потолку) — null. */
  aiFileData(id: string): Promise<string | null>;
  /** Сохранить вложение по клику: диалог + копия. false — человек отказался или не вышло. */
  aiFileSave(id: string): Promise<boolean>;
  /** Сохранить текстовый фрагмент ответа файлом с подсказанным именем. */
  aiTextSave(name: string, text: string): Promise<boolean>;

  /** Расход по подключениям: id → счёт. Ключ LOCAL_CONNECTION_ID — встроенная модель. */
  aiUsage(): Promise<Record<string, AiUsage>>;
  /** Обнулить счёт: одного подключения или весь, если id не задан. */
  resetAiUsage(connectionId?: string): Promise<void>;
}
