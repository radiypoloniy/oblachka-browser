import { WebContentsView, BrowserWindow, Menu, clipboard } from 'electron';
import type { MenuItemConstructorOptions, WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import type { TabState, ContentBounds } from '../shared/ipc';

const CLOSED_STACK_MAX = 10;

const ZOOM_MIN  = 0.5;
const ZOOM_MAX  = 2.5;
const ZOOM_STEP = 0.1; // 10% за шаг, как в Chrome

// Обрезает длинный текст для лейблов меню, чтобы не растягивало окно.
function truncate(text: string, max = 40): string {
  const s = text.trim().replace(/\s+/g, ' ');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

// Поисковик по умолчанию — DuckDuckGo (приватный), как в спеке (3.2).
const SEARCH_URL = (q: string) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;

// id вкладки-хаба фиксирован: это НЕ WebContentsView, а наш React-экран.
export const HUB_ID = 'hub';

interface ManagedTab {
  id: string;
  view: WebContentsView | null; // null = хаб (нет реальной веб-страницы)
}

export class TabManager {
  private win: BrowserWindow;
  private tabs: ManagedTab[] = [];
  private activeId: string = HUB_ID;
  private bounds: ContentBounds = { x: 0, y: 0, width: 0, height: 0 };
  private onChange: () => void;
  private closedTabs: string[] = []; // стек URL закрытых вкладок для Ctrl+Shift+T

  constructor(win: BrowserWindow, onChange: () => void) {
    this.win = win;
    this.onChange = onChange;
    // Вкладка-хаб существует всегда и первой.
    this.tabs.push({ id: HUB_ID, view: null });
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
      if (!this.isHttpView(t.view)) {
        return {
          id: t.id, isActive: t.id === this.activeId,
          url: '', title: 'Новая вкладка · AI-хаб',
          faviconUrl: null, isLoading: false,
          canGoBack: false, canGoForward: false, isHub: true,
        };
      }
      const wc = t.view.webContents;
      return {
        id: t.id,
        isActive: t.id === this.activeId,
        url: wc.getURL(),
        title: wc.getTitle() || wc.getURL() || 'Загрузка…',
        faviconUrl: (wc as unknown as { _oblakoFavicon?: string })._oblakoFavicon ?? null,
        isLoading: wc.isLoadingMainFrame(),
        canGoBack: wc.canGoBack(),
        canGoForward: wc.canGoForward(),
        isHub: false,
      };
    });
  }

  getActiveId() { return this.activeId; }

  // ── Создание новой вкладки с реальной страницей ──
  createTab(rawUrl?: string): string {
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        // Жёсткая изоляция: страница не имеет доступа к Node.
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    this.tabs.push({ id, view });
    this.wirePageEvents(id, view);

    const target = this.resolveInput(rawUrl ?? 'about:blank');
    if (target !== 'about:blank') view.webContents.loadURL(target);

    this.activate(id);
    return id;
  }

  private wirePageEvents(id: string, view: WebContentsView) {
    const wc = view.webContents;
    const notify = () => this.onChange();

    // Любое изменение состояния страницы -> пересобрать UI.
    wc.on('did-start-loading', notify);
    wc.on('did-stop-loading', notify);
    wc.on('did-navigate', notify);
    wc.on('did-navigate-in-page', notify);
    wc.on('page-title-updated', notify);

    wc.on('page-favicon-updated', (_e, favicons) => {
      (wc as unknown as { _oblakoFavicon?: string })._oblakoFavicon = favicons?.[0];
      notify();
    });

    // Политика окон: target=_blank / window.open -> открываем как НОВУЮ ВКЛАДКУ,
    // а не как отдельное окно Electron (спека 3.7). Иначе сайты плодят окна.
    wc.setWindowOpenHandler(({ url }) => {
      this.createTab(url);
      return { action: 'deny' };
    });

    // Падение рендер-процесса вкладки — не оставляем мёртвую вьюху молча.
    wc.on('render-process-gone', () => {
      // Прототип: просто помечаем перезагрузкой. Полноценная страница
      // "вкладка упала, перезагрузить" — задача Этапа 1 (см. 3.7), здесь TODO.
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

      Menu.buildFromTemplate(items).popup({ window: this.win });
    });

    this.registerHotkeyHandler(wc);
  }

  // ── Активация: показываем нужную вьюху, прячем остальные ──
  activate(id: string) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    this.activeId = id;

    for (const t of this.tabs) {
      if (!this.isHttpView(t.view)) continue;
      if (t.id === id) {
        // добавляем во вьюхи окна, если ещё не там
        const children = this.win.contentView.children;
        if (!children.includes(t.view)) this.win.contentView.addChildView(t.view);
        t.view.setVisible(true);
        this.applyBounds(t.view);
      } else {
        t.view.setVisible(false);
      }
    }
    this.onChange();
  }

  closeTab(id: string) {
    if (id === HUB_ID) return; // хаб не закрываем
    const idx = this.tabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    const [tab] = this.tabs.splice(idx, 1);
    if (this.isHttpView(tab.view)) {
      // Запоминаем URL до уничтожения webContents — для Ctrl+Shift+T.
      const url = tab.view.webContents.getURL();
      if (/^https?:\/\//i.test(url)) {
        this.closedTabs.push(url);
        if (this.closedTabs.length > CLOSED_STACK_MAX) this.closedTabs.shift();
      }
      try { this.win.contentView.removeChildView(tab.view); } catch { /* noop */ }
      (tab.view.webContents as unknown as { close?: () => void }).close?.();
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

  selectNext(): void {
    const idx = this.tabs.findIndex((t) => t.id === this.activeId);
    this.activate(this.tabs[(idx + 1) % this.tabs.length].id);
  }

  selectPrev(): void {
    const idx = this.tabs.findIndex((t) => t.id === this.activeId);
    this.activate(this.tabs[(idx - 1 + this.tabs.length) % this.tabs.length].id);
  }

  navigate(id: string, input: string) {
    const tab = this.tabs.find((t) => t.id === id);
    if (!tab) return;
    const target = this.resolveInput(input);
    if (!this.isHttpView(tab.view)) {
      // навигация из хаба = создать настоящую вкладку
      this.createTab(target);
      return;
    }
    tab.view.webContents.loadURL(target);
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
    if (this.isHttpView(t?.view ?? null)) t!.view!.webContents.reload();
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

  // ── Хоткеи: перехватываем до рендерера, чтобы работало и на сайтах ──
  // Вызывается для каждой новой вкладки (из wirePageEvents) и для chromeView
  // (из main.ts), чтобы покрыть и страницы, и хаб.
  registerHotkeyHandler(wc: WebContents): void {
    wc.on('before-input-event', (event, input) => {
      if (!input.control || input.type !== 'keyDown') return;
      const key = input.key.toLowerCase();
      const shift = input.shift;

      if (key === 't' && !shift) {
        event.preventDefault();
        this.activate(HUB_ID);           // Ctrl+T: открыть хаб
      } else if (key === 't' && shift) {
        event.preventDefault();
        this.reopenLastClosedTab();       // Ctrl+Shift+T: восстановить закрытую
      } else if (key === 'w' && !shift) {
        event.preventDefault();
        this.closeTab(this.activeId);     // Ctrl+W: закрыть активную (хаб защищён)
      } else if (key === 'tab' && !shift) {
        event.preventDefault();
        this.selectNext();                // Ctrl+Tab: следующая вкладка
      } else if (key === 'tab' && shift) {
        event.preventDefault();
        this.selectPrev();                // Ctrl+Shift+Tab: предыдущая вкладка
      // Зум: используем code (layout-independent), чтобы не зависеть от раскладки.
      // Equal/NumpadAdd покрывают и = и +; оба варианта Ctrl+Plus.
      } else if (input.code === 'Equal' || input.code === 'NumpadAdd') {
        event.preventDefault();
        this.adjustZoom(ZOOM_STEP);       // Ctrl+= / Ctrl++
      } else if (input.code === 'Minus' || input.code === 'NumpadSubtract') {
        event.preventDefault();
        this.adjustZoom(-ZOOM_STEP);      // Ctrl+-
      } else if (input.code === 'Digit0' || input.code === 'Numpad0') {
        event.preventDefault();
        this.resetZoom();                 // Ctrl+0: сбросить к 100%
      }
    });
  }

  // ── Геометрия "дырки" под контент ──
  setContentBounds(b: ContentBounds) {
    this.bounds = b;
    const active = this.tabs.find((t) => t.id === this.activeId);
    if (active && this.isHttpView(active.view))
      this.applyBounds(active.view);
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
