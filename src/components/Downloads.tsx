import { useMemo, useRef, useState } from 'react';
import { X, Download, FolderOpen, ExternalLink, RotateCcw, Pause, Play, XCircle, Trash2 } from 'lucide-react';
import type { DownloadEntry } from '../../shared/ipc';
import { islandPlate, untintedPlateVars } from '../styles/island';
// Форматирование, подписи состояний и значок по типу файла — общие с поповером у кнопки тулбара
// (см. downloadsShared.tsx): один и тот же файл в двух местах должен выглядеть одинаково.
import { FileKindIcon, formatBytes, formatSpeed, STATE_LABEL, STATE_COLOR } from './downloadsShared';

interface DownloadsProps {
  downloads: DownloadEntry[];
  onClose: () => void;
}

// Ключ дня — по локальной дате, а не по UTC: «сегодня» человек считает по своим часам.
function dayKeyOf(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabelOf(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const yest = new Date(today.getTime() - 86400000);
  if (dayKeyOf(ts) === dayKeyOf(today.getTime())) return 'Сегодня';
  if (dayKeyOf(ts) === dayKeyOf(yest.getTime())) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function Downloads({ downloads, onClose }: DownloadsProps) {
  const hasFinished = downloads.some((d) => d.state !== 'progressing');
  const dayRefs = useRef(new Map<string, HTMLDivElement>());

  // Группировка по дням в том порядке, в каком записи уже пришли (свежие сверху) — своей
  // сортировки не заводим, порядок списка задаёт DownloadManager.
  const dayGroups = useMemo(() => {
    const groups: { key: string; label: string; items: DownloadEntry[] }[] = [];
    for (const d of downloads) {
      const key = dayKeyOf(d.startedAt);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.items.push(d);
      else groups.push({ key, label: dayLabelOf(d.startedAt), items: [d] });
    }
    return groups;
  }, [downloads]);

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
      ...untintedPlateVars,
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

      {/* Список. Раскладка — та же, что у Истории и Закладок: узкая навигация слева, содержимое
          справа. Это третий экран одного семейства («что я уже видел / взял»), и три разные
          формы для трёх соседних разделов человек читает как три разные программы. Слева даты —
          ровно как в Истории, потому что загрузки тоже хронология. */}
      {downloads.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 'var(--fs-sm)', marginTop: 48 }}>
          Нет загрузок
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
          <nav style={{
            width: 150, flexShrink: 0, overflowY: 'auto',
            padding: '10px 8px 16px', borderRight: '1px solid var(--divider)',
          }}>
            {dayGroups.map((g) => (
              <button
                key={g.key}
                onClick={() => dayRefs.current.get(g.key)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
                  padding: '6px 10px', marginBottom: 1, border: 'none', background: 'none',
                  borderRadius: 'var(--radius-sm)', cursor: 'default',
                  fontSize: 'var(--fs-xs)', color: 'var(--text-body)',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
              >
                <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {g.label}
                </span>
                <span style={{ flexShrink: 0, color: 'var(--text-faint)' }}>{g.items.length}</span>
              </button>
            ))}
          </nav>
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '8px 20px 16px' }}>
            {dayGroups.map((g) => (
              <div key={g.key} ref={(el) => { if (el) dayRefs.current.set(g.key, el); else dayRefs.current.delete(g.key); }}>
                <div style={{
                  position: 'sticky', top: 0, zIndex: 1, background: 'var(--surface-solid)',
                  fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)',
                  padding: '10px 8px 6px',
                }}>{g.label}</div>
                {g.items.map((d) => <DownloadRow key={d.id} entry={d} />)}
              </div>
            ))}
          </div>
        </div>
      )}
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

      {/* ⚠️ Полного адреса источника здесь БОЛЬШЕ НЕТ. Он занимал целую строку под каждым файлом
          и почти всегда был нечитаемой кашей из параметров — а отвечал на вопрос, который к
          скачанному файлу не относится: человек ищет здесь файл, а не ссылку. Домен остался
          в подписи выше, полный адрес — в подсказке при наведении на строку. */}

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

      {/* ⚠️ Путь сохранения тоже убран из строки: он одинаковый почти у всех файлов (папка
          загрузок), то есть повторял одно и то же под каждой записью и ничего не различал.
          Добраться до файла по-прежнему можно кнопкой «Показать в папке» ниже. */}

      {/* Кнопки действий — по наведению. Постоянно раскрытые, они шумели: у каждой записи внизу
          висел ряд из трёх подписанных кнопок, и список превращался в стену управляющих
          элементов вместо перечня файлов.
          ⚠️ Место под них зарезервировано ВСЕГДА (высота фиксирована, меняется только
          прозрачность). Появление их в разметке двигало бы соседние строки на каждое движение
          мыши — ровно то дрожание, что уже ловили в сайдбаре закладок.
          ⚠️ У идущей загрузки кнопки видны всегда: «Пауза» и «Отмена» нужны в тот момент, когда
          человек смотрит на прогресс, а не наводит мышь. */}
      <div style={{
        display: 'flex', gap: 4, flexWrap: 'nowrap', minHeight: 24, alignItems: 'center',
        opacity: hovered || isActive ? 1 : 0,
        pointerEvents: hovered || isActive ? 'auto' : 'none',
        transition: 'opacity var(--dur-fast) var(--ease-standard)',
      }}>
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
