import type React from 'react';
import type { RefObject } from 'react';
import { Clipboard } from 'lucide-react';
import { SparkGlyph, DownloadGlyph } from '../glyphs';
import { chromeCluster, clusterBtn } from '../../styles/island';
import { glyph } from '../../styles/system';
import { ProgressRing } from './ProgressRing';

/**
 * Правая группа тулбара: AI-панель, буфер скопированного, загрузки.
 *
 * ⚠️ Набор ПОСТОЯННЫЙ, недоступное ГАСНЕТ. Раньше здесь стояла россыпь отдельных островов,
 * половина которых появлялась и исчезала по состоянию страницы (перевод — только на реальной,
 * буфер — только после первой копии). Кластер от этого менял ширину, а вместе с ним ездил
 * омнибокс — прямо под курсором.
 *
 * ⚠️ Правило «гасить или прятать»: условие про ОКНО прячет (лёгкое окно не получит AI-панель
 * никогда, и место под неё резервировать незачем), условие про СТРАНИЦУ гасит. Тот же приём, что
 * у «Обновить» на хабе.
 *
 * ⚠️ Перевод страницы отсюда УЕХАЛ под «⋯» в адресной строке: правый кластер — про браузер, а
 * перевод относится к конкретной открытой странице. После переезда деление стало объяснимым, а
 * слотов здесь осталось ровно три.
 */
export function RightCluster(props: {
  /** Лёгкое окно (без AI-панели) — кнопка панели там не появляется вовсе. */
  isLightWindow: boolean;
  aiPanelOpen: boolean;
  onToggleAiPanel: () => void;

  clipboardRef: RefObject<HTMLDivElement>;
  clipboardCount: number;
  clipboardOpen: boolean;
  onToggleClipboard: () => void;
  /** Прогрев вью поповера по наведению — см. IPC.POPOVER_PREWARM. */
  onHoverClipboard: () => void;

  downloadsRef: RefObject<HTMLDivElement>;
  downloadsOpen: boolean;
  onToggleDownloads: () => void;
  /** Идёт анимация «файл прилетел» (см. useDownloadFlight). */
  flying: boolean;
  downloadsActive: boolean;
  /** Доля выполнения или null — «идёт, но сколько неизвестно». */
  downloadsProgress: number | null;
}): React.ReactElement {
  const {
    isLightWindow, aiPanelOpen, onToggleAiPanel,
    clipboardRef, clipboardCount, clipboardOpen, onToggleClipboard, onHoverClipboard,
    downloadsRef, downloadsOpen, onToggleDownloads, flying, downloadsActive, downloadsProgress,
  } = props;

  return (
    // marginLeft:auto прижимает группу к правому краю flex-контейнера.
    <div className="no-drag" style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginLeft: 'auto' }}>
      <div style={chromeCluster()}>
        {/* ⚠️ Тон значка означает СОСТОЯНИЕ, а не важность: в покое нейтральный, как у
            «назад/вперёд/обновить»; акцент загорается, когда панель открыта. */}
        {!isLightWindow && (
          <button className="chrome-btn" title="AI-панель" onClick={onToggleAiPanel}
            style={clusterBtn({ active: aiPanelOpen })}>
            <SparkGlyph size={18} />
          </button>
        )}

        {/* Буфер скопированного — рядом с загрузками намеренно: это одна группа «что я забрал со
            страниц».
            ⚠️ Прежде кнопки не было вовсе, пока буфер пуст («постоянный значок ради изредка
            нужного инструмента — лишний шум»). Решение перевёрнуто осознанно: шумом оказался как
            раз значок, ВОЗНИКАЮЩИЙ после первой копии, — он сдвигал весь кластер и омнибокс в
            произвольный момент работы. Пустой буфер теперь просто гасит кнопку.
            ⚠️ Прогрев вью на НАВЕДЕНИИ: пока мышь идёт от края кнопки до нажатия, документ
            поповера успевает построиться, и первый клик перестаёт его ждать. */}
        <div ref={clipboardRef} style={{ display: 'inline-flex' }} onMouseEnter={onHoverClipboard}>
          <button className="chrome-btn"
            disabled={clipboardCount === 0}
            title={clipboardCount === 0
              ? 'Скопированное со страниц — пока пусто'
              : 'Скопированное со страниц (Ctrl+Shift+B)'}
            onClick={onToggleClipboard}
            style={clusterBtn({ active: clipboardOpen, disabled: clipboardCount === 0 })}
          >
            <Clipboard {...glyph(18)} />
          </button>
        </div>

        {/* Кнопка загрузок. Клик открывает поповер с последними файлами, а не раздел целиком:
            посмотреть только что скачанное — самый частый повод сюда нажать, и ради него не
            должна уезжать открытая страница. Полный список — со дна поповера. */}
        <div ref={downloadsRef} style={{ display: 'inline-flex' }}>
          <button
            title="Загрузки"
            onClick={onToggleDownloads}
            style={{ ...clusterBtn({ active: downloadsOpen }), position: 'relative' }}
          >
            <DownloadGlyph size={18} style={flying ? { animation: 'oblako-dl-land 520ms var(--ease-out)' } : undefined} />

            {/* ⚠️ Прилетающий файл — единственный момент, когда человеку СООБЩАЮТ, что загрузка
                вообще началась: у нас нет ни системы тостов, ни полосы загрузок снизу, и раньше
                о начале скачивания говорила только точка 5×5 в углу кнопки, которую никто не
                замечал. Летит снизу-слева, со стороны страницы, — оттуда файл и «пришёл».
                Только transform и opacity: они не трогают раскладку и уходят в композитор. */}
            {flying && (
              <>
                <span
                  aria-hidden
                  style={{
                    position: 'absolute', inset: 0, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    color: 'var(--accent)', pointerEvents: 'none', zIndex: 1,
                    animation: 'oblako-dl-fly 520ms var(--ease-out)',
                  }}
                >
                  <DownloadGlyph size={18} />
                </span>
                <span
                  aria-hidden
                  style={{
                    position: 'absolute', inset: 0, borderRadius: '50%',
                    pointerEvents: 'none',
                    animation: 'oblako-dl-halo 520ms var(--ease-out) var(--dur-slow)',
                  }}
                />
              </>
            )}

            {/* Идёт скачивание — дуга прогресса по кругу кнопки. Прежняя статичная точка не
                отвечала на вопрос «идёт или нет»: она выглядела одинаково и на первом проценте,
                и на девяноста. */}
            {downloadsActive && !downloadsOpen && <ProgressRing value={downloadsProgress} />}
          </button>
        </div>
      </div>
    </div>
  );
}
