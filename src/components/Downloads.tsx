import { useState } from 'react';
import { X, Download, FolderOpen, ExternalLink, RotateCcw, Pause, Play, XCircle, Trash2 } from 'lucide-react';
import type { DownloadEntry } from '../../shared/ipc';
import { islandPlate } from '../styles/island';
// Форматирование, подписи состояний и значок по типу файла — общие с поповером у кнопки тулбара
// (см. downloadsShared.tsx): один и тот же файл в двух местах должен выглядеть одинаково.
import { FileKindIcon, formatBytes, formatSpeed, STATE_LABEL, STATE_COLOR } from './downloadsShared';

interface DownloadsProps {
  downloads: DownloadEntry[];
  onClose: () => void;
}

export default function Downloads({ downloads, onClose }: DownloadsProps) {
  const hasFinished = downloads.some((d) => d.state !== 'progressing');

  function clearFinished() {
    const finished = downloads.filter((d) => d.state !== 'progressing');
    for (const d of finished) {
      void window.oblako.clearDownload(d.id);
    }
  }

  return (
    <div style={{
      // Тот же остров, что у Настроек и Истории (см. Settings.tsx::settings-root): раньше
      // Загрузки были оверлеем поверх контента и несли своё оформление — фон приложения,
      // растяжку на весь контейнер и никакого острова. Отступ по периметру даёт contentRef
      // в App.tsx, здесь его быть не должно.
      display: 'flex', flexDirection: 'column', height: '100%',
      overflow: 'hidden',
      ...islandPlate,
      borderRadius: 'var(--radius-island)',
      boxShadow: 'var(--shadow-island)',
      background: 'var(--surface-solid)',
    }}>
      {/* Заголовок */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '18px 24px',
        borderBottom: '1px solid var(--divider-strong)', flex: 'none',
      }}>
        {/* Тот же квадратный значок, что у раздела в сайдбаре и в настройках — язык один. */}
        <span style={{
          width: 22, height: 22, flex: 'none', borderRadius: 6,
          background: 'var(--tile-teal)', color: '#fff',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Download size={13} strokeWidth={2.4} />
        </span>
        <span style={{ fontWeight: 600, fontSize: 'var(--fs-md)', color: 'var(--text-strong)', flex: 1 }}>
          Загрузки
        </span>
        {hasFinished && (
          <button
            onClick={clearFinished}
            title="Очистить завершённые"
            style={headerBtn}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; e.currentTarget.style.color = 'var(--text-body)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)'; }}
          >
            <Trash2 size={15} />
          </button>
        )}
        <button
          onClick={onClose}
          title="Закрыть"
          style={headerBtn}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; e.currentTarget.style.color = 'var(--text-body)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Список */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 20px 16px' }}>
        {downloads.length === 0 ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', marginTop: 48 }}>
            Нет загрузок
          </div>
        ) : (
          downloads.map((d) => <DownloadRow key={d.id} entry={d} />)
        )}
      </div>
    </div>
  );
}

