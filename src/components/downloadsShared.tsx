import { useEffect, useState } from 'react';
import type { DownloadFileIcon, DownloadState } from '../../shared/ipc';
import { createLimiter } from '../../shared/limitConcurrency';
import { DISPLAY_WELL, RADIUS } from '../styles/system';

// Общий словарь загрузок: форматирование и лунка файла как в Проводнике. Живёт отдельно,
// потому что потребителей два — поповер у кнопки тулбара и полный список в библиотеке;
// разъехавшиеся подписи и разные языки иконки выглядели бы как разные функции.

export function formatBytes(n: number): string {
  if (n <= 0) return '0 Б';
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} ГБ`;
}

export function formatSpeed(bps: number): string {
  if (bps <= 0) return '';
  if (bps < 1024) return `${bps} Б/с`;
  if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} КБ/с`;
  return `${(bps / (1024 * 1024)).toFixed(1)} МБ/с`;
}

export const STATE_LABEL: Record<DownloadState, string> = {
  progressing: 'Загрузка',
  completed:   'Готово',
  cancelled:   'Отменено',
  interrupted: 'Прервано',
};

export const STATE_COLOR: Record<DownloadState, string> = {
  progressing: 'var(--text-muted)',
  completed:   'var(--dot-local)',
  cancelled:   'var(--text-faint)',
  interrupted: 'var(--text-muted)',
};

/** Лунка превью — как иконка в Проводнике, не глиф типа. */
export const FILE_WELL = 36;

type IconApi = {
  getDownloadFileIcon?: (id: string, thumb?: boolean) => Promise<DownloadFileIcon | null>;
};

function fetchIcon(id: string, thumb: boolean): Promise<DownloadFileIcon | null> {
  const w = window as Window & { downloadsPopover?: IconApi; oblako?: IconApi };
  const api = w.downloadsPopover ?? w.oblako;
  if (!api?.getDownloadFileIcon) return Promise.resolve(null);
  return api.getDownloadFileIcon(id, thumb);
}

const iconCache = new Map<string, DownloadFileIcon | null>();
const iconInflight = new Map<string, Promise<DownloadFileIcon | null>>();
// Два сразу: строка рисуется пустой лункой, значок доезжает. Залп из трёхсот invoke на архиве
// иначе стоял бы в IPC раньше, чем main успеет ограничить getFileIcon.
const iconJobs = createLimiter(2);
const ICON_CACHE_MAX = 300;

function loadDownloadIcon(id: string, bust: string, thumb: boolean): Promise<DownloadFileIcon | null> {
  const key = `${id}\0${bust}\0${thumb ? 't' : 's'}`;
  if (iconCache.has(key)) return Promise.resolve(iconCache.get(key) ?? null);
  const pending = iconInflight.get(key);
  if (pending) return pending;
  const p = iconJobs.run(() => fetchIcon(id, thumb)).then((icon) => {
    iconCache.set(key, icon);
    iconInflight.delete(key);
    while (iconCache.size > ICON_CACHE_MAX) {
      const first = iconCache.keys().next().value;
      if (first === undefined) break;
      iconCache.delete(first);
    }
    return icon;
  }, () => {
    iconInflight.delete(key);
    return null;
  });
  iconInflight.set(key, p);
  return p;
}

function useDownloadIcon(id: string, bust: string, thumb: boolean, missing: boolean): DownloadFileIcon | null {
  const key = `${id}\0${bust}\0${thumb ? 't' : 's'}`;
  const [icon, setIcon] = useState<DownloadFileIcon | null>(() => (missing ? null : iconCache.get(key) ?? null));
  useEffect(() => {
    if (missing) { setIcon(null); return; }
    let live = true;
    const cached = iconCache.get(key);
    if (cached !== undefined) { setIcon(cached); return; }
    setIcon(null);
    void loadDownloadIcon(id, bust, thumb).then((next) => { if (live) setIcon(next); });
    return () => { live = false; };
  }, [id, bust, thumb, missing, key]);
  return icon;
}

