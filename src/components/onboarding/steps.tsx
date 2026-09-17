import type { BackfillProgress, CatalogEntry, DownloadProgress } from '../../../shared/ipc';
import { sp, pad, CAPS, TEXT, DISPLAY, RADIUS } from '../../styles/system';
import { Muted, Progress, gb, BigFact, IndexNote } from './parts';
import { useLanguage } from '../../i18n';

// Два коротких шага мастера: что скачаем и надо ли перечитать историю. Вынесены вместе — по
// отдельному файлу на тридцать строк заводить незачем, а из корня они уходят по той же причине,
// что и перенос: правка одного шага не должна требовать прочитать остальные.

/** Шаг модели: что именно предлагаем скачать и зачем. */
export function ModelStep({ modelOffer, dl, modelDone }: {
  modelOffer: CatalogEntry;
  dl: DownloadProgress | null;
  /** Загрузка завершилась удачей — от этого зависит текст шага. */
  modelDone: boolean;
}) {
  const { t } = useLanguage();
  return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: sp(4) }}>
          <span style={{ ...CAPS }}>{t('Что скачаем')}</span>
          <div style={{
            display: 'flex', flexDirection: 'column', gap: sp(4),
            padding: pad(6), borderRadius: RADIUS.content, border: '2px solid var(--divider)',
          }}>
            <span style={{
              ...DISPLAY, fontSize: 30, fontWeight: 800, letterSpacing: '-0.03em',
              color: 'var(--text-strong)', lineHeight: 1.05,
            }}>{modelOffer.model.label}</span>
            <div style={{ display: 'flex', gap: sp(8) }}>
              <BigFact cap={t('Размер')} value={gb(modelOffer.model.sizeBytes)} />
              <BigFact cap={t('Нужно видеопамяти')} value={gb(modelOffer.minVramBytes)} />
            </div>
            {/* Строка «чем отличается» приходит ИЗ КАТАЛОГА: это пересказ наших замеров, и
                расходиться описанию с числами нельзя (см. CatalogEntry.summary). */}
            <span style={{ ...TEXT.body, color: 'var(--text-muted)', lineHeight: 1.55 }}>
              {modelOffer.summary}
            </span>
          </div>

          {dl?.error ? (
            <Muted>{t('Загрузка не удалась:')} {dl.error}. {t('Можно повторить позже в «Настройки → ИИ».')}</Muted>
          ) : dl?.running ? (
            <Progress
              done={dl.receivedBytes} total={dl.totalBytes}
              label={dl.totalBytes ? `${t('Качаем —')} ${gb(dl.receivedBytes)} ${t('из')} ${gb(dl.totalBytes)}` : t('Качаем…')}
              hint={t('Можно идти дальше: загрузка продолжится в фоне.')}
            />
          ) : modelDone ? (
            <Muted>✅ {t('Модель скачана — локальный ИИ готов.')}</Muted>
          ) : null}
        </div>
  );
}

/** Шаг индексации: перечитать перенесённую историю ради смыслового поиска. */
export function IndexStep({ backfill, indexAsked }: {
  backfill: BackfillProgress | null;
  indexAsked: boolean;
}) {
  const { t } = useLanguage();
  return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: sp(4) }}>
          {backfill?.running ? (
            <Progress
              done={backfill.processed} total={backfill.total}
              label={`${t('Читаем страницы —')} ${backfill.processed} ${t('из')} ${backfill.total}`}
              hint={t('Можно идти дальше: это продолжится в фоне.')}
            />
          ) : indexAsked ? (
            <Muted>✅ {t('Запустили — дальше браузер сделает это сам.')}</Muted>
          ) : (
            <>
              <span style={{ ...CAPS }}>{t('Что произойдёт')}</span>
              {/* ⚠️ Говорим ПРЯМО, что для этого страницы будут открыты заново. Это сеть и это
                  следы в чужих логах — умолчать о таком в приватном браузере нельзя, а решение
                  всё равно остаётся за человеком. Поэтому текст здесь КРУПНЫЙ: это не сноска
                  мелким шрифтом, а то, на что человек соглашается. */}
              <span style={{
                ...TEXT.section, fontWeight: 450, color: 'var(--text-body)', lineHeight: 1.5,
              }}>
                {t('Без этого шага умный поиск не увидит перенесённые страницы, пока вы сами их не откроете. Сейчас браузер по одной откроет их в фоне и прочитает текст.')}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
                <IndexNote>{t('Это займёт время и потребует сети.')}</IndexNote>
                <IndexNote>{t('Всё остальное в это время работает как обычно.')}</IndexNote>
                <IndexNote>{t('Прочитанное остаётся на вашем компьютере.')}</IndexNote>
              </div>
            </>
          )}
        </div>
  );
}
