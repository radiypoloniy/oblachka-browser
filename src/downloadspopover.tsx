import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { StandaloneLanguageProvider } from './i18n';
import { ChevronRight, Download, Sparkles, Check, X } from 'lucide-react';
import { isDocumentFile, isImageFile } from '../shared/documentFormats';
import type { DownloadEntry, DownloadFileIcon, DuplicateDownloadPrompt, DuplicateDownloadDecision, DownloadNameSuggestion, DownloadRenameResult } from '../shared/ipc';
// ⚠️ Поверхность оверлея (непрозрачная), а не островная плита: карточка живёт в своей вью над
// страницей, где backdrop-filter не работает вовсе, и полупрозрачность означала бы
// просвечивающий текст сайта. Разбор — у --overlay-plate в styles/tokens/colors.css.
import { overlayPlate } from './styles/island';
import { FileWell, ProgressRing, ThumbStack, formatBytes, formatSpeed } from './components/downloadsShared';
import './styles/global.css';
import { installOverlayReveal } from './overlayReveal';
import { OVERLAY_SHADOW_MARGIN as SHADOW_MARGIN } from '../shared/overlayMetrics';
import { CAPS, DISPLAY_CARD, DISPLAY_ROW, RADIUS, TEXT, motion, pad, sp } from './styles/system';
import { groupDownloads, hostOf, type DownloadPack } from '../shared/downloadGroups';
import { PopoverActions, PrimaryButton, QuietButton } from './components/popoverKit';
import { EmptyState } from './components/EmptyState';

