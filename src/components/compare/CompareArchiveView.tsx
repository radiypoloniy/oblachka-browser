import { useEffect, useState, type CSSProperties } from 'react';
import { ArrowUpRight, Columns3, Trash2 } from 'lucide-react';
import type { CompareArchiveEntry, CompareArchivePage } from '../../../shared/compareArchive';
import type { LibrarySummary } from '../library/kit';
import { DISPLAY_CARD, TEXT, CAPS, sp, RADIUS, glyph } from '../../styles/system';
import { QuietButton } from '../popoverKit';
import { useLanguage } from '../../i18n';
import './compareArchive.css';

const geometry = { '--archive-s1': `${sp(1)}px`, '--archive-s2': `${sp(2)}px`, '--archive-s3': `${sp(3)}px`, '--archive-s4': `${sp(4)}px`, '--archive-s8': `${sp(8)}px`, '--archive-box': `${RADIUS.box}px` } as CSSProperties;

export default function CompareArchiveView({ query, onSummary }: { query: string; onSummary(s: LibrarySummary): void }) {
  const [page, setPage] = useState<CompareArchivePage | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0), [offset, setOffset] = useState(0), { t } = useLanguage();
  useEffect(() => { setOffset(0); setPage(null); }, [query]);
  useEffect(() => {
    let alive = true; setBusy(true); setError('');
    void window.oblako.tabCompareArchive(query, offset).then(next => {
      if (!alive) return;
      setPage(old => offset && old ? { ...next, entries: [...old.entries, ...next.entries] } : next);
    }).catch(() => { if (alive) setError(t('Не удалось прочитать архив сравнений')); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [query, offset, reload, t]);
  useEffect(() => window.oblako.onTabCompareArchiveChanged(() => { setOffset(0); setPage(null); setReload(n => n + 1); }), []);
  useEffect(() => onSummary({ hero: page ? String(page.total) : '—', heroLabel: query.trim() ? 'найдено сравнений' : 'сохранённых сравнений' }), [page, query, onSummary]);
  const open = (id: string) => { setError(''); void window.oblako.openTabCompareArchive(id).catch(e => setError(e instanceof Error ? e.message : t('Не удалось открыть сравнение'))); };
  const remove = (id: string) => { setError(''); void window.oblako.removeTabCompareArchive(id).catch(() => setError(t('Не удалось удалить сравнение'))); };
  return <div className="compare-archive" style={geometry}>
    <p style={TEXT.caption}>{t('Готовые разборы открываются без AI-запроса. Цены и условия сохранены на момент снимка.')}</p>
    {error && <div role="alert" style={TEXT.body}>{error}<QuietButton onClick={() => { setOffset(0); setReload(n => n + 1); }}>Повторить</QuietButton></div>}
    {!page?.entries.length && !error && <div className="compare-archive-empty"><Columns3 {...glyph(24)} /><h2 style={TEXT.title}>{t(busy ? 'Загружаю сравнения…' : query.trim() ? 'Сравнения не найдены' : 'Здесь будут ваши сравнения')}</h2>
      <p style={TEXT.body}>{t(query.trim() ? 'Попробуйте название товара или магазина.' : 'Откройте несколько похожих товаров и примите предложение сравнить. Результат сохранится здесь автоматически.')}</p></div>}
    {!!page?.entries.length && <div className="compare-archive-grid">{page.entries.map(entry => <ArchiveCard key={entry.id} entry={entry} open={open} remove={remove} />)}</div>}
    {page?.hasMore && <QuietButton disabled={busy} onClick={() => setOffset(page.entries.length)}>{busy ? 'Загружаю…' : 'Показать ещё'}</QuietButton>}
  </div>;
}
function ArchiveCard({ entry, open, remove }: { entry: CompareArchiveEntry; open(id: string): void; remove(id: string): void }) {
  const { t } = useLanguage();
  return <article className="compare-archive-card"><button className="compare-archive-open" onClick={() => open(entry.id)}>
    <span style={CAPS}><Columns3 {...glyph(14)} />{t('Вариантов')}: {entry.products.length}</span>
    <h2 style={DISPLAY_CARD}>{entry.title}</h2><p style={TEXT.body}>{entry.summary}</p>
    <ul>{entry.products.map((p, i) => <li key={i}><strong style={TEXT.body}>{p.title}</strong><span style={TEXT.caption}>{new URL(p.url).hostname}</span></li>)}</ul>
    <span className="compare-archive-meta" style={TEXT.caption}><time dateTime={new Date(entry.updatedAt).toISOString()}>{new Date(entry.updatedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time><span>{entry.hasAdvice ? entry.via || t('AI-разбор') : t('Исходные факты')}</span><ArrowUpRight {...glyph(14)} /></span>
  </button><div className="compare-archive-delete"><QuietButton onClick={() => remove(entry.id)}><span aria-label={t('Удалить сравнение')} title={t('Удалить сравнение')} style={{ display: 'flex', padding: sp(1) }}><Trash2 {...glyph(14)} /></span></QuietButton></div></article>;
}
