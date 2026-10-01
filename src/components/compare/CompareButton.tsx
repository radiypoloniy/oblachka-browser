import { useEffect, useRef } from 'react';
import { Columns3 } from 'lucide-react';
import { clusterBtn } from '../../styles/island';
import { useCompare } from './useCompare';
import { useLanguage } from '../../i18n';

export function CompareButton() {
  const state = useCompare(), anchor = useRef<HTMLButtonElement>(null), seen = useRef(new Set<string>()), { t } = useLanguage();
  const signature = state?.candidates.map(p => p.tabId).sort().join('|') ?? '';
  const available = !!state?.enabled && (state?.candidates.length ?? 0) >= 2;
  const open = (automatic = false) => {
    const b = anchor.current?.getBoundingClientRect();
    if (b) void window.oblako.showTabCompareOffer({ x: b.x, y: b.y, width: b.width, height: b.height, automatic });
  };
  useEffect(() => {
    if (!available || !signature || seen.current.has(signature)) return;
    const timer = setTimeout(() => {
      if (document.activeElement?.matches('input,textarea,[contenteditable="true"]')) return;
      seen.current.add(signature); if (seen.current.size > 40) seen.current.delete(seen.current.values().next().value!);
      open(true);
    }, 1200);
    return () => clearTimeout(timer);
  }, [available, signature]);
  return <button ref={anchor} className="chrome-btn" disabled={!available} aria-label={t('Сравнить открытые товары')}
    title={t(available ? 'Сравнить открытые товары' : 'Откройте два похожих товара для сравнения')}
    style={clusterBtn({ disabled: !available })} onClick={() => open()}><Columns3 size={18} /></button>;
}
