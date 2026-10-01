import { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Sparkles, X } from 'lucide-react';
import type { CompareApi } from '../shared/tabCompare';
import { useCompare } from './components/compare/useCompare';
import { PopoverCard, PopoverTitle, PopoverHint, PopoverIcon, PopoverActions, PrimaryButton, QuietButton } from './components/popoverKit';
import { StandaloneLanguageProvider, useLanguage } from './i18n';
import { installOverlayReveal } from './overlayReveal';
import { OVERLAY_SHADOW_MARGIN } from '../shared/overlayMetrics';
import { TEXT, sp, glyph } from './styles/system';
import './styles/global.css';

declare global { interface Window { compareOffer: CompareApi & { reportHeight(height: number): void } } }
function CompareOffer() {
  const api = window.compareOffer, state = useCompare(api), card = useRef<HTMLDivElement>(null), { t } = useLanguage();
  const [error, setError] = useState('');
  useEffect(() => {
    const node = card.current; if (!node) return;
    const report = () => api.reportHeight(node.offsetHeight);
    const observer = new ResizeObserver(report); observer.observe(node); report();
    return () => observer.disconnect();
  }, [api]);
  const start = () => { setError(''); void api.startTabCompare(state?.candidates.map(p => p.tabId) ?? [], 'auto').catch(e => setError(e instanceof Error ? e.message : t('Не удалось начать сравнение'))); };
  const model = state?.models.find(m => m.id === state.suggestedModel);
  return <div ref={card} style={{ margin: OVERLAY_SHADOW_MARGIN, width: 340 }}>
    <PopoverCard width={340}>
      <div style={{ display: 'flex', alignItems: 'center', gap: sp(2) }}>
        <PopoverIcon><Sparkles {...glyph(18)} /></PopoverIcon><div style={{ flex: 1 }}><PopoverTitle>Помочь выбрать?</PopoverTitle></div>
        <QuietButton onClick={() => void api.closeTabCompareOffer()}><span aria-label={t('Закрыть')}><X {...glyph(14)} /></span></QuietButton>
      </div>
      <PopoverHint>{model ? 'У вас открыты похожие варианты. Сравню главное и подскажу, за что есть смысл доплатить.' : 'У вас открыты похожие варианты. Соберу данные для сравнения; для советов можно подключить AI.'}</PopoverHint>
      {model && !model.local && <span style={TEXT.caption}>{t('Один AI-запрос после нажатия')} · {model.label}</span>}
      {error && <div role="alert" style={{ ...TEXT.caption, color: 'var(--danger)' }}>{error}</div>}
      <PopoverActions><PrimaryButton disabled={(state?.candidates.length ?? 0) < 2} onClick={start}>Сравнить</PrimaryButton>
        <QuietButton onClick={() => void api.closeTabCompareOffer()}>Не сейчас</QuietButton></PopoverActions>
    </PopoverCard>
  </div>;
}
installOverlayReveal();
ReactDOM.createRoot(document.getElementById('root')!).render(<StandaloneLanguageProvider><CompareOffer /></StandaloneLanguageProvider>);
