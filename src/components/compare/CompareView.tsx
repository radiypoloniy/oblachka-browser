import { useState } from 'react';
import { Columns3, RefreshCw, ArrowUpRight, X } from 'lucide-react';
import { useCompare } from './useCompare';
import { islandPlate } from '../../styles/island';
import { TEXT, sp } from '../../styles/system';
import { QuietButton } from '../popoverKit';
import { useLanguage } from '../../i18n';
import './compare.css';

export default function CompareView({ onClose }: { onClose(): void }) {
  const state = useCompare(), [differences, setDifferences] = useState(false), [error, setError] = useState(''), { t } = useLanguage();
  const rows = state?.rows.filter(r => !differences || new Set(r.cells.map(f => f?.value.toLocaleLowerCase().replace(/\s+/g, ' ').trim() ?? '')).size > 1) ?? [];
  const busy = state?.phase === 'reading';
  const refresh = () => { setError(''); void window.oblako.refreshTabCompare().catch(e => setError(e instanceof Error ? e.message : t('Не удалось обновить сравнение'))); };
  return <section className="compare-view" style={islandPlate} aria-label={t('Сравнение товаров')}>
    <header className="compare-header">
      <div><span className="compare-cap"><Columns3 size={15} />{t('СРАВНЕНИЕ')}</span><h1>{t('Выберите по различиям')}</h1><p>{state?.note || t('Откройте несколько похожих товаров и нажмите кнопку сравнения в тулбаре.')}</p></div>
      <QuietButton onClick={onClose}><span aria-label={t('Закрыть')}><X size={16} /></span></QuietButton>
    </header>
    <div className="compare-controls">
      <label><input type="checkbox" checked={differences} onChange={e => setDifferences(e.target.checked)} />{t('Только различия')}</label>
      {!!state?.products.length && <QuietButton disabled={busy} onClick={refresh}><span className="compare-action"><RefreshCw size={14} />{t('Обновить данные')}</span></QuietButton>}
      {busy && <span role="status" style={TEXT.caption}>{t('Собираю сравнение…')}</span>}
      {state?.via && <span style={{ ...TEXT.caption, color: 'var(--text-muted)' }}>{state.via}</span>}
    </div>
    {error && <p role="alert">{error}</p>}
    {!!state?.products.length && <div className="compare-table-scroll"><table>
      <caption className="compare-sr">{t('Характеристики выбранных товаров. Значение открывает источник.')}</caption>
      <thead><tr><th scope="col">{t('Характеристика')}</th>{state.products.map(p => <th key={p.tabId} scope="col">
        <span className="compare-host">{new URL(p.url).hostname.replace(/^www\./, '')}</span><strong>{p.title}</strong>
        <span className="compare-time">{t('Снимок')} {new Date(p.capturedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>
        {p.note && <span className="compare-note">{p.note}</span>}
      </th>)}</tr></thead>
      <tbody>{rows.map((row, i) => <tr key={`${i}:${row.label}`}><th scope="row">{row.label}</th>{row.cells.map((fact, j) => <td key={state.products[j].tabId}>
        {fact ? <button className="compare-value" title={`${fact.label}: ${fact.value}`} onClick={() => {
          setError(''); void window.oblako.tabCompareSource(state.products[j].tabId, fact.id).then(ok => { if (!ok) setError(t('Источник закрыт или изменился. Обновите сравнение.')); }).catch(() => setError(t('Не удалось открыть источник')));
        }}><span>{fact.value}</span><ArrowUpRight size={13} /></button> : <span className="compare-missing">{t('Не указано')}</span>}
      </td>)}</tr>)}</tbody>
    </table></div>}
    {state?.products.length && !rows.length ? <p style={{ padding: sp(4) }}>{t('Все прочитанные характеристики совпадают. Выключите фильтр различий, чтобы посмотреть их.')}</p> : null}
    <footer className="compare-footer">{t('Сравнивается выбранный на сайте вариант. Скидки, кошелёк, доставка и регион могут влиять на цену. Непрочитанные характеристики не дополняются догадками.')}</footer>
  </section>;
}
