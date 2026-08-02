import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { FolderOpen, ExternalLink, RotateCcw, Pause, Play, X, ChevronRight, Download } from 'lucide-react';
import type { DownloadEntry } from '../shared/ipc';
import { islandPlate } from './styles/island';
import { FileKindIcon, formatBytes, formatSpeed } from './components/downloadsShared';
import './styles/global.css';
import { installOverlayReveal } from './overlayReveal';

declare global {
  interface Window {
    downloadsPopover: {
      getDownloads: () => Promise<DownloadEntry[]>;
      pauseDownload: (id: string) => Promise<void>;
      resumeDownload: (id: string) => Promise<void>;
      cancelDownload: (id: string) => Promise<void>;
      openDownloadFile: (id: string) => Promise<void>;
      showDownloadFolder: (id: string) => Promise<void>;
      retryDownload: (id: string) => Promise<void>;
      onDownloadsChanged: (cb: (entries: DownloadEntry[]) => void) => () => void;
      openAll: () => void;
      close: () => void;
      reportHeight: (px: number) => void;
      onShow: (cb: () => void) => () => void;
    };
  }
}

// Держать в синхроне с SHADOW_MARGIN в electron/DownloadsPopoverManager.ts.
const SHADOW_MARGIN = 16;
const CARD_WIDTH = 340;
// Сколько строк показывает поповер. Это быстрый доступ к последнему скачанному, а не архив —
// за полным списком есть кнопка внизу.
const VISIBLE_LIMIT = 10;