export function FileWell({
  id, bust = '', muted = false, size = FILE_WELL, framed = true, missing = false, thumb = true,
}: {
  id: string;
  /** Смена имени/пути/состояния сбрасывает кэш — иначе после «Назвать» остался бы старый кадр. */
  bust?: string;
  muted?: boolean;
  size?: number;
  /** false — только пиксели, рамку лунки рисует родитель (стопка фото). */
  framed?: boolean;
  /** Пропавший файл — пустая лунка, без IPC: архив из сотен «нет на диске» иначе штурмовал main. */
  missing?: boolean;
  /** false в архиве: кадр JPEG декодируется в main синхронно и подвешивает окно. */
  thumb?: boolean;
}) {
  const icon = useDownloadIcon(id, bust, thumb, missing);
  const isThumb = icon?.kind === 'thumb';
  // Подложка только у кадра. Значок Проводника уже с собственным краем — прямоугольник под ним
  // читается как рамка, которой в системе нет.
  const well = framed && isThumb;
  return (
    <span
      aria-hidden="true"
      style={{
        width: size, height: size, flex: 'none',
        borderRadius: well ? RADIUS.control : 0,
        overflow: 'hidden', display: 'block', position: 'relative',
        background: well ? 'var(--surface-sunken)' : 'transparent',
        boxShadow: well ? '0 0 0 1px var(--divider)' : undefined,
        opacity: muted ? 0.42 : 1,
      }}
    >
      {icon && (
        <img
          alt=""
          src={icon.url}
          style={{
            display: 'block', width: '100%', height: '100%',
            objectFit: isThumb ? 'cover' : 'contain',
          }}
        />
      )}
    </span>
  );
}

/** Стопка кадров пачки фото: три превью, последнее сверху. */
export function ThumbStack({ ids, busts }: { ids: string[]; busts: string[] }) {
  const shown = ids.slice(0, 3).reverse();
  const shownBusts = busts.slice(0, 3).reverse();
  const inner = 26;
  return (
    <span aria-hidden="true" style={{ width: 44, height: FILE_WELL, position: 'relative', flex: 'none' }}>
      {shown.map((id, i) => {
        const fromBack = shown.length - 1 - i;
        return (
          <span key={id} style={{
            position: 'absolute',
            left: fromBack * 8,
            top: fromBack === 0 ? 8 : fromBack === 1 ? 4 : 0,
            transform: fromBack === 0 ? 'none' : fromBack === 1 ? 'rotate(-7deg)' : 'rotate(9deg)',
            zIndex: i,
            width: inner, height: inner,
            borderRadius: RADIUS.tight,
            overflow: 'hidden',
            boxShadow: '0 0 0 1px var(--surface), 0 1px 3px color-mix(in srgb, var(--shadow-tint) 18%, transparent)',
          }}>
            <FileWell id={id} bust={shownBusts[i] ?? ''} size={inner} framed={false} />
          </span>
        );
      })}
    </span>
  );
}

/** Кольцо прогресса героя. Пока размер неизвестен — пустой круг, полоска под ним бежит сама. */
export function ProgressRing({ pct, known }: { pct: number; known: boolean }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  const dash = known ? (Math.min(100, Math.max(0, pct)) / 100) * c : 0;
  return (
    <span aria-hidden="true" style={{ width: FILE_WELL, height: FILE_WELL, flex: 'none', position: 'relative' }}>
      <svg width={FILE_WELL} height={FILE_WELL} viewBox={`0 0 ${FILE_WELL} ${FILE_WELL}`} style={{ display: 'block', transform: 'rotate(-90deg)' }}>
        <circle cx={FILE_WELL / 2} cy={FILE_WELL / 2} r={r} fill="none" stroke="var(--surface-sunken)" strokeWidth={3} />
        <circle
          cx={FILE_WELL / 2} cy={FILE_WELL / 2} r={r} fill="none"
          stroke="var(--text-strong)" strokeWidth={3} strokeLinecap="round"
          strokeDasharray={`${dash.toFixed(1)} ${c.toFixed(1)}`}
        />
      </svg>
      {known && (
        <b style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
          ...DISPLAY_WELL,
        }}>{pct}</b>
      )}
    </span>
  );
}
