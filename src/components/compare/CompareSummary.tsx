import { Sparkles } from 'lucide-react';
import type { CompareState } from '../../../shared/tabCompare';
import { CompareEvidence } from './CompareEvidence';
import { TEXT, DISPLAY_CARD, glyph } from '../../styles/system';
import { useLanguage } from '../../i18n';

export function CompareSummary({ state, onSource }: { state: CompareState; onSource(id: string, fact: number): void }) {
  const { t } = useLanguage(), advice = state.advice;
  if (!advice) return null;
  return <><div className="compare-section-top"><h2 style={TEXT.section}>{t('Отталкивайтесь от своей задачи')}</h2><span style={TEXT.caption}>{t('Совет основан на прочитанных данных')}</span></div>
    <div className="compare-recommendations">{advice.cards.map((card, i) => {
      const product = state.products[card.product], price = product.facts.find(f => /^Цена (на странице|по разметке)$/.test(f.label));
      const money = price?.value.match(/^(\d+(?:\.\d+)?)\s+RUB$/);
      const value = money ? new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 }).format(Number(money[1])) : price?.value;
      return <article className="compare-advice" key={`${i}:${card.scenario}`}>
        <div className="compare-scenario"><Sparkles {...glyph(14)} />{card.scenario}</div>
        <h3 style={DISPLAY_CARD}>{product.title}</h3>{value && <div><strong className="compare-price" style={TEXT.title}>{value}</strong><p style={TEXT.caption}>{t(price?.label ?? '')}</p></div>}
        <p>{card.reason}</p><p className="compare-limit">{card.limitation}</p>
        <CompareEvidence refs={card.refs} products={state.products} onSource={onSource} />
      </article>;
    })}</div>
    {!!advice.caveats.length && <div className="compare-caveats"><h2 style={TEXT.section}>{t('Что ещё стоит проверить')}</h2><div>{advice.caveats.map((text, i) => <p key={i}>{text}</p>)}</div></div>}
    <CompareEvidence refs={advice.refs} products={state.products} onSource={onSource} />
  </>;
}
