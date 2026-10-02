import { useState } from 'react';
import type { HistorySearchFilters } from '../../../shared/ipc';
import { useLanguage } from '../../i18n';
import { btnGhost } from '../settings/kit';
import { sp, RADIUS, TEXT } from '../../styles/system';

export default function HistoryFilters({ filters, onChange }: { filters: HistorySearchFilters; onChange: (value: HistorySearchFilters) => void }) {
  const { t } = useLanguage();
  const [domain, setDomain] = useState('');
  const [period, setPeriod] = useState('all');
  function apply(nextPeriod = period) {
    setPeriod(nextPeriod);
    onChange({ domain: domain.trim() || undefined,
      ...(nextPeriod === 'all' ? {} : { from: Date.now() - Number(nextPeriod) * 86_400_000 }) });
  }
  return <div style={{ display: 'flex', gap: sp(2), alignItems: 'center', flexWrap: 'wrap' }}>
    <input aria-label={t('Сайт в истории')} placeholder={t('Сайт: example.com')} value={domain}
      onChange={e => setDomain(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') apply(); }}
      style={{ background: 'var(--surface-sunken)', color: 'var(--text-body)', border: '1px solid var(--n7)', borderRadius: RADIUS.control, padding: sp(2) }} />
    <select aria-label={t('Период последнего посещения')} value={period} onChange={e => apply(e.target.value)} style={{ ...btnGhost }}>
      <option value="all">{t('За всё время')}</option>
      <option value="1">{t('За последние сутки')}</option>
      <option value="7">{t('За последние 7 дней')}</option>
      <option value="30">{t('За последние 30 дней')}</option>
    </select>
    <button style={btnGhost} onClick={() => apply()}>{t('Применить')}</button>
    {(filters.domain || filters.from) && <button style={btnGhost} onClick={() => { setDomain(''); setPeriod('all'); onChange({}); }}>{t('Сбросить фильтры')}</button>}
    <span style={{ color: 'var(--text-faint)', ...TEXT.caption }}>{t('Период — по последнему посещению')}</span>
  </div>;
}
