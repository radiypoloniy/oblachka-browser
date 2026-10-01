import { ArrowUpRight } from 'lucide-react';
import type { CompareProduct, CompareReference } from '../../../shared/tabCompare';
import { glyph } from '../../styles/system';
import { useLanguage } from '../../i18n';

export function CompareEvidence({ refs, products, onSource }: { refs: CompareReference[]; products: CompareProduct[]; onSource(id: string, fact: number): void }) {
  const { t } = useLanguage();
  return <details className="compare-evidence"><summary>{t('На чём основан совет')}</summary><div>
    {refs.map(ref => {
      const product = products[ref.product], fact = product?.facts.find(f => f.id === ref.fact);
      return fact ? <button key={`${ref.product}:${ref.fact}`} onClick={() => onSource(product.tabId, fact.id)}>
        <span><strong>{product.title}</strong><span>{fact.label}: {fact.quote || fact.value}</span></span><ArrowUpRight {...glyph(14)} />
      </button> : null;
    })}
  </div></details>;
}
