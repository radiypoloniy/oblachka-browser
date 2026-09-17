import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { sp, pad, RADIUS, TEXT, DISPLAY, MEASURE } from '../../styles/system';
import { btnTone, btnGhost, CapsLabel } from '../settings/kit';
import { islandPlate } from '../../styles/island';
import { useLanguage } from '../../i18n';

export interface GatherHit { title: string; url: string; snippet: string }

/**
 * «Собрать материал» — два шага, между которыми стоит ЧЕЛОВЕК.
 *
 * ⚠️ Шаг подтверждения запросов убирать нельзя. Они уходят на внешний SearXNG, и молча
 * отправлять туда придуманное моделью — то, от чего проект отказывается by design. Человек видит
 * формулировки, правит их и решает, отправлять ли вообще.
 *
 * ⚠️ Никаких новых визуальных примитивов: лист — islandPlate, кнопки — btnTone/btnGhost,
 * подписи групп — CapsLabel, отступы и радиусы — sp()/pad()/RADIUS.
 */
export function GatherSheet({
  busy, step, topic, queries, hits, error,
  onTopicChange, onSuggest, onQueriesChange, onSearch, onAdd, onClose,
}: {
  busy: boolean;
  step: 'topic' | 'queries' | 'hits';
  topic: string;
  queries: string[];
  hits: GatherHit[];
  error: string | null;
  onTopicChange: (t: string) => void;
  onSuggest: () => void;
  onQueriesChange: (q: string[]) => void;
  onSearch: () => void;
  onAdd: (urls: string[]) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set()); const { t } = useLanguage();
  const toggle = (url: string) => {
    const next = new Set(picked);
    if (next.has(url)) next.delete(url); else next.add(url);
    setPicked(next);
  };

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 500, background: 'var(--scrim, rgba(0,0,0,0.4))',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div onClick={(e) => e.stopPropagation()} style={{
        ...islandPlate, borderRadius: RADIUS.content, boxShadow: 'var(--shadow-island)',
        background: 'var(--surface-solid)',
        width: 560, maxWidth: 'calc(100vw - 48px)', maxHeight: 'calc(100vh - 96px)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: sp(2), padding: pad(4, 6),
          borderBottom: '1px solid var(--divider)', flex: 'none',
        }}>
          <span style={{ flex: 1, ...DISPLAY, fontSize: 19, fontWeight: 700, color: 'var(--text-strong)' }}>
            {step === 'topic' ? t('Собрать материал') : step === 'queries' ? t('Что искать') : t('Что добавить')}
          </span>
          <button onClick={onClose} title={t('Закрыть')} style={closeBtn}><X size={16} /></button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: pad(4, 6), display: 'flex', flexDirection: 'column', gap: sp(2) }}>
          {busy && (
            <div style={{ display: 'flex', alignItems: 'center', gap: sp(2), ...TEXT.body, color: 'var(--text-muted)' }}>
              <Loader2 size={16} style={{ animation: 'oblako-spin 1s linear infinite' }} />
              {step === 'queries' ? t('Подбираю запросы…') : t('Ищу…')}
            </div>
          )}

          {!busy && error && (
            <div style={{ ...TEXT.body, color: 'var(--danger-500)' }}>{error}</div>
          )}

          {!busy && step === 'topic' && (
            <>
              <CapsLabel>{t('Тема сбора')}</CapsLabel>
              <input
                value={topic} onChange={(e) => onTopicChange(e.target.value)} autoFocus
                placeholder={t('О чём собрать материал…')}
                onKeyDown={(e) => { if (e.key === 'Enter' && topic.trim()) onSuggest(); }}
                style={{
                  background: 'var(--surface-sunken)', border: 'none', outline: 'none',
                  borderRadius: RADIUS.control, padding: pad(2, 3),
                  ...TEXT.body, color: 'var(--text-strong)',
                }}
              />
              <p style={{ ...TEXT.caption, margin: `${sp(1)}px 0 0`, maxWidth: MEASURE }}>
                {t('Сначала модель предложит поисковые запросы. В сеть ничего не уйдёт, пока вы их не подтвердите.')}
              </p>
            </>
          )}

          {!busy && !error && step === 'queries' && (
            <>
              <CapsLabel>{t('Запросы · правьте свободно')}</CapsLabel>
              {queries.map((q, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: sp(2),
                  background: 'var(--surface-sunken)', borderRadius: RADIUS.control, padding: pad(1, 3),
                }}>
                  <input
                    value={q}
                    onChange={(e) => onQueriesChange(queries.map((x, k) => (k === i ? e.target.value : x)))}
                    style={{
                      flex: 1, border: 'none', background: 'transparent', outline: 'none',
                      ...TEXT.body, color: 'var(--text-strong)', padding: `${sp(2)}px 0`,
                    }}
                  />
                  <button onClick={() => onQueriesChange(queries.filter((_, k) => k !== i))}
                    title={t('Убрать запрос')} style={closeBtn}><X size={14} /></button>
                </div>
              ))}
              <button onClick={() => onQueriesChange([...queries, ''])} style={{ ...btnGhost, alignSelf: 'flex-start' }}>
                {t('+ Свой запрос')}
              </button>
              <p style={{ ...TEXT.caption, margin: `${sp(1)}px 0 0`, maxWidth: MEASURE }}>
                {t('Запросы уйдут на ваш SearXNG — ровно те, что здесь написаны.')}
              </p>
            </>
          )}

          {!busy && !error && step === 'hits' && (
            hits.length === 0
              ? <div style={{ ...TEXT.body, color: 'var(--text-faint)' }}>{t('Ничего не нашлось. Попробуйте другие запросы.')}</div>
              : (
                <>
                  <CapsLabel>{t('Найдено · отметьте нужное')}</CapsLabel>
                  {hits.map((h) => (
                    <label key={h.url} style={{
                      display: 'flex', gap: sp(2), alignItems: 'flex-start', cursor: 'default',
                      background: picked.has(h.url) ? 'var(--section-soft)' : 'transparent',
                      borderRadius: RADIUS.box, padding: pad(2, 2),
                    }}>
                      <input type="checkbox" checked={picked.has(h.url)} onChange={() => toggle(h.url)}
                        style={{ flex: 'none', marginTop: 3 }} />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', ...TEXT.body, fontWeight: 600, color: 'var(--text-strong)' }}>{h.title}</span>
                        <span style={{ display: 'block', ...TEXT.caption, fontFamily: 'var(--font-mono)' }}>{h.url}</span>
                        {h.snippet && <span style={{ display: 'block', ...TEXT.caption, marginTop: 2 }}>{h.snippet}</span>}
                      </span>
                    </label>
                  ))}
                </>
              )
          )}
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: sp(2), padding: pad(3, 6),
          borderTop: '1px solid var(--divider)', flex: 'none',
        }}>
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={btnGhost}>{t('Отмена')}</button>
          {step === 'topic'
            ? <button onClick={onSuggest} disabled={busy || !topic.trim()} style={btnTone}>{t('Подобрать запросы')}</button>
            : step === 'queries'
              ? <button onClick={onSearch} disabled={busy || queries.length === 0} style={btnTone}>{t('Искать')}</button>
              : <button onClick={() => onAdd([...picked])} disabled={picked.size === 0} style={btnTone}>
                  {picked.size > 0 ? t('Добавить ({n})', { n: picked.size }) : t('Добавить')}
                </button>}
        </div>
      </div>
    </div>
  );
}

const closeBtn: React.CSSProperties = {
  border: 'none', background: 'transparent', cursor: 'default', padding: sp(1),
  borderRadius: RADIUS.control, color: 'var(--text-muted)', display: 'inline-flex', flex: 'none',
};
