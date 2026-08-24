import { useEffect, useMemo, useState } from 'react';
import { X, FolderOpen, ExternalLink, RotateCcw, Pause, Play, XCircle, Trash2 } from 'lucide-react';
import type { DownloadEntry } from '../../shared/ipc';
import { RADIUS, sp } from '../styles/system';
import { packBySite, type DownloadPack } from '../../shared/downloadGroups';
// Форматирование, подписи состояний и значок по типу файла — общие с поповером у кнопки тулбара
// (см. downloadsShared.tsx): один и тот же файл в двух местах должен выглядеть одинаково.
import { FileKindIcon, formatBytes, formatSpeed } from './downloadsShared';
import { EmptyState } from './EmptyState';
import { DownloadGlyph } from './glyphs';
import { GroupCap, Row, Rows, type LibrarySummary } from './library/kit';
import { btnGhost } from './settings/kit';

// Раздел «Загрузки» большого меню. Своей шапки, своего крестика и своего поля поиска здесь
// БОЛЬШЕ НЕТ — всё это переехало в оболочку библиотеки (LibraryShell): раньше пять разделов
// несли пять разных шапок и четыре одинаковые кнопки «закрыть», хотя закрывают они вкладку.

interface DownloadsProps {
  downloads: DownloadEntry[];
  /** Строка поиска — общая на всю библиотеку, живёт в оболочке. */
  query: string;
  /** Раздел сам знает свои числа; шапка библиотеки их только показывает. */
  onSummary: (s: LibrarySummary) => void;
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

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function timeOf(ts: number): string {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export default function Downloads({ downloads, query, onSummary }: DownloadsProps) {
  const hasFinished = downloads.some((d) => d.state !== 'progressing');
  const [openPacks, setOpenPacks] = useState<Record<string, boolean>>({});

  // Фильтр по общей строке поиска: имя файла или сайт, откуда он приехал.
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return downloads;
    return downloads.filter((d) =>
      d.filename.toLowerCase().includes(q) || hostOf(d.url).toLowerCase().includes(q));
  }, [downloads, query]);

  // Группировка по дням в том порядке, в каком записи уже пришли (свежие сверху) — своей
  // сортировки не заводим, порядок списка задаёт DownloadManager. Внутри дня записи одного
  // сайта, приехавшие подряд, сворачиваются в пачку (shared/downloadGroups.ts).
  const dayGroups = useMemo(() => {
    const groups: { key: string; label: string; packs: DownloadPack<DownloadEntry>[]; count: number }[] = [];
    for (const d of shown) {
      const key = dayKeyOf(d.startedAt);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.count += 1;
      else groups.push({ key, label: dayLabelOf(d.startedAt), packs: [], count: 1 });
    }
    // Пачки считаем внутри уже собранного дня: склеивать через границу суток нельзя.
    for (const g of groups) {
      g.packs = packBySite(shown.filter((d) => dayKeyOf(d.startedAt) === g.key));
    }
    return groups;
  }, [shown]);

  // ⚠️ Числа шапки считаются ЗДЕСЬ и из уже пришедшего массива: раздел знает свои данные, а
  // оболочка — нет. Сообщаем наверх эффектом, а не вызовом в теле рендера: setState чужого
  // компонента во время своего рендера React запрещает.
  const totalBytes = downloads.reduce((sum, d) => sum + (d.totalBytes || d.receivedBytes), 0);
  const todayCount = downloads.filter((d) => dayKeyOf(d.startedAt) === dayKeyOf(Date.now())).length;
  const failedCount = downloads.filter((d) =>
    d.state === 'interrupted' || d.state === 'cancelled' || (d.state === 'completed' && d.fileMissing)).length;
  useEffect(() => {
    onSummary({
      hero: downloads.length === 0 ? '—' : formatBytes(totalBytes),
      heroLabel: downloads.length === 0
        ? 'вы пока ничего не скачивали'
        : `в ${downloads.length} ${plural(downloads.length, 'файле', 'файлах', 'файлах')}`,
      facts: [
        { label: 'Файлов', hint: 'за всё время', value: String(downloads.length), active: downloads.length > 0 },
        { label: 'Занимают', hint: 'на диске', value: downloads.length === 0 ? '—' : formatBytes(totalBytes), active: downloads.length > 0 },
        { label: 'Сегодня', hint: 'скачано', value: String(todayCount), active: todayCount > 0 },
        { label: 'Не получилось', hint: 'прервано или пропало', value: String(failedCount) },
      ],
    });
  }, [onSummary, downloads.length, totalBytes, todayCount, failedCount]);

  function clearFinished() {
    const finished = downloads.filter((d) => d.state !== 'progressing');
    for (const d of finished) {
      void window.oblako.clearDownload(d.id);
    }
  }

  if (downloads.length === 0) {
    return (
      <EmptyState
        icon={<DownloadGlyph size={22} />}
        title="Загрузок пока нет"
        hint="Файлы, которые вы скачаете, останутся здесь — вместе с адресом страницы, откуда они пришли."
      />
    );
  }

