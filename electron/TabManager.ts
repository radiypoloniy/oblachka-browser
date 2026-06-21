import { WebContentsView, BrowserWindow, Menu, clipboard } from 'electron';
import type { MenuItemConstructorOptions, WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import type { TabState, TabErrorState, ContentBounds, FindResult } from '../shared/ipc';

const CLOSED_STACK_MAX = 10;

const ZOOM_MIN  = 0.5;
const ZOOM_MAX  = 2.5;
const ZOOM_STEP = 0.1; // 10% за шаг, как в Chrome

// Ширина зазора между split-панелями (px). Должна совпадать с SPLIT_GAP в App.tsx.
const SPLIT_GAP = 8;
const SPLIT_RATIO_MIN = 0.2;
const SPLIT_RATIO_MAX = 0.8;

// TODO: вернуть на боевые значения после теста (2ч / 8ч / 60сек)
const SLEEP_TIMEOUT_NORMAL = 30_000;   // 30 сек для теста → 2 * 60 * 60 * 1000
const SLEEP_TIMEOUT_PINNED = 60_000;   // 60 сек для теста → 8 * 60 * 60 * 1000
const SLEEP_CHECK_INTERVAL = 5_000;    // 5 сек для теста  → 60_000

// Обрезает длинный текст для лейблов меню, чтобы не растягивало окно.
function truncate(text: string, max = 40): string {
  const s = text.trim().replace(/\s+/g, ' ');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// Поисковик по умолчанию — DuckDuckGo (приватный), как в спеке (3.2).
const SEARCH_URL = (q: string) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;

// id вкладки-хаба фиксирован: это НЕ WebContentsView, а наш React-экран.
export const HUB_ID = 'hub';

// Метаданные, сохраняемые при усыплении вкладки.
interface SleepingMeta {
  url: string;
  title: string;
  faviconUrl: string | null;
}

interface ManagedTab {
  id: string;
  view: WebContentsView | null; // null = хаб (sleeping===null) ИЛИ спящая (sleeping!==null)
  sleeping: SleepingMeta | null;
  lastActiveAt: number; // Date.now() последней активности — для таймера сна
}

// Скрипт проверки незаполненных форм — только top-frame (v1: поля внутри iframe не проверяются).
const HAS_FILLED_FORMS_SCRIPT = `(function(){
  var sel='input:not([type=checkbox]):not([type=radio]):not([type=hidden])' +
    ':not([type=submit]):not([type=button]):not([type=reset]):not([type=file]),' +
    'textarea,[contenteditable="true"]';
  var els=document.querySelectorAll(sel);
  for(var i=0;i<els.length;i++){
    var v=els[i].value||els[i].textContent||'';
    if(v.trim().length>0)return true;
  }
  return false;
})()`;

export class TabManager {
  private win: BrowserWindow;
  private tabs: ManagedTab[] = [];
  private activeId: string = HUB_ID;
  private bounds: ContentBounds = { x: 0, y: 0, width: 0, height: 0 };
  private onChange: () => void;
  private onFindResultCb: (r: FindResult) => void;
  private onFindOpenCb: () => void;
  private onFindCloseCb: () => void;
  private onOmniboxFocusCb: () => void;
  private onFocusChromeCb: () => void;
  private closedTabs: string[] = []; // стек URL закрытых вкладок для Ctrl+Shift+T
  private errors = new Map<string, TabErrorState>(); // per-tab ошибки загрузки/краша
  private lastQuery = ''; // последний поисковый запрос (чтобы отличить новый от навигации)
  // Флаг: открыта ли панель поиска (нужен для приоритета Esc: сначала закрыть поиск).
  private findBarOpen = false;
  // Множество id закреплённых вкладок — переживают перезапуск.
  private pinnedIds = new Set<string>();
  // Состояние split-режима: null = обычный режим.
  // splitRatio — доля левой панели (0.2..0.8), сохраняется пока split существует.
  private splitState: {
    leftId: string;
    rightId: string;
    activePanel: 'left' | 'right';
    splitRatio: number;
  } | null = null;

  constructor(
    win: BrowserWindow,
    onChange: () => void,
    onFindResult: (r: FindResult) => void,
    onFindOpen: () => void,
    onFindClose: () => void,
    onOmniboxFocus: () => void,
    onFocusChrome: () => void,
  ) {
    this.win = win;
    this.onChange = onChange;
    this.onFindResultCb = onFindResult;
    this.onFindOpenCb = onFindOpen;
    this.onFindCloseCb = onFindClose;
    this.onOmniboxFocusCb = onOmniboxFocus;
    this.onFocusChromeCb = onFocusChrome;
    // Вкладка-хаб существует всегда и первой.
    this.tabs.push({ id: HUB_ID, view: null, sleeping: null, lastActiveAt: 0 });
    this.startSleepTimer();
  }

  // ── Парсинг omnibox: это URL или поисковый запрос ──
  // Явные правила из спеки (3.7). Edge-кейсы лучше прописать заранее.
  private resolveInput(input: string): string {
    const s = input.trim();
    if (!s) return 'about:blank';
    // Уже есть схема
    if (/^(https?|file|about):/i.test(s)) return s;
    // localhost / IP / есть точка и нет пробела -> трактуем как хост
    const looksLikeHost =
      /^localhost(:\d+)?(\/.*)?$/i.test(s) ||
      /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/.test(s) ||
      (!/\s/.test(s) && /\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s));
    if (looksLikeHost) return `https://${s}`;
    return SEARCH_URL(s);
  }

  private isHttpView(view: WebContentsView | null): view is WebContentsView {
    return view !== null;
  }

  // ── Снимок состояния для UI ──
  snapshot(): TabState[] {
    return this.tabs.map((t) => {
      // Спящая вкладка: отдаём сохранённые метаданные — WebContentsView уже нет.
      if (t.sleeping) {
        return {
          id: t.id,
          isActive: t.id === this.activeId,
          tabError: null,
          url: t.sleeping.url,
          title: t.sleeping.title,
          faviconUrl: t.sleeping.faviconUrl,
          isLoading: false,
          canGoBack: false,
          canGoForward: false,
          isHub: false,
          isPinned: this.pinnedIds.has(t.id),
          splitSide: !this.splitState ? null
            : t.id === this.splitState.leftId  ? 'left' as const
            : t.id === this.splitState.rightId ? 'right' as const
            : null,
          isSleeping: true,
        };
      }
      if (!this.isHttpView(t.view)) {
        return {
          id: t.id, isActive: t.id === this.activeId,
          tabError: null, // хаб не имеет ошибок
          url: '', title: 'Новая вкладка · AI-хаб',
          faviconUrl: null, isLoading: false,
          canGoBack: false, canGoForward: false, isHub: true, isPinned: false,
          splitSide: null,
          isSleeping: false,
        };
      }
      const wc = t.view.webContents;
      return {
        id: t.id,
        isActive: t.id === this.activeId,
        tabError: this.errors.get(t.id) ?? null,
        url: wc.getURL(),
        title: wc.getTitle() || wc.getURL() || 'Загрузка…',
        faviconUrl: (wc as unknown as { _oblakoFavicon?: string })._oblakoFavicon ?? null,
        isLoading: wc.isLoadingMainFrame(),
        canGoBack: wc.canGoBack(),
        canGoForward: wc.canGoForward(),
        isHub: false,
        isPinned: this.pinnedIds.has(t.id),
        splitSide: !this.splitState ? null
          : t.id === this.splitState.leftId  ? 'left' as const
          : t.id === this.splitState.rightId ? 'right' as const
          : null,
        isSleeping: false,
      };
    });
  }

  getActiveId() { return this.activeId; }

  // ── Создание новой вкладки с реальной страницей ──
  // background=true: вкладка создаётся в фоне, без переключения (средний клик по ссылке).
  createTab(rawUrl?: string, background = false): string {
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        // Жёсткая изоляция: страница не имеет доступа к Node.
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.tabs.push({ id, view, sleeping: null, lastActiveAt: Date.now() });
    this.wirePageEvents(id, view);

    const target = this.resolveInput(rawUrl ?? 'about:blank');
    if (target !== 'about:blank') view.webContents.loadURL(target);

    if (background) {
      this.onChange(); // показываем новую вкладку в сайдбаре без переключения
    } else {
      this.activate(id);
    }
    return id;
  }

  // Создаёт закреплённую вкладку — используется только при восстановлении сессии.
  createPinnedTab(rawUrl: string): string {
    const id = this.createTab(rawUrl, /* background */ true);
    this.pinnedIds.add(id);
    return id;
  }

  // Закрепить / открепить существующую вкладку.
  togglePin(id: string): void {
    if (!this.tabs.find((t) => t.id === id) || id === HUB_ID) return;
    if (this.pinnedIds.has(id)) {
      this.pinnedIds.delete(id);
    } else {
      this.pinnedIds.add(id);
    }
    this.onChange();
  }

  isTabPinned(id: string): boolean {
    return this.pinnedIds.has(id);
  }

  // ── Усыпление: выгружаем WebContentsView, сохраняем метаданные ──
  private sleepTab(id: string): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab || !this.isHttpView(tab.view) || tab.sleeping) return;
    const wc = tab.view.webContents;
    const url = wc.getURL();
    // Не усыпляем вкладки без реального URL (about:blank и т.п.)
    if (!/^https?:\/\//i.test(url)) return;
    tab.sleeping = {
      url,
      title: wc.getTitle() || url,
      faviconUrl: (wc as unknown as { _oblakoFavicon?: string })._oblakoFavicon ?? null,
    };
    try { this.win.contentView.removeChildView(tab.view); } catch { /* noop */ }
    try { (wc as unknown as { close?: () => void }).close?.(); } catch { /* noop */ }
    tab.view = null;
    this.errors.delete(id);
    this.onChange();
  }

  // ── Пробуждение: пересоздаём WebContentsView и начинаем загрузку ──
  // Синхронный: создаёт вьюху и стартует загрузку. Страница появится когда загрузится (did-navigate).
  private wakeTab(id: string): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab?.sleeping) return;
    const { url } = tab.sleeping;
    const view = new WebContentsView({
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    tab.sleeping = null;
    tab.view = view;
    tab.lastActiveAt = Date.now();
    this.errors.delete(id);
    this.wirePageEvents(id, view);
    view.webContents.loadURL(url);
  }

  // ── Таймер засыпания: периодически проверяет кандидатов ──
  private startSleepTimer(): void {
    setInterval(async () => {
      const now = Date.now();
      const currentlyInSplit = !!this.splitState &&
        (this.activeId === this.splitState.leftId || this.activeId === this.splitState.rightId);

      // Набор защищённых id: активная вкладка + обе панели активного split.
      const protectedIds = new Set<string>([this.activeId]);
      if (currentlyInSplit && this.splitState) {
        protectedIds.add(this.splitState.leftId);
        protectedIds.add(this.splitState.rightId);
      }

      for (const tab of this.tabs) {
        // Пропускаем: хаб, уже спящие, защищённые вкладки, не-http вьюхи
        if (tab.id === HUB_ID || tab.sleeping || protectedIds.has(tab.id)) continue;
        if (!this.isHttpView(tab.view)) continue;

        // Таймаут ещё не истёк — не трогаем (и не гоняем дорогой JS-запрос зря)
        const timeout = this.pinnedIds.has(tab.id) ? SLEEP_TIMEOUT_PINNED : SLEEP_TIMEOUT_NORMAL;
        if (now - tab.lastActiveAt < timeout) continue;

        const wc = tab.view.webContents;

        // Играет медиа — пропускаем
        if (wc.isCurrentlyAudible()) continue;

        // Async: проверяем незаполненные формы — только после прохождения всех sync-фильтров
        let hasForms = false;
        try {
          hasForms = await wc.executeJavaScript(HAS_FILLED_FORMS_SCRIPT, true);
        } catch {
          continue; // WebContents недоступен — пропускаем
        }
        if (hasForms) continue;

        // Перепроверяем после await: вкладка могла стать активной пока шёл JS-запрос
        if (protectedIds.has(tab.id) || tab.sleeping || !this.isHttpView(tab.view)) continue;
        if (tab.id === this.activeId) continue;
        if (this.splitState) {
          const inActiveSplit = this.activeId === this.splitState.leftId ||
                                this.activeId === this.splitState.rightId;
          if (inActiveSplit &&
              (tab.id === this.splitState.leftId || tab.id === this.splitState.rightId)) continue;
        }

        this.sleepTab(tab.id);
      }
    }, SLEEP_CHECK_INTERVAL);
  }

  private wirePageEvents(id: string, view: WebContentsView) {
    const wc = view.webContents;
    const notify = () => this.onChange();

    // Когда WebContentsView получает OS-фокус от клика мышью — проверяем, не нужно ли
    // активировать панель split. DOM-дивы в renderer не получают клик, перекрытый вьюхой.
    wc.on('focus', () => {
      if (this.splitState &&
          (id === this.splitState.leftId || id === this.splitState.rightId) &&
          this.activeId !== id) {
        const side = id === this.splitState.leftId ? 'left' : 'right';
        this.focusSplitPanel(side);
      }
    });

    // Новая попытка загрузки — очищаем предыдущую ошибку сразу.
    wc.on('did-start-loading', () => { this.errors.delete(id); notify(); });
    wc.on('did-stop-loading', notify);
    // Успешный коммит навигации — показываем вьюху + сбрасываем поиск.
    // Не на did-start-loading: вьюха не должна мигать при retry, который снова упадёт.
    wc.on('did-navigate', () => {
      const isActivePanel = this.activeId === id;
      const isInSplit = !!this.splitState
        && (id === this.splitState.leftId || id === this.splitState.rightId);
      if (isActivePanel) {
        wc.stopFindInPage('clearSelection');
        this.lastQuery = '';
        this.onFindCloseCb();
      }
      // Навигация = активность; обновляем lastActiveAt для активных/split-вкладок.
      if (isActivePanel || isInSplit) {
        const tab = this.tabs.find((t) => t.id === id);
        if (tab) tab.lastActiveAt = Date.now();
      }
      // Показываем вьюху как для активной вкладки, так и для split-партнёра.
      if (isActivePanel || isInSplit) this.revealView(id);
      notify();
    });
    wc.on('did-navigate-in-page', notify);
    wc.on('page-title-updated', notify);

    wc.on('page-favicon-updated', (_e, favicons) => {
      (wc as unknown as { _oblakoFavicon?: string })._oblakoFavicon = favicons?.[0];
      notify();
    });

    // Результат findInPage — пробрасываем в renderer для обновления счётчика.
    wc.on('found-in-page', (_e, result) => {
      this.onFindResultCb({ activeMatch: result.activeMatchOrdinal, count: result.matches });
    });

    // Политика окон: target=_blank / window.open -> НОВАЯ ВКЛАДКА, не окно.
    // disposition='background-tab' = средний клик или Ctrl+клик → фон (стандарт браузеров).
    wc.setWindowOpenHandler(({ url, disposition }) => {
      this.createTab(url, disposition === 'background-tab');
      return { action: 'deny' };
    });

    // Ctrl+колесо → наш зум (preventDefault гасит нативный зум Chromium).
    // Chromium перехватывает Ctrl+scroll как gesture, поэтому страница не скроллится.
    wc.on('zoom-changed', (event, direction) => {
      event.preventDefault();
      this.adjustZoom(direction === 'in' ? ZOOM_STEP : -ZOOM_STEP);
    });

    // Ошибка загрузки основного фрейма (DNS, сеть, TLS…)
    // errorCode === -3 (ERR_ABORTED) — пользователь остановил загрузку; не ошибка.
    wc.on('did-fail-load', (_e, errorCode, _desc, validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === -3) return;
      const url = wc.getURL() || validatedURL;
      this.errors.set(id, { type: 'load', code: errorCode, url });
      const isInSplit = !!this.splitState
        && (id === this.splitState.leftId || id === this.splitState.rightId);
      if (this.activeId === id || isInSplit) this.hideView(id);
      notify();
    });

    // Краш рендер-процесса: вьюха мертва — прячем, показываем экран ошибки.
    wc.on('render-process-gone', () => {
      const url = wc.getURL();
      this.errors.set(id, { type: 'crash', code: 0, url });
      const isInSplit = !!this.splitState
        && (id === this.splitState.leftId || id === this.splitState.rightId);
      if (this.activeId === id || isInSplit) this.hideView(id);
      notify();
    });

    wc.on('context-menu', (_e, p) => {
      const items: MenuItemConstructorOptions[] = [];

      // ── Ссылка ──────────────────────────────────────────────────────────────
      if (p.linkURL) {
        items.push(
          { label: 'Открыть ссылку в новой вкладке', click: () => this.createTab(p.linkURL) },
          { label: 'Копировать адрес ссылки', click: () => clipboard.writeText(p.linkURL) },
        );
      }

      // ── Картинка ─────────────────────────────────────────────────────────────
      if (p.mediaType === 'image' && p.srcURL) {
        if (items.length) items.push({ type: 'separator' });
        items.push(
          { label: 'Копировать картинку', click: () => wc.copyImageAt(p.x, p.y) },
          { label: 'Сохранить картинку как…', click: () => wc.downloadURL(p.srcURL) },
          { label: 'Открыть картинку в новой вкладке', click: () => this.createTab(p.srcURL) },
        );
      }

      // ── Редактируемое поле ───────────────────────────────────────────────────
      // isEditable обрабатываем ДО selectionText: cut/copy/paste — главное для инпутов.
      if (p.isEditable) {
        if (items.length) items.push({ type: 'separator' });
        items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' });
        if (p.selectionText.trim()) {
          items.push({ type: 'separator' });
          items.push({
            label: `Поиск «${truncate(p.selectionText)}» в DuckDuckGo`,
            click: () => this.createTab(SEARCH_URL(p.selectionText)),
          });
        }
      } else if (p.selectionText.trim()) {
        // ── Выделенный текст (не в инпуте) ──────────────────────────────────
        if (items.length) items.push({ type: 'separator' });
        items.push(
          { role: 'copy' },
          {
            label: `Поиск «${truncate(p.selectionText)}» в DuckDuckGo`,
            click: () => this.createTab(SEARCH_URL(p.selectionText)),
          },
        );
      }

      // ── Фоллбэк: просто страница (ни ссылки, ни картинки, ни выделения) ────
      if (!items.length) {
        items.push(
          { label: 'Назад',    enabled: wc.canGoBack(),     click: () => wc.goBack() },
          { label: 'Вперёд',   enabled: wc.canGoForward(),  click: () => wc.goForward() },
          { label: 'Обновить',                               click: () => wc.reload() },
        );
      }

      // Инспектор — всегда в конце; inspectElement подсвечивает элемент под курсором.
      items.push({ type: 'separator' });
      items.push({
        label: 'Просмотреть код',
        click: () => {
          if (!wc.isDevToolsOpened()) wc.openDevTools({ mode: 'detach' });
          wc.inspectElement(p.x, p.y);
        },
      });

      Menu.buildFromTemplate(items).popup({ window: this.win });
    });

    this.registerHotkeyHandler(wc);
  }

  // ── Активация: показываем нужную вьюху, прячем остальные ──
  activate(id: string) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;

    // Пробуждаем вкладку, если она спит (до любой логики с view).
    if (tab.sleeping) this.wakeTab(id);

    // Останавливаем поиск на уходящей вкладке перед переключением.
    if (this.activeId !== id) {
      const prev = this.tabs.find((t) => t.id === this.activeId);
      if (prev && this.isHttpView(prev.view)) {
        prev.view.webContents.stopFindInPage('clearSelection');
        this.lastQuery = '';
      }
      this.findBarOpen = false; // FindBar уйдёт при смене activeId в renderer'е
    }

    if (this.splitState) {
      if (id === this.splitState.leftId || id === this.splitState.rightId) {
        // Возврат к split-вкладке (из любой другой вкладки или из той же панели):
        // восстанавливаем обе панели, скрываем всё постороннее.
        // Будим только спящего участника — бодрствующего не трогаем.
        const otherId = id === this.splitState.leftId ? this.splitState.rightId : this.splitState.leftId;
        const otherTab = this.tabs.find((t) => t.id === otherId);
        if (otherTab?.sleeping) this.wakeTab(otherId);

        this.splitState.activePanel = id === this.splitState.leftId ? 'left' : 'right';
        this.activeId = id;
        const activatedTab = this.tabs.find((t) => t.id === id);
        if (activatedTab) activatedTab.lastActiveAt = Date.now();

        for (const t of this.tabs) {
          if (!this.isHttpView(t.view)) continue;
          if (t.id !== this.splitState.leftId && t.id !== this.splitState.rightId) {
            t.view.setVisible(false);
          }
        }
        this.repositionViews();
        this.onChange();
        this.focusActiveView();
        return;
      }
      // Уход на стороннюю вкладку — прячем панели, НО splitState НЕ сбрасываем:
      // split «припаркован» и восстановится при клике по любой из его вкладок.
      for (const splitId of [this.splitState.leftId, this.splitState.rightId]) {
        const splitTab = this.tabs.find((t) => t.id === splitId);
        if (splitTab && this.isHttpView(splitTab.view)) splitTab.view.setVisible(false);
      }
    }

    this.activeId = id;
    // Обновляем время последней активности.
    tab.lastActiveAt = Date.now();

    for (const t of this.tabs) {
      if (!this.isHttpView(t.view)) continue;
      if (t.id === id) {
        if (!this.errors.has(id)) {
          // Нет ошибки — показываем и позиционируем.
          const children = this.win.contentView.children;
          if (!children.includes(t.view)) this.win.contentView.addChildView(t.view);
          t.view.setVisible(true);
          this.applyBounds(t.view);
        } else {
          // Вкладка в ошибке — держим скрытой; React нарисует экран ошибки.
          t.view.setVisible(false);
        }
      } else {
        t.view.setVisible(false);
      }
    }
    this.onChange();
    this.focusActiveView();
  }

  // После программного переключения вкладки явно передаём OS-фокус нужному view.
  // Без этого before-input-event замолкает: Windows освобождает фокус на BrowserWindow HWND,
  // не перекидывая его на дочерние view автоматически.
  private focusActiveView(): void {
    const tab = this.tabs.find((t) => t.id === this.activeId);
    if (tab && this.isHttpView(tab.view) && !this.errors.has(this.activeId)) {
      tab.view.webContents.focus();
    } else {
      this.onFocusChromeCb();
    }
  }

  closeTab(id: string) {
    if (id === HUB_ID) return;             // хаб не закрываем
    if (this.pinnedIds.has(id)) return;    // закреплённые не закрываем через крестик

    // Закрытие вкладки, входящей в (возможно припаркованный) split.
    if (this.splitState && (id === this.splitState.leftId || id === this.splitState.rightId)) {
      const otherId = id === this.splitState.leftId ? this.splitState.rightId : this.splitState.leftId;
      const currentlyInSplit = this.activeId === this.splitState.leftId || this.activeId === this.splitState.rightId;
      if (currentlyInSplit) {
        // Split на экране: схлопываем с переключением на соседнюю панель.
        this.exitSplit(otherId);
      } else {
        // Split припаркован: просто снимаем splitState — «осиротевший» split.
        // Оставшаяся вкладка (otherId) тихо становится обычной.
        this.splitState = null;
      }
    }

    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const [tab] = this.tabs.splice(idx, 1);
    this.errors.delete(id);
    this.pinnedIds.delete(id); // на случай программного закрытия

    if (this.isHttpView(tab.view)) {
      // Живая вкладка: запоминаем URL до уничтожения webContents — для Ctrl+Shift+T.
      const url = tab.view.webContents.getURL();
      if (/^https?:\/\//i.test(url)) {
        this.closedTabs.push(url);
        if (this.closedTabs.length > CLOSED_STACK_MAX) this.closedTabs.shift();
      }
      try { this.win.contentView.removeChildView(tab.view); } catch { /* noop */ }
      (tab.view.webContents as unknown as { close?: () => void }).close?.();
    } else if (tab.sleeping) {
      // Спящая вкладка: view уже уничтожен, URL берём из sleeping-метаданных.
      const url = tab.sleeping.url;
      if (/^https?:\/\//i.test(url)) {
        this.closedTabs.push(url);
        if (this.closedTabs.length > CLOSED_STACK_MAX) this.closedTabs.shift();
      }
    }

    // если закрыли активную — переключаемся на соседнюю или хаб
    if (this.activeId === id) {
      const next = this.tabs[idx] ?? this.tabs[idx - 1] ?? this.tabs[0];
      this.activate(next.id);
    } else {
      this.onChange();
    }
  }

  reopenLastClosedTab(): void {
    const url = this.closedTabs.pop();
    if (url) this.createTab(url);
  }

  // ── Split View ────────────────────────────────────────────────────────────

  // Войти в split: текущая активная вкладка → левая панель, rightId → правая.
  // Только обычные (не закреплённые, не хаб) вкладки могут участвовать.
  enterSplit(rightId: string): void {
    const rightTab = this.tabs.find((t) => t.id === rightId);
    if (!rightTab || (!this.isHttpView(rightTab.view) && !rightTab.sleeping) || this.pinnedIds.has(rightId)) return;

    const leftId = this.activeId;
    if (leftId === rightId) return; // нельзя делать split с самим собой

    const leftTab = this.tabs.find((t) => t.id === leftId);
    if (!leftTab || (!this.isHttpView(leftTab.view) && !leftTab.sleeping) || this.pinnedIds.has(leftId)) return;

    // Пробуждаем правую вкладку если она спит (левая — активная, не спит).
    if (rightTab.sleeping) this.wakeTab(rightId);

    // Останавливаем поиск: FindBar не переживает вход в split.
    const activeWc = this.getActiveWebContents();
    if (activeWc) { activeWc.stopFindInPage('clearSelection'); this.lastQuery = ''; }
    this.findBarOpen = false;
    this.onFindCloseCb();

    // Скрываем все вьюхи, которые не участвуют в новом split.
    for (const t of this.tabs) {
      if (!this.isHttpView(t.view)) continue;
      if (t.id !== leftId && t.id !== rightId) t.view.setVisible(false);
    }

    this.splitState = { leftId, rightId, activePanel: 'left', splitRatio: 0.5 };

    // Убеждаемся, что обе вьюхи добавлены в contentView до позиционирования.
    for (const splitId of [leftId, rightId]) {
      const splitTab = this.tabs.find((t) => t.id === splitId);
      if (!splitTab || !this.isHttpView(splitTab.view)) continue;
      const children = this.win.contentView.children;
      if (!children.includes(splitTab.view)) this.win.contentView.addChildView(splitTab.view);
    }

    this.repositionViews();
    this.onChange();
    this.focusActiveView(); // фокус на левой (активной) панели
  }

  // Выйти из split, оставив keepId активной вкладкой (по умолчанию — активная панель).
  // Явный выход: splitState = null насовсем. Отличается от «ухода» (activate другой вкладки),
  // который сохраняет splitState для последующего восстановления.
  exitSplit(keepId?: string): void {
    if (!this.splitState) return;
    const { leftId, rightId, activePanel } = this.splitState;

    const currentlyInSplit = this.activeId === leftId || this.activeId === rightId;

    // Явный выход при припаркованном split (кнопка в сайдбаре, пока смотрим другую вкладку):
    // просто снимаем splitState и остаёмся там, где были. Обе вкладки и так уже скрыты.
    if (!currentlyInSplit && keepId === undefined) {
      this.splitState = null;
      this.onChange();
      return;
    }

    const stayId = keepId ?? (activePanel === 'left' ? leftId : rightId);
    const hideId = stayId === leftId ? rightId : leftId;

    this.splitState = null;

    // Останавливаем поиск и скрываем уходящую панель.
    const hideTab = this.tabs.find((t) => t.id === hideId);
    if (hideTab && this.isHttpView(hideTab.view)) {
      hideTab.view.webContents.stopFindInPage('clearSelection');
      hideTab.view.setVisible(false);
    }

    // Разворачиваем оставшуюся вкладку на всю область.
    this.activeId = stayId;
    const stayTab = this.tabs.find((t) => t.id === stayId);
    if (stayTab && this.isHttpView(stayTab.view) && !this.errors.has(stayId)) {
      const children = this.win.contentView.children;
      if (!children.includes(stayTab.view)) this.win.contentView.addChildView(stayTab.view);
      stayTab.view.setVisible(true);
      this.applyBounds(stayTab.view);
    }

    this.onChange();
    this.focusActiveView();
  }

  // Установить соотношение панелей split (вызывается при drag разделителя).
  setSplitRatio(ratio: number): void {
    if (!this.splitState) return;
    this.splitState.splitRatio = Math.max(SPLIT_RATIO_MIN, Math.min(SPLIT_RATIO_MAX, ratio));
    this.repositionViews();
  }

  // Переключить фокус между левой и правой панелью split.
  focusSplitPanel(side: 'left' | 'right'): void {
    if (!this.splitState) return;
    const newId = side === 'left' ? this.splitState.leftId : this.splitState.rightId;
    if (this.activeId === newId) return;

    // Останавливаем поиск на панели, с которой уходим.
    const prevWc = this.getActiveWebContents();
    if (prevWc) { prevWc.stopFindInPage('clearSelection'); this.lastQuery = ''; }
    this.findBarOpen = false;

    this.splitState.activePanel = side;
    this.activeId = newId;
    // Обновляем время активности новой панели.
    const tab = this.tabs.find((t) => t.id === newId);
    if (tab) tab.lastActiveAt = Date.now();
    this.onChange();
    this.focusActiveView();
  }

  // Визуальный порядок вкладок: хаб → закреплённые → обычные.
  // Совпадает с порядком секций в сайдбаре, чтобы хоткеи не расходились с UI.
  private tabsInVisualOrder(withHub: boolean): ManagedTab[] {
    const pinned = this.tabs.filter((t) => (this.isHttpView(t.view) || t.sleeping) && this.pinnedIds.has(t.id));
    const normal = this.tabs.filter((t) => (this.isHttpView(t.view) || t.sleeping) && !this.pinnedIds.has(t.id));
    if (!withHub) return [...pinned, ...normal];
    const hub = this.tabs.filter((t) => !this.isHttpView(t.view) && !t.sleeping);
    return [...hub, ...pinned, ...normal];
  }

  selectNext(): void {
    const ordered = this.tabsInVisualOrder(true);
    const idx = ordered.findIndex((t) => t.id === this.activeId);
    this.activate(ordered[(idx + 1) % ordered.length].id);
  }

  selectPrev(): void {
    const ordered = this.tabsInVisualOrder(true);
    const idx = ordered.findIndex((t) => t.id === this.activeId);
    this.activate(ordered[(idx - 1 + ordered.length) % ordered.length].id);
  }

  navigate(id: string, input: string) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    const target = this.resolveInput(input);
    if (!this.isHttpView(tab.view) && !tab.sleeping) {
      // навигация из хаба = создать настоящую вкладку
      this.createTab(target);
      return;
    }
    // Если вкладка спит — пробуждаем, потом навигируем
    if (tab.sleeping) {
      this.wakeTab(id);
      this.activate(id);
      // wakeTab уже вызвал loadURL(sleeping.url), заменяем на новый target
      const freshTab = this.tabs.find((t) => t.id === id);
      if (freshTab && this.isHttpView(freshTab.view)) freshTab.view.webContents.loadURL(target);
      return;
    }
    tab.view!.webContents.loadURL(target);
  }

  goBack(id: string) {
    const t = this.tabs.find((x) => x.id === id);
    if (this.isHttpView(t?.view ?? null) && t!.view!.webContents.canGoBack())
      t!.view!.webContents.goBack();
  }
  goForward(id: string) {
    const t = this.tabs.find((x) => x.id === id);
    if (this.isHttpView(t?.view ?? null) && t!.view!.webContents.canGoForward())
      t!.view!.webContents.goForward();
  }
  reload(id: string) {
    const t = this.tabs.find((x) => x.id === id);
    if (!this.isHttpView(t?.view ?? null)) return;
    const err = this.errors.get(id);
    // После краша renderer-процесс мёртв — reload() может не стартовать.
    // loadURL(сохранённый_url) надёжно пересоздаёт процесс.
    if (err?.type === 'crash' && err.url) {
      t!.view!.webContents.loadURL(err.url);
    } else {
      t!.view!.webContents.reload();
    }
  }

  // ── Поиск по странице ────────────────────────────────────────────────────
  private getActiveWebContents() {
    const tab = this.tabs.find((t) => t.id === this.activeId);
    return tab && this.isHttpView(tab.view) ? tab.view.webContents : null;
  }

  findInPage(query: string, forward: boolean): void {
    const wc = this.getActiveWebContents();
    if (!wc) return;
    // findNext:true = продолжить существующий поиск; false = начать новый.
    wc.findInPage(query, { forward, findNext: query === this.lastQuery });
    this.lastQuery = query;
  }

  findNext(forward: boolean): void {
    const wc = this.getActiveWebContents();
    if (!wc || !this.lastQuery) return;
    wc.findInPage(this.lastQuery, { forward, findNext: true });
  }

  stopFind(): void {
    const wc = this.getActiveWebContents();
    if (wc) wc.stopFindInPage('clearSelection');
    this.lastQuery = '';
    this.findBarOpen = false;
  }

  // ── Зум активной вкладки ──────────────────────────────────────────────────
  // Хаб пропускаем: у него нет WebContentsView.
  private adjustZoom(delta: number): void {
    const tab = this.tabs.find((t) => t.id === this.activeId);
    if (!tab || !this.isHttpView(tab.view)) return;
    const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX,
      tab.view.webContents.getZoomFactor() + delta));
    tab.view.webContents.setZoomFactor(next);
  }

  private resetZoom(): void {
    const tab = this.tabs.find((t) => t.id === this.activeId);
    if (!tab || !this.isHttpView(tab.view)) return;
    tab.view.webContents.setZoomFactor(1.0);
  }

  // ── Ctrl+1..9: переключиться на вкладку по номеру ──
  // Счёт в визуальном порядке (закреплённые сверху, потом обычные), без хаба.
  // Ctrl+9 = всегда последняя (стандарт браузеров), Ctrl+1..8 = по индексу.
  selectByIndex(n: number): void {
    const real = this.tabsInVisualOrder(false); // без хаба
    if (real.length === 0) return;
    const target = n === 9 ? real[real.length - 1] : real[n - 1];
    if (target) this.activate(target.id);
  }

  // DevTools активной вкладки в отдельном окне (не путать с DevTools хром-слоя).
  private toggleActiveDevTools(): void {
    const wc = this.getActiveWebContents();
    if (!wc) return;
    if (wc.isDevToolsOpened()) {
      wc.closeDevTools();
    } else {
      wc.openDevTools({ mode: 'detach' });
    }
  }

  // ── Хоткеи: перехватываем до рендерера, чтобы работало и на сайтах ──
  // Вызывается для каждой новой вкладки (из wirePageEvents) и для chromeView
  // (из main.ts), чтобы покрыть и страницы, и хаб.
  //
  // ВСЕ хоткеи матчим по input.code (физическая позиция клавиши), а НЕ по input.key.
  // input.key зависит от раскладки: на русской F→«а», W→«ц» и т.д.
  registerHotkeyHandler(wc: WebContents): void {
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const { code, shift } = input;

      // ── Без Ctrl ──────────────────────────────────────────────────────────
      if (!input.control) {
        // Esc: приоритет — закрыть FindBar; иначе — остановить загрузку страницы.
        if (code === 'Escape' && !shift) {
          if (this.findBarOpen) {
            event.preventDefault();
            this.findBarOpen = false;   // немедленный сброс, чтобы второй Esc не зацикливался
            this.onFindCloseCb();
          } else {
            const active = this.getActiveWebContents();
            if (active) { event.preventDefault(); active.stop(); }
          }
          return;
        }
        // F5: обновить активную вкладку.
        if (code === 'F5' && !shift) {
          event.preventDefault();
          this.reload(this.activeId);
          return;
        }
        // F12: DevTools активной вкладки (открыть / закрыть).
        if (code === 'F12' && !shift && !input.alt) {
          event.preventDefault();
          this.toggleActiveDevTools();
          return;
        }
        // Alt+← / Alt+→: назад / вперёд (клавиатурная альтернатива Mouse4/Mouse5).
        // Боковые кнопки мыши (XButton1/2) обрабатываются нативно через WebContentsViewAura.
        if (code === 'ArrowLeft' && input.alt && !shift) {
          event.preventDefault();
          this.goBack(this.activeId);
          return;
        }
        if (code === 'ArrowRight' && input.alt && !shift) {
          event.preventDefault();
          this.goForward(this.activeId);
          return;
        }
        return;
      }

      // ── Ctrl+... ──────────────────────────────────────────────────────────
      if (code === 'KeyT' && !shift) {
        event.preventDefault();
        this.activate(HUB_ID);             // Ctrl+T: открыть хаб
      } else if (code === 'KeyT' && shift) {
        event.preventDefault();
        this.reopenLastClosedTab();         // Ctrl+Shift+T: восстановить закрытую
      } else if (code === 'KeyW' && !shift) {
        event.preventDefault();
        this.closeTab(this.activeId);       // Ctrl+W: закрыть активную (хаб защищён)
      } else if (code === 'Tab' && !shift) {
        event.preventDefault();
        this.selectNext();                  // Ctrl+Tab: следующая вкладка
      } else if (code === 'Tab' && shift) {
        event.preventDefault();
        this.selectPrev();                  // Ctrl+Shift+Tab: предыдущая вкладка
      } else if (code === 'Equal' || code === 'NumpadAdd') {
        event.preventDefault();
        this.adjustZoom(ZOOM_STEP);         // Ctrl+= / Ctrl++
      } else if (code === 'Minus' || code === 'NumpadSubtract') {
        event.preventDefault();
        this.adjustZoom(-ZOOM_STEP);        // Ctrl+-
      } else if (code === 'Digit0' || code === 'Numpad0') {
        event.preventDefault();
        this.resetZoom();                   // Ctrl+0: сбросить к 100%
      } else if (code === 'KeyF' && !shift) {
        event.preventDefault();
        this.findBarOpen = true;
        this.onFindOpenCb();                // Ctrl+F: открыть / сфокусировать FindBar
      } else if (code === 'KeyR' && !shift) {
        event.preventDefault();
        this.reload(this.activeId);         // Ctrl+R: обновить страницу
      } else if (code === 'KeyL' && !shift) {
        event.preventDefault();
        this.onOmniboxFocusCb();            // Ctrl+L: фокус в омнибокс
      } else if (code === 'KeyI' && shift) {
        event.preventDefault();
        this.toggleActiveDevTools();        // Ctrl+Shift+I: DevTools (альтернатива F12)
      } else if (code.startsWith('Digit') && !shift) {
        const n = parseInt(code[5]!, 10);   // 'Digit1'→1 … 'Digit9'→9
        if (n >= 1 && n <= 9) {
          event.preventDefault();
          this.selectByIndex(n);            // Ctrl+1..8: вкладка по номеру; Ctrl+9: последняя
        }
      }
    });
  }

  // ── Показать / скрыть вьюху активной вкладки ──
  // revealView: вызывается после did-navigate (успешная загрузка) — показываем.
  private revealView(id: string): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab || !this.isHttpView(tab.view)) return;
    const children = this.win.contentView.children;
    if (!children.includes(tab.view)) this.win.contentView.addChildView(tab.view);
    tab.view.setVisible(true);
    // В split: перепозиционируем обе панели (bounds мог прийти раньше вьюхи).
    if (this.splitState && (id === this.splitState.leftId || id === this.splitState.rightId)) {
      this.repositionViews();
    } else {
      this.applyBounds(tab.view);
    }
  }

  // hideView: вызывается при ошибке/краше — скрываем, React нарисует экран ошибки.
  private hideView(id: string): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab || !this.isHttpView(tab.view)) return;
    tab.view.setVisible(false);
  }

  // ── Геометрия "дырки" под контент ──
  setContentBounds(b: ContentBounds) {
    this.bounds = b;
    this.repositionViews();
  }

  // Позиционирует видимые вьюхи согласно текущему режиму (single / split).
  // «Припаркованный» split (splitState есть, но активна другая вкладка) ведёт
  // себя как single: позиционируем только текущую активную вкладку.
  private repositionViews(): void {
    const currentlyInSplit = !!this.splitState
      && (this.activeId === this.splitState.leftId || this.activeId === this.splitState.rightId);

    if (!currentlyInSplit) {
      const active = this.tabs.find((t) => t.id === this.activeId);
      if (active && this.isHttpView(active.view) && !this.errors.has(this.activeId)) {
        this.applyBounds(active.view);
      }
      return;
    }
    // Split: разделяем bounds по текущему splitRatio с SPLIT_GAP-зазором.
    // splitState гарантированно не null: currentlyInSplit включает !!this.splitState.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const { leftId, rightId, splitRatio } = this.splitState!;
    const leftWidth = Math.floor((this.bounds.width - SPLIT_GAP) * splitRatio);
    const leftB:  ContentBounds = {
      x: this.bounds.x, y: this.bounds.y,
      width: leftWidth, height: this.bounds.height,
    };
    const rightB: ContentBounds = {
      x: this.bounds.x + leftWidth + SPLIT_GAP, y: this.bounds.y,
      width: this.bounds.width - leftWidth - SPLIT_GAP, height: this.bounds.height,
    };
    this.applySplitBounds(leftId, leftB);
    this.applySplitBounds(rightId, rightB);
  }

  // Позиционирует одну split-панель; при ошибке скрывает вьюху (React рисует TabError).
  private applySplitBounds(id: string, b: ContentBounds): void {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab || !this.isHttpView(tab.view)) return;
    if (this.errors.has(id)) { tab.view.setVisible(false); return; }
    const children = this.win.contentView.children;
    if (!children.includes(tab.view)) this.win.contentView.addChildView(tab.view);
    tab.view.setVisible(true);
    tab.view.setBounds({
      x: Math.round(b.x), y: Math.round(b.y),
      width: Math.max(0, Math.round(b.width)),
      height: Math.max(0, Math.round(b.height)),
    });
  }

  private applyBounds(view: WebContentsView) {
    const { x, y, width, height } = this.bounds;
    view.setBounds({
      x: Math.round(x), y: Math.round(y),
      width: Math.max(0, Math.round(width)),
      height: Math.max(0, Math.round(height)),
    });
  }
}
