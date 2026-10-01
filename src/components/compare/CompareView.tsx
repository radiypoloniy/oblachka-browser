import { useState, type CSSProperties } from 'react';
import { RefreshCw, Sparkles, X } from 'lucide-react';
import { useCompare } from './useCompare';
import { untintedPlateVars } from '../../styles/island';
import { TEXT, DISPLAY, sp, RADIUS, panelIsland, panelFrame, grain, glyph } from '../../styles/system';
import { QuietButton, PrimaryButton } from '../popoverKit';
import { ModelChip } from '../ai/ModelChip';
import { CompareSummary } from './CompareSummary';
import { CompareFacts } from './CompareFacts';
import { useLanguage } from '../../i18n';
import './compare.css';

const geometry = { '--compare-s1': `${sp(1)}px`, '--compare-s2': `${sp(2)}px`, '--compare-s3': `${sp(3)}px`, '--compare-s4': `${sp(4)}px`, '--compare-s6': `${sp(6)}px`, '--compare-s8': `${sp(8)}px`, '--compare-box': `${RADIUS.box}px`, '--compare-control': `${RADIUS.control}px` } as CSSProperties;
export default function CompareView({ onClose }: { onClose(): void }) {
  const state = useCompare(), [section, setSection] = useState<'summary' | 'facts'>('summary'), [error, setError] = useState(''), { t } = useLanguage();
  const busy = state?.phase === 'reading', hasData = !!state?.products.length;
  const generate = () => { setError(''); if (state) void window.oblako.startTabCompare(state.products.map(p => p.tabId), 'auto').catch(e => setError(e instanceof Error ? e.message : t('Не удалось обновить сравнение'))); };
  const source = (id: string, fact: number) => { setError(''); void window.oblako.tabCompareSource(id, fact).then(ok => { if (!ok) setError(t('Источник закрыт или изменился. Обновите сравнение.')); }).catch(() => setError(t('Не удалось открыть источник'))); };
  return <div className="compare-room" style={{ ...panelFrame, ...geometry }}><section className="compare-view" style={{ ...panelIsland(), ...untintedPlateVars, ...TEXT.body }} aria-label={t('Сравнение товаров')}>
    <header className="compare-hero"><div style={grain} /><div className="compare-hero-content">
      <div className="compare-hero-top"><span style={{ ...DISPLAY, fontSize: 19, fontWeight: 700, opacity: .82 }}>{t('Сравнение товаров')}</span>
        <button onClick={onClose} aria-label={t('Закрыть сравнение')} className="compare-close" style={{ width: sp(8), height: sp(8) }}><X {...glyph(16)} /></button></div>
      <h1 style={{ ...DISPLAY, fontWeight: 800, color: 'inherit', letterSpacing: '-.04em', lineHeight: 1.1 }}>{state?.advice?.headline || t(busy ? 'Сравнение готовится' : 'Какие различия важны?')}</h1>
      <p>{state?.advice?.summary || state?.note || t('Читаю выбранные варианты…')}</p>
      {hasData && <p className="compare-snapshot">{t('Вариантов')}: {state?.products.length} · {state?.via || t('Исходные данные')} · {t('Снимок')} {new Date(state?.products[0].capturedAt ?? 0).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</p>}
    </div></header>
    <div className="compare-rail"><div className="compare-segments" role="tablist" aria-label={t('Разделы сравнения')}>
      {(['summary', 'facts'] as const).map(id => <button key={id} role="tab" aria-selected={section === id} aria-controls={`compare-${id}`} id={`compare-${id}-tab`} onClick={() => setSection(id)}>{t(id === 'summary' ? 'Коротко' : 'Характеристики')}</button>)}
    </div>{hasData && <QuietButton disabled={busy} onClick={() => { setError(''); void window.oblako.refreshTabCompare().catch(() => setError(t('Не удалось обновить сравнение'))); }}><span className="compare-action"><RefreshCw {...glyph(14)} />{t('Обновить разбор')}</span></QuietButton>}</div>
    {(busy || state?.stale || error || state?.failure) && <div className="compare-status" role={error || state?.failure ? 'alert' : 'status'}>{error || state?.failure || (state?.stale ? t('Источники изменились или закрыты. Этот разбор устарел.') : t(state?.advice ? 'Обновляю факты и советы. Прежний разбор пока доступен.' : 'Читаю открытые варианты и готовлю разбор…'))}</div>}
    <div className="compare-sheet" id={`compare-${section}`} role="tabpanel" aria-labelledby={`compare-${section}-tab`}>
      {section === 'facts' && state && hasData ? <CompareFacts state={state} onSource={source} /> : section === 'summary' && state?.advice ? <CompareSummary state={state} onSource={source} /> : <div className="compare-state"><Sparkles {...glyph(22)} />
        <h2 style={TEXT.title}>{t(busy ? 'Читаю выбранные варианты' : state?.phase === 'error' ? 'Не удалось прочитать варианты' : state?.connectionId ? 'Советы пока недоступны' : 'Подключите AI для советов')}</h2>
        <p>{busy ? t('Можно продолжать смотреть страницы. Разбор появится после готовности.') : state?.connectionId ? state.note : t('Характеристики собраны. Чтобы объяснить различия и предложить варианты под вашу задачу, нужна локальная или облачная модель.')}</p>
        {!busy && hasData && <><ModelChip role="page" drop="down" /><div className="compare-action"><PrimaryButton disabled={!state?.suggestedModel} onClick={generate}>Создать советы</PrimaryButton><QuietButton onClick={() => setSection('facts')}>Посмотреть данные</QuietButton></div>
          <QuietButton onClick={() => void window.oblako.createSpecialTab('settings', 'ai')}>Настроить модель</QuietButton><p style={TEXT.caption}>{t('Модель вызывается только по нажатию. Для облака — один запрос с учётом расхода.')}</p></>}
      </div>}
      {hasData && <footer className="compare-footer"><span>{t('Каждый совет раскрывает основание и ведёт к источнику')}</span><span>{t('Скидки, доставка и выбранный вариант могут влиять на цену')}</span></footer>}
    </div>
  </section></div>;
}
