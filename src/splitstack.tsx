import { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Check, X } from 'lucide-react';
import { StandaloneLanguageProvider, useLanguage } from './i18n';
import type { SplitStackMenuData } from '../shared/ipc';
import './styles/global.css';

declare global {
  interface Window {
    splitStack: {
      get(): Promise<SplitStackMenuData | null>;
      select(id: string): Promise<void>;
      forget(id: string): Promise<void>;
      close(): void;
      onData(cb: (data: SplitStackMenuData) => void): () => void;
    };
  }
}

function SplitStack() {
  const [data, setData] = useState<SplitStackMenuData | null>(null);
  const { language } = useLanguage();
  const en = language === 'en';

  useEffect(() => {
    void window.splitStack.get().then(setData);
    return window.splitStack.onData(setData);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.splitStack.close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!data) return null;
  return <div className="stack-card">
    <div className="stack-heading">
      <span>{en ? 'Tabs in this pane' : 'Вкладки этой половины'}</span>
      <button className="close" onClick={() => window.splitStack.close()} aria-label={en ? 'Close' : 'Закрыть'}><X size={15} /></button>
    </div>
    <div className="stack-list">
      {data.entries.map((tab, index) => <div className="stack-row" key={tab.id}>
        <button className="stack-open" onClick={() => { if (index > 0) void window.splitStack.select(tab.id); }} title={tab.title || tab.url}>
          <span className="stack-icon">{tab.faviconUrl ? <img src={tab.faviconUrl} alt="" /> : '◫'}</span>
          <span className="stack-text"><strong>{tab.title || tab.url || (en ? 'Tab' : 'Вкладка')}</strong><small>{index === 0 ? (en ? 'On screen' : 'На экране') : tab.url}</small></span>
          {index === 0 && <Check size={14} className="check" />}
        </button>
        <button className="stack-remove" onClick={() => void window.splitStack.forget(tab.id)} title={en ? 'Remove from split, keep tab open' : 'Убрать из split, оставить вкладку открытой'} aria-label={`${en ? 'Remove from split' : 'Убрать из split'}: ${tab.title || tab.url}`}><X size={14} /></button>
      </div>)}
    </div>
    <div className="stack-foot">{en ? '× removes from the pane; the tab stays in the sidebar' : '× убирает из пары, но оставляет вкладку в сайдбаре'}</div>
  </div>;
}

const style = document.createElement('style');
style.textContent = `
  *{box-sizing:border-box}body{font-family:var(--font-ui,system-ui,sans-serif);color:var(--text-strong)}button{font:inherit}
  .stack-card{width:300px;margin:10px;background:var(--surface-solid);border:1px solid var(--divider);border-radius:16px;box-shadow:var(--shadow-card);overflow:hidden}
  .stack-heading{height:44px;padding:0 11px 0 15px;display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:650;color:var(--text-strong)}
  .close,.stack-remove{border:0;background:transparent;color:var(--text-muted);display:grid;place-items:center;border-radius:8px;cursor:default}
  .close{width:26px;height:26px}.close:hover,.stack-remove:hover{background:var(--surface-hover);color:var(--text-strong)}
  .stack-list{max-height:306px;overflow:auto;padding:0 6px 5px}.stack-row{display:flex;align-items:center;border-radius:10px}.stack-row:hover{background:var(--surface-hover)}
  .stack-open{min-width:0;flex:1;display:flex;align-items:center;gap:9px;text-align:left;background:transparent;border:0;padding:7px 8px;color:var(--text-strong);cursor:default}
  .stack-icon{width:22px;height:22px;flex:none;border-radius:7px;background:var(--surface-sunken);display:grid;place-items:center;font-size:12px}.stack-icon img{width:16px;height:16px;object-fit:contain}
  .stack-text{min-width:0;flex:1}.stack-text strong,.stack-text small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.stack-text strong{font-size:12px;font-weight:600}.stack-text small{font-size:10px;color:var(--text-muted)}
  .check{color:var(--accent);flex:none}.stack-remove{width:24px;height:24px;flex:none;margin-right:6px}
  .stack-foot{border-top:1px solid var(--divider);padding:9px 14px 11px;font-size:10px;color:var(--text-muted)}
`;
document.head.appendChild(style);
ReactDOM.createRoot(document.getElementById('root')!).render(<StandaloneLanguageProvider><SplitStack /></StandaloneLanguageProvider>);