function DownloadRow({ entry: d }: { entry: DownloadEntry }) {
  const [hovered, setHovered] = useState(false);

  const isActive   = d.state === 'progressing';
  // Скачано, но файла на месте уже нет — открывать нечего, зато можно скачать заново.
  const isGone     = d.state === 'completed' && !!d.fileMissing;
  const isDone     = d.state === 'completed' && !isGone;
  const isFailed   = d.state === 'interrupted' || d.state === 'cancelled' || isGone;
  const pct        = d.totalBytes > 0 ? Math.round(d.receivedBytes / d.totalBytes * 100) : 0;
  const speed      = formatSpeed(d.bytesPerSec);
  const sizeLabel  = d.totalBytes > 0
    ? `${formatBytes(d.receivedBytes)} / ${formatBytes(d.totalBytes)}`
    : formatBytes(d.receivedBytes);

  return (
    <div
      style={{
        display: 'flex', alignItems: 'flex-start', gap: 12,
        padding: '10px 8px', borderRadius: 'var(--radius-sm)',
        background: hovered ? 'var(--surface-hover)' : 'transparent',
        marginBottom: 2,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <FileKindIcon filename={d.filename} size={34} muted={isFailed} />
      <div style={{ flex: 1, minWidth: 0 }}>
      {/* Имя файла + статус */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
        <span style={{
          fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
        }}>
          {d.filename}
        </span>
        <span style={{
          fontSize: 'var(--fs-xs)', flexShrink: 0,
          color: isGone ? 'var(--text-faint)' : STATE_COLOR[d.state],
        }}>
          {isGone ? 'Файла нет' : STATE_LABEL[d.state]}
        </span>
      </div>

      {/* URL */}
      <div style={{
        fontSize: 'var(--fs-xs)', color: 'var(--text-faint)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        marginBottom: 6,
      }}>
        {d.url}
      </div>

      {/* Прогресс-бар */}
      {isActive && (
        <div style={{ marginBottom: 6 }}>
          <div style={{
            height: 3, borderRadius: 99, background: 'var(--divider)',
            overflow: 'hidden', position: 'relative',
          }}>
            {d.totalBytes > 0 ? (
              <div style={{
                position: 'absolute', top: 0, left: 0, bottom: 0,
                width: `${pct}%`,
                background: 'var(--accent)', borderRadius: 99,
                transition: 'width 0.2s linear',
              }} />
            ) : (
              // Индетерминированная анимация — Content-Length неизвестен
              <div style={{
                position: 'absolute', top: 0, bottom: 0,
                width: '25%', background: 'var(--accent)', borderRadius: 99,
                animation: 'oblako-progress 1.4s ease-in-out infinite',
              }} />
            )}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{sizeLabel}</span>
            {speed && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{speed}</span>}
          </div>
        </div>
      )}

      {/* Для завершённых — путь сохранения */}
      {isDone && d.savePath && (
        <div style={{
          fontSize: 'var(--fs-xs)', color: 'var(--text-faint)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          marginBottom: 6,
        }}>
          {d.savePath}
        </div>
      )}

      {/* Кнопки действий */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {isActive && !d.isPaused && (
          <ActionBtn
            icon={<Pause size={12} />}
            label="Пауза"
            onClick={() => void window.oblako.pauseDownload(d.id)}
          />
        )}
        {isActive && d.isPaused && (
          <ActionBtn
            icon={<Play size={12} />}
            label="Продолжить"
            onClick={() => void window.oblako.resumeDownload(d.id)}
          />
        )}
        {isActive && (
          <ActionBtn
            icon={<XCircle size={12} />}
            label="Отменить"
            onClick={() => void window.oblako.cancelDownload(d.id)}
          />
        )}
        {isDone && d.savePath && (
          <>
            <ActionBtn
              icon={<ExternalLink size={12} />}
              label="Открыть"
              onClick={() => void window.oblako.openDownloadFile(d.id)}
            />
            <ActionBtn
              icon={<FolderOpen size={12} />}
              label="В папке"
              onClick={() => void window.oblako.showDownloadFolder(d.id)}
            />
          </>
        )}
        {isFailed && (
          <ActionBtn
            icon={<RotateCcw size={12} />}
            label="Повторить"
            onClick={() => void window.oblako.retryDownload(d.id)}
          />
        )}
        {!isActive && (
          <ActionBtn
            icon={<X size={12} />}
            label="Убрать"
            onClick={() => void window.oblako.clearDownload(d.id)}
          />
        )}
      </div>
      </div>
    </div>
  );
}

function ActionBtn({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 4,
        padding: '3px 8px', border: 'none', cursor: 'default',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--surface)',
        boxShadow: 'var(--shadow-card)',
        fontSize: 'var(--fs-xs)', color: 'var(--text-muted)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-body)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
    >
      {icon}
      {label}
    </button>
  );
}

const headerBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer', padding: 4,
  color: 'var(--text-muted)', borderRadius: 'var(--radius-sm)',
  display: 'flex', alignItems: 'center',
};