  if (shown.length === 0) {
    return (
      <EmptyState
        icon={<DownloadGlyph size={22} />}
        title="Ничего не нашлось"
        hint="Поиск смотрит по имени файла и по сайту, откуда он приехал."
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(3) }}>
      {hasFinished && (
        <div style={{ display: 'flex' }}>
          <button
            onClick={clearFinished}
            style={{ ...btnGhost, marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: sp(2) }}
          ><Trash2 size={14} /> Очистить завершённые</button>
        </div>
      )}
      <Rows>
        {dayGroups.map((g) => (
          <div key={g.key}>
            <GroupCap title={g.label} note={`${g.count} ${plural(g.count, 'файл', 'файла', 'файлов')}`} />
            {g.packs.map((pack) => (
              <div key={pack.head.id}>
                <DownloadRow entry={pack.head} />
                {/* ⚠️ Пачка РАЗВОРАЧИВАЕТСЯ НА МЕСТЕ, а не уводит на страницу, как в поповере:
                    здесь и есть та страница, уводить некуда, а потолка высоты нет. */}
                {pack.rest.length > 0 && (openPacks[pack.head.id]
                  ? pack.rest.map((d) => <DownloadRow key={d.id} entry={d} />)
                  : (
                    <Row
                      lead=""
                      icon={<span style={{ display: 'flex', gap: 3, flex: 'none' }}>
                        {pack.rest.slice(0, 3).map((d) => (
                          <span key={d.id} style={{
                            width: 22, height: 22, borderRadius: RADIUS.tight,
                            display: 'grid', placeItems: 'center', background: 'var(--surface-sunken)',
                          }}><FileKindIcon filename={d.filename} size={13} /></span>
                        ))}
                      </span>}
                      title={`Ещё ${pack.rest.length} ${plural(pack.rest.length, 'файл', 'файла', 'файлов')} из этой пачки`}
                      subtitle={hostOf(pack.head.url)}
                      meta="развернуть"
                      onClick={() => setOpenPacks((p) => ({ ...p, [pack.head.id]: true }))}
                    />
                  ))}
              </div>
            ))}
          </div>
        ))}
      </Rows>
    </div>
  );
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

// Строка загрузки — общий рецепт библиотеки: слева время, дальше значок типа, имя дисплейной,
// под ним размер и сайт моноширинным, справа действия.
function DownloadRow({ entry: d }: { entry: DownloadEntry }) {
  const isActive = d.state === 'progressing';
  const isGone   = d.state === 'completed' && !!d.fileMissing;
  const isDone   = d.state === 'completed' && !isGone;
  const isFailed = d.state === 'interrupted' || d.state === 'cancelled' || isGone;
  const pct      = d.totalBytes > 0 ? Math.round(d.receivedBytes / d.totalBytes * 100) : 0;
  const size     = d.totalBytes > 0
    ? `${formatBytes(d.receivedBytes)} из ${formatBytes(d.totalBytes)}`
    : formatBytes(d.receivedBytes);
  const sub = isActive
    ? `${size} · ${d.isPaused ? 'на паузе' : formatSpeed(d.bytesPerSec)}`
    : isGone ? 'файла на месте нет'
      : d.state === 'cancelled' ? 'отменено'
        : d.state === 'interrupted' ? 'прервано'
          : `${formatBytes(d.totalBytes || d.receivedBytes)} · ${hostOf(d.url)}`;

  return (
    <Row
      lead={isActive || isFailed ? '' : timeOf(d.startedAt)}
      icon={<FileKindIcon filename={d.filename} size={22} muted={isFailed} />}
      title={d.filename}
      subtitle={sub}
      title2={d.url}
      onClick={isDone && d.savePath ? () => void window.oblako.openDownloadFile(d.id) : undefined}
      meta={isActive && d.totalBytes > 0 ? `${pct} %` : undefined}
      actions={(
        <>
          {isActive && (
            <IconBtn
              title={d.isPaused ? 'Продолжить' : 'Пауза'}
              onClick={() => void (d.isPaused
                ? window.oblako.resumeDownload(d.id)
                : window.oblako.pauseDownload(d.id))}
            >{d.isPaused ? <Play size={14} /> : <Pause size={14} />}</IconBtn>
          )}
          {isActive && (
            <IconBtn title="Отменить" onClick={() => void window.oblako.cancelDownload(d.id)}>
              <XCircle size={14} />
            </IconBtn>
          )}
          {isDone && d.savePath && (
            <>
              <IconBtn title="Открыть" onClick={() => void window.oblako.openDownloadFile(d.id)}>
                <ExternalLink size={14} />
              </IconBtn>
              <IconBtn title="Показать в папке" onClick={() => void window.oblako.showDownloadFolder(d.id)}>
                <FolderOpen size={14} />
              </IconBtn>
            </>
          )}
          {isFailed && (
            <IconBtn title="Скачать заново" onClick={() => void window.oblako.retryDownload(d.id)}>
              <RotateCcw size={14} />
            </IconBtn>
          )}
          <IconBtn title="Убрать из списка" onClick={() => void window.oblako.clearDownload(d.id)}>
            <X size={14} />
          </IconBtn>
        </>
      )}
    />
  );
}

// Кнопка-значок строки. ⚠️ Видна ВСЕГДА, а не по наведению: в длинном списке «наведи, чтобы
// увидеть» — это игра в прятки, а раньше действия загрузки прятались именно так.
function IconBtn({ title, onClick, children }: {
  title: string; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26, padding: 0, border: 'none', cursor: 'default',
        borderRadius: RADIUS.control, background: 'transparent', color: 'var(--text-faint)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-sunken)'; e.currentTarget.style.color = 'var(--text-body)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-faint)'; }}
    >{children}</button>
  );
}