declare global {
  interface Window {
    downloadsPopover: {
      getDownloads: () => Promise<DownloadEntry[]>;
      pauseDownload: (id: string) => Promise<void>;
      resumeDownload: (id: string) => Promise<void>;
      cancelDownload: (id: string) => Promise<void>;
      openDownloadFile: (id: string) => Promise<void>;
      startDownloadDrag: (ids: string[]) => void;
      showDownloadFolder: (id: string) => Promise<void>;
      retryDownload: (id: string) => Promise<void>;
      getDownloadFileIcon: (id: string, thumb?: boolean) => Promise<DownloadFileIcon | null>;
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

const CARD_WIDTH = 360;

function iconBust(d: Pick<DownloadEntry, 'filename' | 'savePath' | 'state' | 'fileMissing'>): string {
  return `${d.filename}|${d.savePath}|${d.state}|${d.fileMissing ? 1 : 0}`;
}

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
  }, [entries.length, prompt]);

  // ⚠️ Раскладка по ярусам — ЧИСТАЯ ЛОГИКА в shared/downloadGroups.ts под своей проверкой.
  // Здесь только отрисовка: пачка — строка, клик раскрывает, «раньше» и сломанное — дверь в архив.
  const tiers = groupDownloads(entries, Date.now());
  const hasList = !!tiers.active || tiers.today.length > 0 || tiers.failed.length > 0 || tiers.older.length > 0;

  return (
    <div style={{ padding: SHADOW_MARGIN, boxSizing: 'border-box' }}>
      <div ref={cardRef} style={{
        width: CARD_WIDTH, ...overlayPlate,
        borderRadius: 'var(--radius-card)',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        {prompt ? (
          <DuplicatePrompt prompt={prompt} />
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<Download size={22} />}
            title="Пока пусто"
            hint="Скачанный файл появится здесь. Архив — внизу, когда будет что помнить."
          />
        ) : (
          <>
            {tiers.active && <ActiveDownload entry={tiers.active} />}

            {tiers.today.length > 0 && (
              <>
                <TierLabel title={tiers.active ? 'только что' : 'сегодня'} />
                <div style={{ padding: `0 ${sp(2)}px ${sp(1)}px`, display: 'flex', flexDirection: 'column' }}>
                  {tiers.today.map((pack) => <PackRow key={pack.head.id} pack={pack} />)}
                </div>
              </>
            )}

          </>
        )}

        {/* Пока висит вопрос, «все загрузки» прячем: он про решение, а не про список.
            Пустая карточка — тоже без двери: вести в пустой архив нечего.
            ⚠️ Сломанное и пропавшее — СЮДА, не строками. Повтор и разбор — в архиве: в карточке
            у кнопки они забивали то, что только что приехало (живой случай: пачка фото и
            полтора десятка «файла на месте нет» с «Повторить» на каждой). */}
        {!prompt && hasList && <button
          onClick={() => window.downloadsPopover.openAll()}
          style={{
            display: 'flex', alignItems: 'center', gap: sp(2),
            padding: pad(3, 4), border: 'none', cursor: 'default',
            borderTop: '1px solid var(--divider)', background: 'transparent',
            fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', textAlign: 'left',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; e.currentTarget.style.color = 'var(--text-body)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          <span style={{ flex: 1 }}>{doorLabel(tiers.older.length, tiers.failed.length)}</span>
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
  const host = hostOf(prompt.url);
  const meta = [prompt.filename, host, when].filter(Boolean).join(' · ');
  return (
    <div style={{ padding: pad(4), display: 'flex', flexDirection: 'column', gap: sp(3) }}>
      <div style={{ display: 'flex', gap: sp(3), alignItems: 'flex-start' }}>
        <FileWell
          id={prompt.existingId}
          bust={`${prompt.filename}|${prompt.savePath}|completed|0`}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...DISPLAY_CARD }}>Этот файл уже на диске</div>
          <div style={{
            ...TEXT.caption, marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }} title={prompt.savePath}>
            {meta}
          </div>
        </div>
      </div>
      <PopoverActions>
        <PrimaryButton stretch onClick={() => window.downloadsPopover.decideDuplicate('open')}>
          Открыть то, что есть
        </PrimaryButton>
        <QuietButton stretch onClick={() => window.downloadsPopover.decideDuplicate('download')}>
          Скачать ещё раз
        </QuietButton>
      </PopoverActions>
    </div>
  );
}

function TierLabel({ title }: { title: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: sp(2),
      padding: `${sp(3)}px ${sp(4)}px ${sp(1)}px`,
    }}>
      <span style={{ ...CAPS }}>{title}</span>
    </div>
  );
}

function packOfPhotos(pack: DownloadPack<DownloadEntry>): boolean {
  const all = [pack.head, ...pack.rest];
  return all.length > 1 && all.every((d) => d.state === 'completed' && !d.fileMissing && isImageFile(d.filename));
}

function PackRow({ pack }: { pack: DownloadPack<DownloadEntry> }) {
  const [open, setOpen] = useState(false);
  if (pack.rest.length === 0) return <FileRow entry={pack.head} />;
  const all = [pack.head, ...pack.rest];
  const n = all.length;
  const photos = packOfPhotos(pack);
  const title = photos
    ? `${n} ${plural(n, 'фото', 'фото', 'фото')}`
    : `${n} ${plural(n, 'файл', 'файла', 'файлов')}`;
  const bytes = all.reduce((sum, d) => sum + (d.totalBytes || d.receivedBytes), 0);
  const host = hostOf(pack.head.url);
  const meta = [host, formatBytes(bytes), whenLabel(pack.head.startedAt)].filter(Boolean).join(' · ');
  const openable = pack.head.state === 'completed' && !pack.head.fileMissing && !!pack.head.savePath;
  const dragIds = all
    .filter((d) => d.state === 'completed' && !d.fileMissing && d.savePath)
    .map((d) => d.id);
  // Клик раскрывает пачку: иначе из «3 фото» нельзя вытащить одну. Свёрнутую по-прежнему
  // можно утащить целиком (dragIds на шапке). Раскрытая шапка — только свернуть, не drag.
  return (
    <>
      <HoverRow
        dragIds={open ? null : dragIds}
        onOpen={() => setOpen((v) => !v)}
        disclosure
        expanded={open}
        icon={photos
          ? <ThumbStack ids={all.map((d) => d.id)} busts={all.map(iconBust)} />
          : <FileWell id={pack.head.id} bust={iconBust(pack.head)} />}
        title={title}
        meta={meta}
        folderId={openable && !open ? pack.head.id : null}
      />
      {open && all.map((d) => <FileRow key={d.id} entry={d} />)}
    </>
  );
}

function FileRow({ entry: d }: { entry: DownloadEntry }) {
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
      if (res.ok) { setNaming('idle'); setDraft(''); }
      else { setProblem(res.error ?? 'Не получилось'); setNaming('error'); }
    });
  }, [d.id, draft]);

  const isActive = d.state === 'progressing';
  const isGone   = d.state === 'completed' && !!d.fileMissing;
  const isDone   = d.state === 'completed' && !isGone;
  const isFailed = d.state === 'interrupted' || d.state === 'cancelled' || isGone;
  const host     = hostOf(d.url);

  const subtitle = isActive
    ? [d.totalBytes > 0 ? `${formatBytes(d.receivedBytes)} из ${formatBytes(d.totalBytes)}` : formatBytes(d.receivedBytes),
       d.isPaused ? 'на паузе' : formatSpeed(d.bytesPerSec)].filter(Boolean).join(' · ')
    : isGone ? 'файла на месте нет'
    : d.state === 'cancelled' ? 'отменено'
    : d.state === 'interrupted' ? `не скачалось${host ? ` · ${host}` : ''}`
    : [host, `${formatBytes(d.totalBytes || d.receivedBytes)}`, whenLabel(d.startedAt)].filter(Boolean).join(' · ');

  const openable = isDone && !!d.savePath && naming !== 'proposed';
  const nameable = isDone && !!d.savePath && isDocumentFile(d.filename);
  const namingLine = naming === 'working' ? 'Читаю файл…'
    : naming === 'proposed' ? 'Enter — переименовать, Esc — отменить'
    : naming === 'error' ? problem
    : null;

  return (
    <HoverRow
      failed={isFailed}
      dragIds={openable ? [d.id] : null}
      onOpen={() => { if (openable) void window.downloadsPopover.openDownloadFile(d.id); }}
      icon={isActive
        ? <ProgressRing pct={d.totalBytes > 0 ? Math.round(d.receivedBytes / d.totalBytes * 100) : 0} known={d.totalBytes > 0} />
        : <FileWell id={d.id} bust={iconBust(d)} muted={isFailed} />}
      title={naming === 'proposed' ? (
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
            padding: `2px ${sp(2)}px`, borderRadius: RADIUS.control,
            border: '1px solid var(--accent)', background: 'var(--surface)',
            color: 'var(--text-strong)', fontSize: 'var(--fs-sm)', fontWeight: 600,
            fontFamily: 'inherit', outline: 'none',
          }}
        />
      ) : d.filename}
      meta={namingLine ?? subtitle}
      metaWarn={naming === 'error'}
      folderId={isDone && d.savePath && naming !== 'proposed' ? d.id : null}
      nameable={nameable && naming !== 'working' && naming !== 'proposed'}
      onName={askName}
      naming={naming}
      onApplyName={applyName}
      onCancelName={() => { setNaming('idle'); setDraft(''); }}
    />
  );
}

