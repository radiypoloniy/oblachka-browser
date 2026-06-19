// Единый источник правды по форме данных, которыми обмениваются
// renderer (хром-UI) и main (движок вкладок). Импортируется обеими сторонами.

export interface TabErrorState {
  type: 'load' | 'crash';
  code: number;   // errorCode из did-fail-load; 0 при краше
  url: string;    // URL, который не открылся — для показа и retry
}

export interface TabState {
  id: string;
  isActive: boolean;    // true = эта вкладка сейчас активна в main-процессе
  tabError: TabErrorState | null; // null = нет ошибки
  url: string;          // текущий реальный URL вкладки
  title: string;        // заголовок страницы (document.title)
  faviconUrl: string | null;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isHub: boolean;       // true = вкладка-хаб (наш UI), без WebContentsView
}

// Геометрия "дырки" под контент в координатах окна (CSS-пиксели).
// Renderer измеряет область и сообщает main, куда класть WebContentsView.
export interface ContentBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Канал renderer -> main (invoke/send). Имена держим в одном месте.
export const IPC = {
  // Запросы (renderer -> main, ожидают ответ)
  TABS_GET_ALL: 'tabs:get-all',
  TAB_CREATE: 'tab:create',
  TAB_CLOSE: 'tab:close',
  TAB_ACTIVATE: 'tab:activate',
  TAB_NAVIGATE: 'tab:navigate',     // omnibox: URL или поисковый запрос
  TAB_GO_BACK: 'tab:go-back',
  TAB_GO_FORWARD: 'tab:go-forward',
  TAB_RELOAD: 'tab:reload',
  CONTENT_SET_BOUNDS: 'content:set-bounds',
  WINDOW_SET_OVERLAY: 'window:set-overlay', // обновить цвет иконок titleBarOverlay

  // События (main -> renderer, односторонние)
  TABS_CHANGED: 'tabs:changed',     // прислать весь актуальный список TabState[]
} as const;

// Параметры titleBarOverlay для динамического обновления (смена темы).
export type TitleBarOpts = { color?: string; symbolColor?: string; height?: number };

// Тип API, который preload пробрасывает в window.oblako
export interface OblakoApi {
  getAllTabs(): Promise<TabState[]>;
  createTab(url?: string): Promise<string>;       // вернёт id новой вкладки
  closeTab(id: string): Promise<void>;
  activateTab(id: string): Promise<void>;
  navigate(id: string, input: string): Promise<void>;
  goBack(id: string): Promise<void>;
  goForward(id: string): Promise<void>;
  reload(id: string): Promise<void>;
  setContentBounds(bounds: ContentBounds): Promise<void>;
  setTitleBarOverlay(opts: TitleBarOpts): Promise<void>;
  onTabsChanged(cb: (tabs: TabState[]) => void): () => void; // вернёт unsubscribe
}
