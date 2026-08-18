import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { FolderOpen, ExternalLink, RotateCcw, Pause, Play, X, ChevronRight, Download, Sparkles, Check } from 'lucide-react';
import { isDocumentFile } from '../shared/documentFormats';
import type { DownloadEntry, DuplicateDownloadPrompt, DuplicateDownloadDecision, DownloadNameSuggestion, DownloadRenameResult } from '../shared/ipc';
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
      suggestDownloadName: (id: string) => Promise<DownloadNameSuggestion>;
      renameDownload: (id: string, name: string) => Promise<DownloadRenameResult>;
      onDownloadsChanged: (cb: (entries: DownloadEntry[]) => void) => () => void;
      getDuplicatePrompt: () => Promise<DuplicateDownloadPrompt | null>;
      onDuplicatePrompt: (cb: (p: DuplicateDownloadPrompt | null) => void) => () => void;
      decideDuplicate: (decision: DuplicateDownloadDecision) => void;
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
  // Вопрос «этот файл уже скачан». Пока он есть, карточка показывает ТОЛЬКО его: это не строка
  // в списке, а решение, которого ждёт остановленная загрузка.
  const [prompt, setPrompt] = useState<DuplicateDownloadPrompt | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => window.downloadsPopover.onDuplicatePrompt(setPrompt), []);
  useEffect(() => { void window.downloadsPopover.getDuplicatePrompt().then(setPrompt); }, []);

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
        {prompt ? (
          <DuplicatePrompt prompt={prompt} />
        ) : shown.length === 0 ? (
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

        {/* Пока висит вопрос, «все загрузки» прячем: он про решение, а не про список. */}
        {!prompt && <button
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
        </button>}
      </div>
    </div>
  );
}

// Карточка вопроса о повторной загрузке.
//
// ⚠️ Кнопки ровно две, и обе — про действие. Третьей («отмена») нет намеренно: отказ это просто
// клик мимо, и он уже отменяет загрузку (см. closeDownloadsPopover). Лишняя кнопка «отмена» рядом
// с «открыть» только заставляла бы выбирать между двумя способами ничего не делать.
function DuplicatePrompt({ prompt }: { prompt: DuplicateDownloadPrompt }) {
  const when = new Date(prompt.downloadedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  return (
    <div style={{ padding: '16px 16px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 32, height: 32, borderRadius: 'var(--radius-sm)', flex: 'none',
          background: 'var(--accent-soft)', color: 'var(--accent)',
        }}>
          <FileKindIcon filename={prompt.filename} size={16} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
            Этот файл уже загружен
          </div>
          <div style={{
            fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }} title={prompt.savePath}>
            {prompt.filename} · {when}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => window.downloadsPopover.decideDuplicate('open')}
          style={{
            flex: 1, padding: '8px 10px', borderRadius: 'var(--radius-sm)', border: 'none',
            background: 'var(--accent)', color: 'var(--on-accent)',
            fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'default',
          }}
        >
          Открыть загруженное
        </button>
        <button
          onClick={() => window.downloadsPopover.decideDuplicate('download')}
          style={{
            flex: 1, padding: '8px 10px', borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--divider-strong)', background: 'transparent',
            color: 'var(--text-body)', fontSize: 'var(--fs-sm)', cursor: 'default',
          }}
        >
          Всё равно загрузить
        </button>
      </div>
    </div>
  );
}

function Row({ entry: d }: { entry: DownloadEntry }) {
  const [hovered, setHovered] = useState(false);
  // Имя по содержимому (AI-IDEAS.md №3). ⚠️ Состояний четыре, и 'proposed' среди них несущее:
  // между «модель придумала» и «файл переименован» обязан стоять человек — переименование на
  // диске необратимо, если его не заметили.
  const [naming, setNaming] = useState<'idle' | 'working' | 'proposed' | 'error'>('idle');
  const [draft, setDraft] = useState('');
  const [problem, setProblem] = useState('');

  const askName = useCallback(() => {
    setNaming('working');
    setProblem('');
    void window.downloadsPopover.suggestDownloadName(d.id).then((res) => {
      if (res.ok && res.name) { setDraft(res.name); setNaming('proposed'); }
      else { setProblem(res.error ?? 'Не получилось'); setNaming('error'); }
    });
  }, [d.id]);

  const applyName = useCallback(() => {
    const name = draft.trim();
    if (!name) return;
    setNaming('working');
    void window.downloadsPopover.renameDownload(d.id, name).then((res) => {
      // Успех виден сам собой: список приезжает заново с новым именем.
      if (res.ok) { setNaming('idle'); setDraft(''); }
      else { setProblem(res.error ?? 'Не получилось'); setNaming('error'); }
    });
  }, [d.id, draft]);

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
  // ⚠️ Пока правится имя, строка НЕ открывает файл: клик в поле ввода дотянулся бы до неё.
  const openable = isDone && !!d.savePath && naming !== 'proposed';
  // Предлагать имя есть смысл только для документа, из которого мы умеем достать текст.
  const nameable = isDone && !!d.savePath && isDocumentFile(d.filename);

  // Вторая строка на время работы с именем говорит о ней: обычный размер файла в этот момент
  // человеку не нужен, а происходящее — нужно (своей системы тостов в чроме нет).
  const namingLine = naming === 'working' ? 'Читаю файл…'
    : naming === 'proposed' ? 'Enter — переименовать, Esc — отменить'
    : naming === 'error' ? problem
    : null;

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
        {naming === 'proposed' ? (
          // ⚠️ Имя ПРАВИТСЯ прямо здесь, а не применяется как есть: модель ошибается, и цена
          // ошибки — файл на диске. Тот же приём, что у имени группы вкладок (inline-правка).
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') applyName();
              if (e.key === 'Escape') { setNaming('idle'); setDraft(''); }
            }}
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '2px 6px', borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--accent)', background: 'var(--surface)',
              color: 'var(--text-strong)', fontSize: 'var(--fs-sm)', fontWeight: 600,
              fontFamily: 'inherit', outline: 'none',
            }}
          />
        ) : (
          <div style={{
            fontSize: 'var(--fs-sm)', fontWeight: 600,
            color: isFailed ? 'var(--text-muted)' : 'var(--text-strong)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {d.filename}
          </div>
        )}
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
          fontSize: 'var(--fs-xs)',
          color: naming === 'error' ? 'var(--tone-warm)' : 'var(--text-faint)',
          marginTop: isActive ? 0 : 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {namingLine ?? subtitle}
        </div>
      </div>

      {/* Действия — только при наведении: в спокойном виде строка должна читаться, а не пестреть. */}
      <div style={{
        display: 'flex', gap: 2, flex: 'none',
        // Пока правится имя, кнопки видны всегда: человек увёл курсор в поле ввода, а согласиться
        // и отказаться ему нужно именно сейчас.
        visibility: hovered || naming === 'proposed' ? 'visible' : 'hidden',
      }}>
        {naming === 'proposed' ? (
          <>
            <IconBtn title="Переименовать" icon={<Check size={14} />} onClick={applyName} />
            <IconBtn title="Отменить" icon={<X size={14} />}
              onClick={() => { setNaming('idle'); setDraft(''); }} />
          </>
        ) : nameable && naming !== 'working' && (
          <IconBtn title="Назвать по содержимому" icon={<Sparkles size={14} />} onClick={askName} />
        )}
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
        {isDone && d.savePath && naming !== 'proposed' && (
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
