import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import type { CompareState } from '../../../shared/tabCompare';
import { TEXT, glyph } from '../../styles/system';
import { useLanguage } from '../../i18n';

export function CompareFacts({ state, onSource }: { state: CompareState; onSource(id: string, fact: number): void }) {
  const [differences, setDifferences] = useState(false), { t } = useLanguage();
  const rows = state.rows.filter(r => !differences || new Set(r.cells.map(f => f?.value.toLocaleLowerCase().replace(/\s+/g, ' ').trim() ?? '')).size > 1);
  return <><div className="compare-section-top"><h2 style={TEXT.section}>{t('Исходные факты')}</h2>
    <label className="compare-differences"><input type="checkbox" checked={differences} onChange={e => setDifferences(e.target.checked)} />{t('Только различия')}</label></div>
    <div className="compare-facts">{rows.map((row, i) => <section className="compare-fact" key={`${i}:${row.label}`}>
      <h3 style={TEXT.section}>{row.label}</h3><div className="compare-fact-values">{row.cells.map((fact, j) => <div key={state.products[j].tabId}>
        <span>{state.products[j].title}</span>{fact ? <button onClick={() => onSource(state.products[j].tabId, fact.id)} title={fact.quote}>
          <strong>{fact.value}</strong><ArrowUpRight {...glyph(14)} />
        </button> : <p>{t('Не указано')}</p>}
      </div>)}</div>
    </section>)}</div>
    {!rows.length && <p>{t('Все прочитанные характеристики совпадают. Выключите фильтр различий, чтобы посмотреть их.')}</p>}
  </>;
}
