import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Sparkles, ChevronLeft, ChevronRight, ChevronDown, X, MoreHorizontal, ArrowUpRight } from 'lucide-react';
import { usePageInsights } from '../usePageInsights';
import './pageInsights.css';

export function PageInsights({ tabId, visible }: { tabId: string | null; visible: boolean }) {
  const { config, state: current, update } = usePageInsights(visible);
  const state = current?.tabId === tabId ? current : null;
  const cards = state?.cards ?? [];
  const track = useRef<HTMLDivElement>(null);
  const lastSlide = useRef(0);
  const menu = useRef<HTMLDetailsElement>(null);
  const [slide, setSlide] = useState(0);
  const [error, setError] = useState('');
  const signature = `${tabId}:${cards.map(c => c.title).join('|')}`;
  useEffect(() => { lastSlide.current = 0; setSlide(0); track.current?.scrollTo({ left: 0 }); }, [signature]);
  useLayoutEffect(() => {
    const node = track.current?.children[lastSlide.current] as HTMLElement | undefined;
    if (!config.collapsed && node) track.current?.scrollTo({ left: node.offsetLeft });
  }, [config.collapsed]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (menu.current && !menu.current.contains(event.target as Node)) menu.current.open = false; };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menu.current?.open) { event.preventDefault(); event.stopPropagation(); menu.current.open = false; }
    };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, []);
  const save = (patch: Parameters<typeof update>[0]) => {
    setError(''); void update(patch).catch(() => setError('Не удалось сохранить настройку'));
  };
  const move = (index: number) => {
    const node = track.current?.children[index] as HTMLElement | undefined;
    if (node && track.current) track.current.scrollTo({ left: node.offsetLeft,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  if (!config.enabled) return <section className="page-insights page-insights-off" aria-label="Подсказки по странице">
    <span><Sparkles size={14} /> Автоподсказки выключены</span>
    <button onClick={() => save({ enabled: true })}>Включить</button>
    {error && <small role="alert">{error}</small>}
  </section>;
  return <section className="page-insights" aria-label="Важное на странице">
    <header className="page-insights-heading">
      <button className="page-insights-title" onClick={() => save({ collapsed: !config.collapsed })}
        aria-expanded={!config.collapsed} aria-controls="page-insights-body">
        <Sparkles size={15} /><span>Важное на странице</span>
        {cards.length > 0 && <small>{cards.length}</small>}
        {config.collapsed && <ChevronDown size={15} />}
      </button>
      <details className="page-insights-menu" ref={menu}>
        <summary aria-label="Настройки автоподсказок"><MoreHorizontal size={18} /></summary>
        <div>
          <label><input type="checkbox" checked={config.enabled} onChange={e => save({ enabled: e.target.checked })} /> Автоподсказки</label>
          <button onClick={() => window.aiPanel.openSettings('ai')}>Модель и лимиты</button>
        </div>
      </details>
      {!config.collapsed && <button className="page-insights-icon" aria-label="Свернуть все карточки"
        onClick={() => save({ collapsed: true })}><X size={15} /></button>}
    </header>
    {error && <small role="alert">{error}</small>}
    {!config.collapsed && <div id="page-insights-body">
      {cards.length > 0 && <>
        <div className={`page-insights-track${state?.phase !== 'ready' ? ' is-stale' : ''}`} ref={track}
          onScroll={() => {
            const first = track.current?.firstElementChild as HTMLElement | null;
            if (first && track.current) {
              lastSlide.current = Math.min(cards.length - 1, Math.round(track.current.scrollLeft / (first.offsetWidth + 8)));
              setSlide(lastSlide.current);
            }
          }}>
          {cards.map((card, i) => <article className="page-insight" data-tone={i % 3} key={`${i}:${card.title}`}>
            <span className="page-insight-kind">{card.kind}</span>
            <h3>{card.title}</h3><p>{card.text}</p>
            <button disabled={state?.phase !== 'ready'} onClick={() => window.aiPanel.showInsightSource(i)}>
              Показать на странице <ArrowUpRight size={14} />
            </button>
          </article>)}
        </div>
        <nav className="page-insights-navigation" aria-label="Карточки">
          <span>{slide + 1} / {cards.length}</span>
          <div className="page-insights-dots">{cards.map((_, i) => <button key={i}
            aria-label={`Карточка ${i + 1}`} aria-current={slide === i ? 'true' : undefined} onClick={() => move(i)} />)}</div>
          <button className="page-insights-icon" disabled={slide === 0} aria-label="Предыдущая карточка" onClick={() => move(slide - 1)}><ChevronLeft size={16} /></button>
          <button className="page-insights-icon" disabled={slide === cards.length - 1} aria-label="Следующая карточка" onClick={() => move(slide + 1)}><ChevronRight size={16} /></button>
        </nav>
      </>}
      <div className="page-insights-status" role="status">
        <span>{state?.note || 'Проверяю страницу…'}</span>
        {state?.via && <span className="page-insights-route"><i data-local={state.via.local} />{state.via.label}</span>}
      </div>
      {state?.phase === 'setup' && <div className="page-insights-actions">
        {config.connectionId ? <button onClick={() => window.aiPanel.openSettings('ai')}>Настроить подключение</button> : <>
          <button onClick={() => window.aiPanel.openSettings('ai')}>Установить модель</button>
          <button onClick={() => window.aiPanel.openSettings('ai')}>Подключить облако</button>
        </>}
      </div>}
      {(state?.phase === 'sleep' || state?.phase === 'error' || state?.phase === 'stale' || state?.phase === 'idle' || (state?.phase === 'ready' && !cards.length)) && <div className="page-insights-actions">
        <button onClick={() => window.aiPanel.runPageInsights()}>Разобрать страницу</button>
      </div>}
    </div>}
  </section>;
}
