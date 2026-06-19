import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Toolbar from './components/Toolbar';
import Hub from './components/Hub';
import TabError from './components/TabError';
import FindBar from './components/FindBar';
import type { TabState, FindResult } from '../shared/ipc';

const HUB_ID = 'hub';

export default function App() {
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeId, setActiveId] = useState(HUB_ID);
  const [vpnOn, setVpnOn] = useState(true);
  const [dark, setDark] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findResult, setFindResult] = useState<FindResult | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);

  const active = tabs.find((t) => t.id === activeId);
  const isHub = active?.isHub ?? true;
  const tabError = active?.tabError ?? null;

  // Refs для использования актуальных значений внутри IPC-колбэков (замыкания).
  const isHubRef = useRef(isHub);
  isHubRef.current = isHub;
  const findOpenRef = useRef(findOpen);
  findOpenRef.current = findOpen;

  // Тема
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark]);

  // Синхронизируем фон и цвет иконок зоны системных кнопок с темой.
  // color = --app-bg темы (прозрачность не работает: Windows рисует backgroundColor окна,
  // а не web-контент, что даёт видимую плашку при несовпадении).
  useEffect(() => {
    void window.oblako.setTitleBarOverlay({
      color: dark ? '#15131A' : '#E7E9F4',
      symbolColor: dark ? '#EAE8E3' : '#46443F',
    });
  }, [dark]);

  // Подписка на изменения вкладок из main + первичная загрузка.
  // snapshot теперь несёт isActive — синхронизируем activeId из main,
  // чтобы хоткеи и любые переключения из main отражались в UI немедленно.
  useEffect(() => {
    const applySnapshot = (t: TabState[]) => {
      setTabs(t);
      const active = t.find((x) => x.isActive);
      if (active) setActiveId(active.id);
    };
    let mounted = true;
    window.oblako.getAllTabs().then((t) => { if (mounted) applySnapshot(t); });
    const unsub = window.oblako.onTabsChanged(applySnapshot);
    return () => { mounted = false; unsub(); };
  }, []);

  // Подписки на события поиска — один раз на маунт.
  useEffect(() => {
    const unsubResult = window.oblako.onFindResult((r) => setFindResult(r));

    const unsubOpen = window.oblako.onFindOpen(() => {
      if (isHubRef.current) return; // поиск не работает на хабе
      if (!findOpenRef.current) {
        setFindOpen(true);           // открыть панель; autoFocus сфокусирует input
      } else {
        // Панель уже открыта — выделить текст в поле (стандарт браузеров)
        findInputRef.current?.focus();
        findInputRef.current?.select();
      }
    });

    const unsubClose = window.oblako.onFindClose(() => {
      setFindOpen(false);
      setFindResult(null);
      void window.oblako.findStop();
    });

    return () => { unsubResult(); unsubOpen(); unsubClose(); };
  }, []);

  // Закрыть панель при переключении вкладки (stopFindInPage уже вызван в TabManager).
  useEffect(() => {
    setFindOpen(false);
    setFindResult(null);
  }, [activeId]);

  // ── Главное: измеряем "дырку" под контент и сообщаем main, ──
  // ── куда положить WebContentsView активной вкладки.       ──
  const pushBounds = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    window.oblako.setContentBounds({
      x: r.left, y: r.top, width: r.width, height: r.height,
    });
  }, []);

  useLayoutEffect(() => {
    pushBounds();
    const ro = new ResizeObserver(pushBounds);
    if (contentRef.current) ro.observe(contentRef.current);
    window.addEventListener('resize', pushBounds);
    return () => { ro.disconnect(); window.removeEventListener('resize', pushBounds); };
  }, [pushBounds]);

  // когда переключаемся между хабом и сайтом, геометрия дырки та же,
  // но main должен переотобразить вьюху — пушим bounds ещё раз.
  useEffect(() => { pushBounds(); }, [activeId, isHub, pushBounds]);

  const select = (id: string) => { setActiveId(id); window.oblako.activateTab(id); };
  const newTab = () => { setActiveId(HUB_ID); window.oblako.activateTab(HUB_ID); };
  const close = (id: string) => { window.oblako.closeTab(id); };

  const submit = async (input: string) => {
    if (isHub) {
      const id = await window.oblako.createTab(input);
      setActiveId(id);
    } else {
      window.oblako.navigate(activeId, input);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', overflow: 'hidden' }}>
      <Sidebar
        tabs={tabs} activeId={activeId}
        onSelect={select} onClose={close} onNewTab={newTab}
      />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Toolbar
          tab={active} vpnOn={vpnOn} dark={dark}
          onToggleVpn={() => setVpnOn((v) => !v)}
          onToggleDark={() => setDark((d) => !d)}
          onBack={() => window.oblako.goBack(activeId)}
          onForward={() => window.oblako.goForward(activeId)}
          onReload={() => window.oblako.reload(activeId)}
          onSubmit={submit}
        />
        {/* Контент-зона. Варианты: хаб, страница ошибки, или "дырка" (WebContentsView). */}
        <div ref={contentRef} style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {isHub
            ? <Hub onSubmit={submit} />
            : tabError
              ? <TabError
                  error={tabError}
                  url={active?.url ?? ''}
                  onRetry={() => window.oblako.reload(activeId)}
                />
              : null /* реальную страницу рисует main через WebContentsView */}
          {/* Панель поиска: абсолютный оверлей поверх WebContentsView. */}
          {findOpen && !isHub && !tabError && (
            <FindBar
              ref={findInputRef}
              result={findResult}
              onSearch={(q, fwd) => { void window.oblako.findStart(q, fwd); }}
              onNext={(fwd) => { void window.oblako.findNext(fwd); }}
              onStop={() => { void window.oblako.findStop(); setFindResult(null); }}
              onClose={() => {
                void window.oblako.findStop();
                setFindResult(null);
                setFindOpen(false);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
