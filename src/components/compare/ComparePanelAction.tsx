import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useCompare } from './useCompare';
import { QuietButton } from '../popoverKit';
import { glyph, sp, TEXT } from '../../styles/system';
import { useLanguage } from '../../i18n';

export function ComparePanelAction() {
  const state = useCompare(window.aiPanel), { t } = useLanguage(), [error, setError] = useState('');
  if (!state?.enabled || state.candidates.length < 2) return null;
  return <div style={{ padding: `0 ${sp(4)}px ${sp(2)}px` }}>
    <QuietButton onClick={() => { setError(''); void window.aiPanel.startTabCompare(state.candidates.map(p => p.tabId), 'auto').catch(() => setError(t('Не удалось начать сравнение'))); }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: sp(2) }}><Sparkles {...glyph(14)} />{t('Сравнить открытые варианты')}</span>
    </QuietButton>
    {error && <p role="alert" style={TEXT.caption}>{error}</p>}
  </div>;
}
