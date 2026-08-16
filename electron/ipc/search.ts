// Адблок, бэнги, полоса быстрого поиска, обновления, настройки, движок перевода
//
// Часть контракта IPC, вынесенная из main.ts (см. electron/ipc/deps.ts — почему нарезано
// непрерывными кусками, а не по доменам). Тела обработчиков перенесены дословно.
import { deriveBangFromUrl } from '../../shared/bangs';
import { IPC } from '../../shared/ipc';
import type { BangDefWire, DerivedBangCandidate, HubMode, ModelLoadMode, RecommendedSite, SearchChipCandidate, SearchChipsConfig, TranslationEngineId } from '../../shared/ipc';
import type { SearchEngineId } from '../../shared/searchEngines';
import { resolveChipCandidates, searchChipCandidates } from '../SearchTargets';
import { setActiveEngineId } from '../TranslationEngineRegistry';
import { broadcastToChrome } from '../WindowRegistry';
import { ipcMain } from 'electron';
import type { IpcDeps } from './deps';

// См. комментарий у SETTINGS_GET_HUB_MODE — отличает пассивное восстановление сессии (первый
// запрос режима хаба за процесс) от реальной навигации пользователя (все последующие).
let hubModeQueried = false;

export function registerSearchIpc(d: IpcDeps): void {
  const { adblock, bangs, chromeOf, maybeLazyWarmupOnDemand, searchTargets, settings, tabsOf, updates } = d;


  // AdBlock
  ipcMain.handle(IPC.ADBLOCK_GET_STATE,      ()                    => adblock.getState());
  ipcMain.handle(IPC.ADBLOCK_SET_ENABLED,    (_e, v: boolean)      => adblock.setEnabled(v));
  ipcMain.handle(IPC.ADBLOCK_ADD_DOMAIN,     (_e, d: string)       => adblock.addDomain(d));
  ipcMain.handle(IPC.ADBLOCK_REMOVE_DOMAIN,  (_e, d: string)       => adblock.removeDomain(d));
  ipcMain.handle(IPC.ADBLOCK_RELOAD_TABS,    (e, d?: string)      => tabsOf(e)?.reloadTabsForDomain(d));
  ipcMain.handle(IPC.ADBLOCK_IS_WHITELISTED, (_e, d: string)       => adblock.isWhitelisted(d));
  ipcMain.handle(IPC.ADBLOCK_GET_SITE_BLOCK_COUNT, (_e, d: string) => adblock.getBlockedCountForDomain(d));

  // Бэнги омнибокса. Всё invoke: пользователь должен видеть результат (причину отказа при
  // сохранении, число импортированных), а не отправлять команду в пустоту.
  ipcMain.handle(IPC.BANGS_LIST, () => ({
    user: bangs.listUser(),
    builtin: bangs.listBuiltin(),
    importedCount: bangs.importedCount(),
  }));
  ipcMain.handle(IPC.BANGS_UPSERT, (_e, b: BangDefWire) => bangs.upsertUser(b));
  ipcMain.handle(IPC.BANGS_REMOVE, (_e, key: string) => { bangs.removeUser(key); });
  // Заготовки по адресам открытых вкладок. Работа целиком в main: у renderer нет URL чужих
  // вкладок, да и деривация — не его дело (см. CLAUDE.md — компоненты только рисуют).
  ipcMain.handle(IPC.BANGS_DERIVE_TABS, (e) => {
    const out: DerivedBangCandidate[] = [];
    const seen = new Set<string>();
    for (const t of tabsOf(e)?.snapshot() ?? []) {
      if (t.isHub || !t.url) continue;
      const d = deriveBangFromUrl(t.url);
      // Дедуп по шаблону: две вкладки одного поиска дали бы две одинаковые строки в списке.
      if (!d || seen.has(d.template)) continue;
      seen.add(d.template);
      out.push({ ...d, tabTitle: t.title || d.name, tabUrl: t.url });
    }
    return out;
  });
  ipcMain.handle(IPC.BANGS_IMPORT_DDG, () => bangs.importDuckDuckGoBangs());
  ipcMain.handle(IPC.BANGS_CLEAR_IMPORTED, () => { bangs.clearImported(); });

  // ── Полоса целей быстрого поиска (Ctrl+E) ──
  ipcMain.handle(IPC.SEARCH_CHIPS_GET, (): SearchChipsConfig => settings.getSearchChips());
  ipcMain.handle(IPC.SEARCH_CHIPS_SET, (_e, cfg: SearchChipsConfig) => { settings.setSearchChips(cfg); });
  // Выбор цели в настройках — только поиском и разрешением выбранных id: целиком список не
  // отдаётся, вместе с импортированным набором DDG их тысячи (см. SearchTargets.ts).
  ipcMain.handle(IPC.SEARCH_CHIPS_SEARCH, (_e, query: string): SearchChipCandidate[] =>
    searchChipCandidates(typeof query === 'string' ? query : '', { bangs, learned: searchTargets }));
  ipcMain.handle(IPC.SEARCH_CHIPS_RESOLVE, (_e, ids: string[]): SearchChipCandidate[] =>
    resolveChipCandidates(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [],
      { bangs, learned: searchTargets }));

  // Возврат OS-фокуса чрому по требованию renderer'а. Тот же приём, что уже применяется на
  // Ctrl+L и при открытии дропдауна подсказок, — просто доступный ещё и из омнибокса.
  // ⚠️ Та же проверка, что у SUGGEST_DROPDOWN_TOGGLE: focus() на УЖЕ сфокусированной вью сбрасывает
  // захват мыши, а этот канал зовётся в том числе на mousedown по адресной строке — то есть ровно
  // в начале протяжки выделения.
  ipcMain.on(IPC.CHROME_FOCUS, (e) => {
    const chrome = chromeOf(e);
    if (chrome && !chrome.isFocused()) chrome.focus();
  });

  // Автообновление. Команды — on, а не handle: ответ не нужен, результат приходит пушем
  // UPDATE_CHANGED (см. UpdateManager.initialize ниже).
  ipcMain.on(IPC.UPDATE_CHECK,    () => updates.check());
  ipcMain.on(IPC.UPDATE_DOWNLOAD, () => updates.download());
  ipcMain.on(IPC.UPDATE_INSTALL,  () => updates.install());
  ipcMain.handle(IPC.UPDATE_STATUS, () => updates.getStatus());

  // Настройки
  ipcMain.handle(IPC.SETTINGS_GET_SEARCH_ENGINE, () => settings.getSearchEngine());
  ipcMain.handle(IPC.SETTINGS_SET_SEARCH_ENGINE, (e, id: SearchEngineId) => {
    settings.setSearchEngine(id);
    tabsOf(e)?.setSearchEngine(id);
  });
  ipcMain.handle(IPC.SETTINGS_GET_HUB_MODE, () => {
    const mode = settings.getHubMode();
    // Hub.tsx зовёт этот геттер на каждом маунте (=каждое открытие хаба, компонент размонтируется
    // при уходе с хаба) — «открытие хаба в режиме AI» из брифа лазит именно сюда. Живая проверка
    // поймала реальную гонку: САМЫЙ ПЕРВЫЙ такой вызов процесса — не пользовательское намерение,
    // а пассивное восстановление сессии (activeRef может оказаться хабом, hubMode — 'ai' с
    // прошлого раза) — без этой отсечки прогрев запускался бы на каждом старте с хабом-в-AI-режиме
    // в сессии, тот самый сценарий, который modelLoadMode='on-demand' обязан избегать (проверка 1).
    // Второй и все последующие вызовы — уже реальная навигация пользователя в рамках этого запуска.
    if (mode === 'ai' && hubModeQueried) maybeLazyWarmupOnDemand();
    hubModeQueried = true;
    return mode;
  });
  ipcMain.handle(IPC.SETTINGS_SET_HUB_MODE, (_e, mode: HubMode) => {
    settings.setHubMode(mode);
    if (mode === 'ai') maybeLazyWarmupOnDemand();
  });
  // Набор «Рекомендуемые» для панели омнибокса (правится карандашом прямо в панели).
  // Сайты, защищённые от выгрузки из памяти (раздел настроек; ставится галочка в ПКМ-меню вкладки).
  ipcMain.handle(IPC.NEVER_SLEEP_LIST, () => settings.getNeverSleepSites());
  ipcMain.handle(IPC.NEVER_SLEEP_REMOVE, (_e, host: string) => {
    if (!settings.isNeverSleepHost(host)) return;
    settings.toggleNeverSleepHost(host); // единственная точка правки — второго пути к списку нет
    broadcastToChrome(IPC.NEVER_SLEEP_CHANGED);
  });
  ipcMain.handle(IPC.SETTINGS_GET_RECOMMENDED, () => settings.getRecommendedSites());
  ipcMain.handle(IPC.SETTINGS_SET_RECOMMENDED, (_e, list: RecommendedSite[]) => settings.setRecommendedSites(list));
  ipcMain.handle(IPC.SETTINGS_GET_AI_PANEL_WIDTH, () => settings.getAiPanelWidth());
  ipcMain.handle(IPC.SETTINGS_GET_MODEL_LOAD_MODE, () => settings.getModelLoadMode());
  ipcMain.handle(IPC.SETTINGS_SET_MODEL_LOAD_MODE, (_e, mode: ModelLoadMode) => settings.setModelLoadMode(mode));

  // Выбор движка перевода страниц (Settings.tsx, секция AI) — persist + сразу применяется к
  // registry (см. TranslationEngineRegistry.ts::setActiveEngineId), без перезапуска приложения.
  ipcMain.handle(IPC.TRANSLATION_ENGINE_GET, () => settings.getTranslationEngine());
  ipcMain.handle(IPC.TRANSLATION_ENGINE_SET, (_e, id: TranslationEngineId) => {
    settings.setTranslationEngine(id);
    setActiveEngineId(id);
  });
  ipcMain.handle(IPC.TRANSLATION_ENGINE_GET_BERGAMOT_STATUS, () => d.getBergamotStatus());

}