function HoverRow({
  icon, title, meta, metaWarn, failed, onOpen, dragIds,
  folderId, nameable, onName, naming, onApplyName, onCancelName,
  disclosure, expanded,
}: {
  icon: React.ReactNode;
  title: React.ReactNode;
  meta: string;
  metaWarn?: boolean;
  failed?: boolean;
  onOpen: () => void;
  dragIds?: string[] | null;
  folderId?: string | null;
  nameable?: boolean;
  onName?: () => void;
  naming?: 'idle' | 'working' | 'proposed' | 'error';
  onApplyName?: () => void;
  onCancelName?: () => void;
  disclosure?: boolean;
  expanded?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const skipClick = useRef(false);
  const canDrag = !!dragIds && dragIds.length > 0;
  const showHoverActs = hovered || naming === 'proposed';
  return (
    <div
      draggable={canDrag}
      onDragStart={canDrag ? (e) => {
        e.preventDefault();
        skipClick.current = true;
        window.downloadsPopover.startDownloadDrag(dragIds ?? []);
      } : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => {
        if (skipClick.current) { skipClick.current = false; return; }
        onOpen();
      }}
      style={{
        display: 'flex', alignItems: 'center', gap: sp(3),
        padding: `${sp(2)}px ${sp(3)}px`, borderRadius: RADIUS.control,
        background: hovered ? 'var(--surface-hover)' : 'transparent',
        cursor: 'default',
        userSelect: canDrag ? 'none' : undefined,
      }}
    >
      {icon}
      <div style={{ flex: 1, minWidth: 0 }}>
        {typeof title === 'string' ? (
          <div style={{
            ...DISPLAY_ROW,
            color: failed ? 'var(--text-muted)' : 'var(--text-strong)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{title}</div>
        ) : title}
        <div style={{
          ...TEXT.caption,
          color: metaWarn ? 'var(--tone-warm)' : 'var(--text-faint)',
          marginTop: 1,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{meta}</div>
      </div>
      <div style={{ display: 'flex', gap: 2, flex: 'none', alignItems: 'center' }}>
        {naming === 'proposed' ? (
          <>
            <IconBtn title="Переименовать" icon={<Check size={14} />} onClick={() => onApplyName?.()} />
            <IconBtn title="Отменить" icon={<X size={14} />} onClick={() => onCancelName?.()} />
          </>
        ) : (
          <>
            {nameable && showHoverActs && (
              <WordBtn onClick={() => onName?.()}><Sparkles size={13} /> Назвать</WordBtn>
            )}
            {folderId && showHoverActs && (
              <WordBtn onClick={() => void window.downloadsPopover.showDownloadFolder(folderId)}>В папке</WordBtn>
            )}
            {disclosure && (
              <ChevronRight
                size={15}
                style={{
                  flex: 'none',
                  color: 'var(--text-muted)',
                  transform: expanded ? 'rotate(90deg)' : 'none',
                  transition: motion.state('transform'),
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ActiveDownload({ entry: d }: { entry: DownloadEntry }) {
  const pct = d.totalBytes > 0 ? Math.round(d.receivedBytes / d.totalBytes * 100) : 0;
  const eta = d.isPaused ? null : formatEta(d.totalBytes - d.receivedBytes, d.bytesPerSec);
  const host = hostOf(d.url);
  const line = [
    host,
    d.totalBytes > 0 ? `${formatBytes(d.receivedBytes)} из ${formatBytes(d.totalBytes)}` : formatBytes(d.receivedBytes),
    d.isPaused ? 'на паузе' : formatSpeed(d.bytesPerSec),
    eta,
  ].filter(Boolean).join(' · ');
  return (
    <div style={{
      padding: pad(4), borderBottom: '1px solid var(--divider)',
      display: 'flex', flexDirection: 'column', gap: sp(3),
    }}>
      <span style={{ ...CAPS }}>{d.isPaused ? 'на паузе' : 'сейчас'}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: sp(3) }}>
        <ProgressRing pct={pct} known={d.totalBytes > 0} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            ...DISPLAY_CARD,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{d.filename}</div>
          <div style={{ ...TEXT.caption, color: 'var(--text-muted)', marginTop: 2 }}>{line}</div>
        </div>
      </div>
      <div style={{
        height: 5, borderRadius: RADIUS.pill, background: 'var(--surface-sunken)',
        overflow: 'hidden', position: 'relative',
      }}>
        {d.totalBytes > 0 ? (
          <div style={{
            position: 'absolute', inset: '0 auto 0 0', width: `${pct}%`,
            background: 'var(--text-strong)', borderRadius: RADIUS.pill, transition: 'width 0.2s linear',
          }} />
        ) : (
          <div style={{
            position: 'absolute', top: 0, bottom: 0, width: '25%',
            background: 'var(--text-strong)', borderRadius: RADIUS.pill,
            animation: 'oblako-progress 1.4s ease-in-out infinite',
          }} />
        )}
      </div>
      <div style={{ display: 'flex', gap: sp(2) }}>
        <WordBtn onClick={() => void (d.isPaused
          ? window.downloadsPopover.resumeDownload(d.id)
          : window.downloadsPopover.pauseDownload(d.id))}>
          {d.isPaused ? 'Продолжить' : 'Пауза'}
        </WordBtn>
        <WordBtn quiet onClick={() => void window.downloadsPopover.cancelDownload(d.id)}>Отменить</WordBtn>
      </div>
    </div>
  );
}

function WordBtn({ children, onClick, quiet = false }: {
  children: React.ReactNode; onClick: () => void; quiet?: boolean;
}) {
  const handle = useCallback((e: React.MouseEvent) => { e.stopPropagation(); onClick(); }, [onClick]);
  return (
    <button
      type="button"
      onClick={handle}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, flex: 'none',
        padding: pad(1, 3),
        border: 'none', cursor: 'default',
        borderRadius: RADIUS.pill,
        background: quiet ? 'transparent' : 'var(--surface-sunken)',
        color: quiet ? 'var(--text-muted)' : 'var(--text-body)',
        ...TEXT.caption, fontWeight: 600,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--surface-hover)';
        e.currentTarget.style.color = 'var(--text-body)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = quiet ? 'transparent' : 'var(--surface-sunken)';
        e.currentTarget.style.color = quiet ? 'var(--text-muted)' : 'var(--text-body)';
      }}
    >{children}</button>
  );
}

function IconBtn({ title, icon, onClick }: { title: string; icon: React.ReactNode; onClick: () => void }) {
  const handle = useCallback((e: React.MouseEvent) => { e.stopPropagation(); onClick(); }, [onClick]);
  return (
    <button
      title={title}
      onClick={handle}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26, padding: 0, border: 'none', cursor: 'default',
        borderRadius: RADIUS.control, background: 'transparent', color: 'var(--text-muted)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; e.currentTarget.style.color = 'var(--text-body)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
    >
      {icon}
    </button>
  );
}

// Когда скачали. ⚠️ Сегодняшнее — ЧАСАМИ, старое — ДАТОЙ: «14:20» у вчерашнего файла врёт
// (какого дня 14:20?), а «24 авг» у файла минутной давности бесполезно.
function whenLabel(ts: number): string {
  const d = new Date(ts);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay
    ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

/** Русское склонение: 1 файл, 2 файла, 5 файлов. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** Подвал — одна дверь в архив. Сломанное не разворачиваем: это не то, за чем сюда заходят. */
function doorLabel(older: number, failed: number): string {
  if (older > 0 && failed > 0) return `Ещё ${older} · ${failed} не скачалось`;
  if (older > 0) return `Ещё ${older} в загрузках`;
  if (failed > 0) return `${failed} не скачалось`;
  return 'Все загрузки';
}

// Сколько осталось ждать. ⚠️ Словами и приблизительно: точная секунда у загрузки не существует —
// скорость скачет, — а обещать её значит потом её нарушить. «Меньше минуты» честнее, чем «0:43».
function formatEta(bytesLeft: number, bytesPerSec: number): string | null {
  if (bytesPerSec <= 0 || bytesLeft <= 0) return null;
  const sec = Math.round(bytesLeft / bytesPerSec);
  if (sec < 60) return 'ещё меньше минуты';
  const min = Math.round(sec / 60);
  if (min < 60) return `ещё ~${min} мин`;
  return `ещё ~${Math.round(min / 60)} ч`;
}

installOverlayReveal();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <StandaloneLanguageProvider><DownloadsPopoverApp /></StandaloneLanguageProvider>
  </React.StrictMode>,
);
