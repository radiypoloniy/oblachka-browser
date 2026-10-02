import { useLanguage } from '../../i18n';
import { btnGhost } from '../settings/kit';
import { TEXT, sp } from '../../styles/system';
import type { useHistoryPages } from './useHistoryPages';

export default function HistoryPagination({ paging }: { paging: ReturnType<typeof useHistoryPages> }) {
  const { t } = useLanguage();
  return <div style={{ display: 'flex', alignItems: 'center', gap: sp(2), flexWrap: 'wrap' }}>
    <button style={btnGhost} disabled={paging.loading || !paging.previous} onClick={paging.previous}>
      {t('Новее')}
    </button>
    <span style={TEXT.caption}>{t('Страница {n}', { n: paging.index + 1 })}</span>
    <button style={btnGhost} disabled={paging.loading || !paging.following} onClick={paging.following}>
      {t('Старее')}
    </button>
    {paging.loading && <span style={TEXT.caption}>{t('Загрузка…')}</span>}
    {paging.error && <span style={{ ...TEXT.caption, color: 'var(--danger-500)' }}>
      {t('Не удалось загрузить историю.')}
      <button style={btnGhost} onClick={() => void paging.load()}>{t('Повторить')}</button>
    </span>}
  </div>;
}