function DownloadsPopoverApp() {
  const [entries, setEntries] = useState<DownloadEntry[]>([]);
  const cardRef = useRef<HTMLDivElement>(null);

  // На каждый показ — свежий список: пока поповер был закрыт, загрузки шли своим чередом.
  useEffect(() => window.downloadsPopover.onShow(() => {
    void window.downloadsPopover.getDownloads().then(setEntries);
  }), []);

  // Живой прогресс, пока карточка открыта (см. DownloadsPopoverManager.ts::broadcastDownloads).
  useEffect(() => window.downloadsPopover.onDownloadsChanged(setEntries), []);

  // Первый показ приходит раньше, чем эффект onShow успевает навеситься только в теории —
  // но и стартовый запрос всё равно нужен, вью грузится один раз, а показов много.
  useEffect(() => { void window.downloadsPopover.getDownloads().then(setEntries); }, []);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const report = () => window.downloadsPopover.reportHeight(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [entries.length]);

  const shown = entries.slice(0, VISIBLE_LIMIT);

  return (
    <div style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box' }}>
      <div ref={cardRef} style={{
        width: CARD_WIDTH, ...islandPlate,
        borderRadius: 'var(--radius-card)',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        {shown.length === 0 ? (
          <div style={{
            padding: '28px 16px', textAlign: 'center',
            color: 'var(--text-faint)', fontSize: 'var(--fs-sm)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          }}>
            <Download size={20} />
            Загрузок пока нет
          </div>
        ) : (
          <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 1 }}>
            {shown.map((d) => <Row key={d.id} entry={d} />)}
          </div>
        )}

        <button
          onClick={() => window.downloadsPopover.openAll()}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '10px 14px', border: 'none', cursor: 'default',
            borderTop: '1px solid var(--divider)', background: 'transparent',
            fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', textAlign: 'left',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; e.currentTarget.style.color = 'var(--text-body)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          <span style={{ flex: 1 }}>Все загрузки</span>
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );
}

function Row({ entry: d }: { entry: DownloadEntry }) {
  const [hovered, setHovered] = useState(false);

  const isActive = d.state === 'progressing';
  const isGone   = d.state === 'completed' && !!d.fileMissing;
  const isDone   = d.state === 'completed' && !isGone;
  const isFailed = d.state === 'interrupted' || d.state === 'cancelled' || isGone;
  const pct      = d.totalBytes > 0 ? Math.round(d.receivedBytes / d.totalBytes * 100) : 0;

  // Вторая строка: во время загрузки — сколько из скольких и скорость, после — итог или причина.
  const subtitle = isActive
    ? [d.totalBytes > 0 ? `${formatBytes(d.receivedBytes)} из ${formatBytes(d.totalBytes)}` : formatBytes(d.receivedBytes),
       d.isPaused ? 'на паузе' : formatSpeed(d.bytesPerSec)].filter(Boolean).join(' · ')
    : isGone ? 'Файла на месте нет'
    : d.state === 'cancelled' ? 'Отменено'
    : d.state === 'interrupted' ? 'Прервано'
    : formatBytes(d.totalBytes || d.receivedBytes);

  // Открыть файл двойным путём (по строке и по кнопке) не даём: клик по всей строке — самое
  // ожидаемое действие, кнопки при наведении остаются для остального.
  const openable = isDone && !!d.savePath;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => { if (openable) void window.downloadsPopover.openDownloadFile(d.id); }}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 8px', borderRadius: 'var(--radius-sm)',
        background: hovered ? 'var(--surface-hover)' : 'transparent',
        cursor: 'default',
      }}
    >
      <FileKindIcon filename={d.filename} muted={isFailed} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 'var(--fs-sm)', fontWeight: 600,
          color: isFailed ? 'var(--text-muted)' : 'var(--text-strong)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {d.filename}
        </div>
        {isActive && (
          <div style={{
            height: 3, borderRadius: 99, background: 'var(--divider)',
            overflow: 'hidden', position: 'relative', margin: '4px 0 3px',
          }}>
            {d.totalBytes > 0 ? (
              <div style={{
                position: 'absolute', inset: '0 auto 0 0', width: `${pct}%`,
                background: 'var(--accent)', borderRadius: 99, transition: 'width 0.2s linear',
              }} />
            ) : (
              <div style={{
                position: 'absolute', top: 0, bottom: 0, width: '25%',
                background: 'var(--accent)', borderRadius: 99,
                animation: 'oblako-progress 1.4s ease-in-out infinite',
              }} />
            )}
          </div>
        )}
        <div style={{
          fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: isActive ? 0 : 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {subtitle}
        </div>
      </div>

      {/* Действия — только при наведении: в спокойном виде строка должна читаться, а не пестреть. */}
      <div style={{
        display: 'flex', gap: 2, flex: 'none',
        visibility: hovered ? 'visible' : 'hidden',
      }}>
        {isActive && (
          <IconBtn
            title={d.isPaused ? 'Продолжить' : 'Пауза'}
            icon={d.isPaused ? <Play size={14} /> : <Pause size={14} />}
            onClick={() => void (d.isPaused
              ? window.downloadsPopover.resumeDownload(d.id)
              : window.downloadsPopover.pauseDownload(d.id))}
          />
        )}
        {isActive && (
          <IconBtn title="Отменить" icon={<X size={14} />}
            onClick={() => void window.downloadsPopover.cancelDownload(d.id)} />
        )}
        {isDone && d.savePath && (
          <>
            <IconBtn title="Открыть" icon={<ExternalLink size={14} />}
              onClick={() => void window.downloadsPopover.openDownloadFile(d.id)} />
            <IconBtn title="Показать в папке" icon={<FolderOpen size={14} />}
              onClick={() => void window.downloadsPopover.showDownloadFolder(d.id)} />
          </>
        )}
        {isFailed && (
          <IconBtn title="Скачать заново" icon={<RotateCcw size={14} />}
            onClick={() => void window.downloadsPopover.retryDownload(d.id)} />
        )}
      </div>
    </div>
  );
}

function IconBtn({ title, icon, onClick }: { title: string; icon: React.ReactNode; onClick: () => void }) {
  // stopPropagation — иначе клик по кнопке дотянулся бы до строки и открыл файл заодно.
  const handle = useCallback((e: React.MouseEvent) => { e.stopPropagation(); onClick(); }, [onClick]);
  return (
    <button
      title={title}
      onClick={handle}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26, padding: 0, border: 'none', cursor: 'default',
        borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--text-muted)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.color = 'var(--text-body)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
    >
      {icon}
    </button>
  );
}

installOverlayReveal();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DownloadsPopoverApp />
  </React.StrictMode>,
);
