import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import Toolbar from './components/Toolbar';
import Hub from './components/Hub';
import type { TabState } from '../shared/ipc';

const HUB_ID = 'hub';

export default function App() {
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeId, setActiveId] = useState(HUB_ID);
  const [vpnOn, setVpnOn] = useState(true);
  const [dark, setDark] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  const active = tabs.find((t) => t.id === activeId);
  const isHub = active?.isHub ?? true;

  // Тема
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  }, [dark]);

  // Подписка на изменения вкладок из main + первичная загрузка.
  useEffect(() => {
    let mounted = true;
    window.oblako.getAllTabs().then((t) => { if (mounted) setTabs(t); });
    const unsub = window.oblako.onTabsChanged((t) => setTabs(t));
    return () => { mounted = false; unsub(); };
  }, []);

  // Активная вкладка определяется main-процессом, но мы держим локальную копию
  // для мгновенного отклика UI. Синхронизируем при изменении списка, если
  // активная вкладка пропала (закрыта).
  useEffect(() => {
    if (tabs.length && !tabs.some((t) => t.id === activeId)) {
      setActiveId(tabs[tabs.length - 1].id);
    }
  }, [tabs, activeId]);

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
        {/* Контент-зона. Когда активен сайт — здесь "дырка": WebContentsView
            кладётся main-процессом поверх этого места. Когда хаб — рисуем Hub. */}
        <div ref={contentRef} style={{ flex: 1, minHeight: 0, position: 'relative' }}>
          {isHub
            ? <Hub onSubmit={submit} />
            : null /* реальную страницу рисует main через WebContentsView */}
        </div>
      </div>
    </div>
  );
}
