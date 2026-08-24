import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { FolderOpen, ExternalLink, RotateCcw, Pause, Play, X, ChevronRight, Download, Sparkles, Check } from 'lucide-react';
import { isDocumentFile } from '../shared/documentFormats';
import type { DownloadEntry, DuplicateDownloadPrompt, DuplicateDownloadDecision, DownloadNameSuggestion, DownloadRenameResult } from '../shared/ipc';
// ⚠️ Поверхность оверлея (непрозрачная), а не островная плита: карточка живёт в своей вью над
// страницей, где backdrop-filter не работает вовсе, и полупрозрачность означала бы
// просвечивающий текст сайта. Разбор — у --overlay-plate в styles/tokens/colors.css.
import { overlayPlate } from './styles/island';
import { FileKindIcon, formatBytes, formatSpeed } from './components/downloadsShared';
import './styles/global.css';
import { installOverlayReveal } from './overlayReveal';
import { OVERLAY_SHADOW_MARGIN as SHADOW_MARGIN } from '../shared/overlayMetrics';
import { CAPS, DISPLAY_CARD, DISPLAY_ROW, RADIUS, TEXT, pad, sp } from './styles/system';
import { groupDownloads, type DownloadPack } from '../shared/downloadGroups';
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


const CARD_WIDTH = 340;

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

  // ⚠️ Раскладка по ярусам — ЧИСТАЯ ЛОГИКА в shared/downloadGroups.ts под своей проверкой.
  // Здесь только отрисовка: правила «сутки», «пачка одного сайта за две минуты» и «потолок в
  // пачках» ломаются тихо (сегодняшний файл уезжает в «раньше», идущая проваливается из героя),
  // и ловить это на глаз бессмысленно.
  //
  // ⚠️ `now` фиксируем на кадр, а не зовём Date.now() внутри: иначе две записи на границе суток
  // могли бы разъехаться по разным ярусам в пределах одного рендера.
  const tiers = groupDownloads(entries, Date.now());

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
            title="Загрузок пока нет"
            hint="Файлы, которые вы скачаете, появятся здесь вместе с адресом страницы."
          />
        ) : (
          <>
            {tiers.active && <ActiveDownload entry={tiers.active} />}

            {tiers.today.length > 0 && (
              <>
                <TierLabel
                  title="Сегодня"
                  note={`${countOf(tiers.today)} ${plural(countOf(tiers.today), 'файл', 'файла', 'файлов')}`}
                />
                <div style={{ padding: '0 6px 4px', display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {tiers.today.map((pack) => (
                    <React.Fragment key={pack.head.id}>
                      <Row entry={pack.head} />
                      {/* ⚠️ Остаток пачки — ОДНОЙ строкой. Скачали архив картинок — десять
                          одинаковых записей с одного сайта, и это ровно та каша, из-за которой
                          список и переделан. Первая показана, остальные названы числом. */}
                      {pack.rest.length > 0 && (
                        <FoldRow
                          items={pack.rest}
                          text={`Ещё ${pack.rest.length} ${plural(pack.rest.length, 'файл', 'файла', 'файлов')} из этой пачки`}
                        />
                      )}
                    </React.Fragment>
                  ))}
                </div>
              </>
            )}

            {tiers.older.length > 0 && (
              <>
                <TierLabel title="Раньше" />
                <div style={{ padding: '0 6px 6px' }}>
                  <FoldRow
                    items={tiers.older}
                    text={`${tiers.older.length} ${plural(tiers.older.length, 'файл', 'файла', 'файлов')} за прошлые дни`}
                  />
                </div>
              </>
            )}

            {tiers.failed.length > 0 && (
              <>
                <TierLabel title="Не получилось" note={String(tiers.failed.length)} />
                <div style={{ padding: '0 6px 6px', display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {tiers.failed.map((d) => <Row key={d.id} entry={d} />)}
                </div>
              </>
            )}
          </>
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
      <PopoverActions>
        <PrimaryButton stretch onClick={() => window.downloadsPopover.decideDuplicate('open')}>
          Открыть загруженное
        </PrimaryButton>
        <QuietButton stretch onClick={() => window.downloadsPopover.decideDuplicate('download')}>
          Всё равно загрузить
        </QuietButton>
      </PopoverActions>
    </div>
  );
}

// Подпись яруса: «Сегодня · 4 файла», «Раньше», «Не получилось · 2».
//
// ⚠️ Ярусы подписаны, а не разделены пустотой: без имён три группы читались бы как один список
// с непонятными разрывами — ровно то, от чего уходили.
function TierLabel({ title, note }: { title: string; note?: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: sp(2),
      padding: `${sp(3)}px ${sp(4)}px ${sp(1)}px`,
    }}>
      <span style={{ ...CAPS }}>{title}</span>
      {note !== undefined && (
        <span style={{ ...TEXT.caption, color: 'var(--text-faint)', marginLeft: 'auto' }}>{note}</span>
      )}
    </div>
  );
}

// Свёрнутая группа: три значка типов и число. Уводит на страницу «Все загрузки».
//
// ⚠️ УВОДИТ, а не раскрывается внутри. Раскрытие упирается в потолок высоты поповера — то есть
// вернуло бы ровно ту простыню, ради ухода от которой всё и затевалось. Страница для этого и
// существует, а поповер обязан оставаться коротким.
function FoldRow({ items, text }: { items: DownloadEntry[]; text: string }) {
  return (
    <button
      onClick={() => window.downloadsPopover.openAll()}
      title="Открыть все загрузки"
      style={{
        display: 'flex', alignItems: 'center', gap: sp(3), width: '100%',
        padding: pad(2, 3), border: 'none', borderRadius: RADIUS.control,
        background: 'var(--surface-sunken)', cursor: 'default', textAlign: 'left',
        font: 'inherit',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-sunken)'; }}
    >
      <span style={{ display: 'flex', gap: 3, flex: 'none' }}>
        {items.slice(0, 3).map((d) => (
          <span key={d.id} style={{
            width: 22, height: 22, borderRadius: RADIUS.tight,
            display: 'grid', placeItems: 'center', background: 'var(--surface)',
          }}>
            <FileKindIcon filename={d.filename} size={13} />
          </span>
        ))}
      </span>
      <span style={{ flex: 1, minWidth: 0, ...TEXT.caption, color: 'var(--text-body)' }}>{text}</span>
      <ChevronRight size={14} style={{ flex: 'none', color: 'var(--text-faint)' }} />
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

/** Сколько записей стоит за пачками яруса — вместе со свёрнутыми. */
function countOf(packs: DownloadPack<DownloadEntry>[]): number {
  return packs.reduce((sum, p) => sum + 1 + p.rest.length, 0);
}

// Сколько осталось ждать. ⚠️ Словами и приблизительно: точная секунда у загрузки не существует —
// скорость скачет, — а обещать её значит потом её нарушить. «Меньше минуты» честнее, чем «0:43».
function formatEta(bytesLeft: number, bytesPerSec: number): string | null {
  if (bytesPerSec <= 0 || bytesLeft <= 0) return null;
  const sec = Math.round(bytesLeft / bytesPerSec);
  if (sec < 60) return 'осталось меньше минуты';
  const min = Math.round(sec / 60);
  if (min < 60) return `осталось ~${min} мин`;
  return `осталось ~${Math.round(min / 60)} ч`;
}

// Идущая загрузка — герой карточки.
function ActiveDownload({ entry: d }: { entry: DownloadEntry }) {
  const pct = d.totalBytes > 0 ? Math.round(d.receivedBytes / d.totalBytes * 100) : 0;
  const eta = d.isPaused ? null : formatEta(d.totalBytes - d.receivedBytes, d.bytesPerSec);
  const line = [
    d.totalBytes > 0 ? `${formatBytes(d.receivedBytes)} из ${formatBytes(d.totalBytes)}` : formatBytes(d.receivedBytes),
    d.isPaused ? 'на паузе' : formatSpeed(d.bytesPerSec),
    eta,
  ].filter(Boolean).join(' · ');
  return (
    <div style={{
      padding: `${sp(3)}px ${sp(4)}px ${sp(4)}px`, borderBottom: '1px solid var(--divider)',
      display: 'flex', flexDirection: 'column', gap: sp(2),
    }}>
      <span style={{ ...CAPS }}>{d.isPaused ? 'на паузе' : 'загружается'}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: sp(3) }}>
        <FileKindIcon filename={d.filename} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            ...DISPLAY_CARD,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{d.filename}</div>
          <div style={{ ...TEXT.caption, color: 'var(--text-muted)', marginTop: 2 }}>{line}</div>
        </div>
        <div style={{ display: 'flex', gap: 2, flex: 'none' }}>
          <IconBtn
            title={d.isPaused ? 'Продолжить' : 'Пауза'}
            icon={d.isPaused ? <Play size={14} /> : <Pause size={14} />}
            onClick={() => void (d.isPaused
              ? window.downloadsPopover.resumeDownload(d.id)
              : window.downloadsPopover.pauseDownload(d.id))}
          />
          <IconBtn title="Отменить" icon={<X size={14} />}
            onClick={() => void window.downloadsPopover.cancelDownload(d.id)} />
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
    // ⚠️ Размер И ВРЕМЯ. Голое «2,4 МБ» не отвечает ни на один вопрос, который тут задают, —
    // а «2,4 МБ · 14:20» отвечает на главный: тот это файл или прошлый с похожим именем.
    : `${formatBytes(d.totalBytes || d.receivedBytes)} · ${whenLabel(d.startedAt)}`;

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
          // ⚠️ Имя файла — ДИСПЛЕЙНОЙ. Ради него поповер и открывают, а набрано оно было тем же
          // кеглем, что размер и скорость под ним: строка читалась как три равноправных куска.
          <div style={{
            ...DISPLAY_ROW,
            color: isFailed ? 'var(--text-muted)' : 'var(--text-strong)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {d.filename}
          </div>
        )}
        {isActive && (
          <div style={{
            height: 3, borderRadius: RADIUS.pill, background: 'var(--divider)',
            overflow: 'hidden', position: 'relative', margin: '4px 0 3px',
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
          // ⚠️ КНОПКА СО СЛОВОМ, а не иконка-искра. Это самая наша функция во всём поповере —
          // модель читает файл и предлагает имя, — а узнать её можно было только наведением на
          // значок, который надо сначала заметить и угадать. Появляется по-прежнему при наведении
          // и только у документов, из которых мы умеем достать текст.
          <button
            title="Прочитать файл и предложить имя"
            onClick={(e) => { e.stopPropagation(); askName(); }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, height: 26,
              padding: `0 ${sp(2)}px`, border: 'none', cursor: 'default',
              borderRadius: RADIUS.pill, background: 'var(--surface-sunken)',
              color: 'var(--text-body)', ...TEXT.caption, fontWeight: 600,
            }}
          ><Sparkles size={13} /> Назвать</button>
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
