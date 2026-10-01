import { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Columns3, Check, X } from 'lucide-react';
import type { CompareApi } from '../shared/tabCompare';
import { useCompare } from './components/compare/useCompare';
import { PopoverCard, PopoverTitle, PopoverHint, PopoverIcon, PopoverRow, PopoverActions, PrimaryButton, QuietButton } from './components/popoverKit';
import { StandaloneLanguageProvider, useLanguage } from './i18n';
import { installOverlayReveal } from './overlayReveal';
import { OVERLAY_SHADOW_MARGIN } from '../shared/overlayMetrics';
import { TEXT, sp } from './styles/system';
import './styles/global.css';

declare global { interface Window { compareOffer: CompareApi & { reportHeight(height: number): void } } }
function CompareOffer() {
  const api = window.compareOffer, state = useCompare(api), card = useRef<HTMLDivElement>(null), { t } = useLanguage();
  const [selected, setSelected] = useState<string[]>([]), [model, setModel] = useState(''), [error, setError] = useState('');
  const signature = state?.candidates.map(p => p.tabId).join('|') ?? '';
  useEffect(() => { setSelected(signature ? signature.split('|') : []); setError(''); }, [signature]);
  useEffect(() => {
    const node = card.current; if (!node) return;
    const report = () => api.reportHeight(node.offsetHeight);
    const observer = new ResizeObserver(report); observer.observe(node); report();
    return () => observer.disconnect();
  }, [api]);
  useEffect(() => {
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') void api.closeTabCompareOffer(); };
    document.addEventListener('keydown', escape); return () => document.removeEventListener('keydown', escape);
  }, [api]);
  const start = () => { setError(''); void api.startTabCompare(selected, model).catch(e => setError(e instanceof Error ? e.message : t('Не удалось начать сравнение'))); };
  const chosenModel = state?.models.find(m => m.id === model);
  return <div ref={card} style={{ margin: OVERLAY_SHADOW_MARGIN, width: 340 }}>
    <PopoverCard width={340}>
      <div style={{ display: 'flex', alignItems: 'center', gap: sp(2) }}>
        <PopoverIcon><Columns3 size={18} /></PopoverIcon><div style={{ flex: 1 }}><PopoverTitle>Сравнить товары?</PopoverTitle></div>
        <QuietButton onClick={() => void api.closeTabCompareOffer()}><span aria-label={t('Закрыть')}><X size={14} /></span></QuietButton>
      </div>
      <PopoverHint>Соберём характеристики открытых вариантов в одну таблицу. До пяти товаров.</PopoverHint>
      <div style={{ maxHeight: 176, overflowY: 'auto' }}>
        {state?.candidates.map(p => <PopoverRow key={p.tabId} title={p.title} hint={new URL(p.url).hostname.replace(/^www\./, '')}
          selected={selected.includes(p.tabId)} trailing={selected.includes(p.tabId) ? <Check size={14} /> : undefined}
          onClick={() => setSelected(old => old.includes(p.tabId) ? old.filter(id => id !== p.tabId) : [...old, p.tabId])} />)}
      </div>
      <label style={{ ...TEXT.caption, display: 'grid', gap: sp(1) }}>{t('Сопоставление характеристик')}
        <select aria-label={t('Модель для сравнения')} value={model} onChange={e => setModel(e.target.value)}
          style={{ width: '100%', minWidth: 0, boxSizing: 'border-box', padding: sp(2), borderRadius: 'var(--radius-sm)', border: '1px solid var(--divider)', background: 'var(--surface-sunken)', color: 'var(--text-body)', font: 'inherit' }}>
          <option value="">{t('Без AI — данные со страниц')}</option>
          {state?.models.map(m => <option key={m.id} value={m.id}>{m.label} · {t(m.local ? 'На этой машине' : 'Облако')}</option>)}
        </select>
      </label>
      <PopoverHint>{chosenModel ? chosenModel.local ? 'После нажатия модель сопоставит названия характеристик. В фоне она не загружается.' : 'После нажатия характеристики выбранных товаров уйдут в выбранное облако. Один запрос; расход учитывается в статистике AI.' : 'Работает без модели. Названия характеристик должны совпадать.'}</PopoverHint>
      {error && <div role="alert" style={{ ...TEXT.caption, color: 'var(--danger)' }}>{error}</div>}
      <PopoverActions><PrimaryButton disabled={selected.length < 2} onClick={start}>Сравнить</PrimaryButton>
        <QuietButton onClick={() => void api.closeTabCompareOffer()}>Не сейчас</QuietButton></PopoverActions>
      <button onClick={() => void api.setTabCompareEnabled(false)} style={{ ...TEXT.caption, padding: sp(1), border: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', textAlign: 'left' }}>{t('Выключить предложения сравнения')}</button>
    </PopoverCard>
  </div>;
}
installOverlayReveal();
ReactDOM.createRoot(document.getElementById('root')!).render(<StandaloneLanguageProvider><CompareOffer /></StandaloneLanguageProvider>);
