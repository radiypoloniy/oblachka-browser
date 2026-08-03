import { File, FileText, FileArchive, FileCode, FileSpreadsheet, Image, Music, Video, Package } from 'lucide-react';
import type { DownloadState } from '../../shared/ipc';

// Общий словарь загрузок: форматирование и значок по типу файла. Живёт отдельно, потому что
// потребителей три — поповер у кнопки тулбара, полный список в разделе истории и панель Downloads;
// разъехавшиеся подписи «Готово»/«Готова» в трёх местах выглядели бы как разные функции.

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

// Тип файла определяем по РАСШИРЕНИЮ, а не по mime: сервер часто отдаёт
// application/octet-stream на всё подряд, а имя файла у нас есть всегда.
type FileKind = 'image' | 'audio' | 'video' | 'archive' | 'doc' | 'sheet' | 'code' | 'app' | 'other';

const KIND_BY_EXT: Record<string, FileKind> = {
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', svg: 'image',
  bmp: 'image', avif: 'image', heic: 'image', ico: 'image',
  mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', m4a: 'audio', aac: 'audio',
  mp4: 'video', mkv: 'video', avi: 'video', mov: 'video', webm: 'video', wmv: 'video',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', bz2: 'archive',
  pdf: 'doc', doc: 'doc', docx: 'doc', odt: 'doc', rtf: 'doc', txt: 'doc', md: 'doc', epub: 'doc',
  xls: 'sheet', xlsx: 'sheet', csv: 'sheet', ods: 'sheet',
  json: 'code', xml: 'code', html: 'code', css: 'code', js: 'code', ts: 'code', py: 'code', sh: 'code',
  exe: 'app', msi: 'app', bat: 'app', cmd: 'app', ps1: 'app', dmg: 'app', pkg: 'app', apk: 'app',
};

// Плитки берут те же токены --tile-*, что значки разделов в сайдбаре, — язык интерфейса один.
// ⚠️ Зелёного и синего здесь нет намеренно: по цветовому закону они функциональны (локальная
// модель / VPN и облако-система), и тип файла ими краситься не должен.
// ⚠️ Фиолетового нет вовсе (см. --tile-* в colors.css): картинка и код красились им и индиго,
// а сиреневый в системе не предусмотрен спекой вообще.
const KIND_STYLE: Record<FileKind, { color: string; Icon: typeof File }> = {
  image:   { color: 'var(--tile-pink)',   Icon: Image },
  audio:   { color: 'var(--tile-red)',    Icon: Music },
  video:   { color: 'var(--tile-slate)',  Icon: Video },
  archive: { color: 'var(--tile-grey)',   Icon: FileArchive },
  doc:     { color: 'var(--tile-brown)',  Icon: FileText },
  sheet:   { color: 'var(--tile-orange)', Icon: FileSpreadsheet },
  code:    { color: 'var(--tile-teal)',   Icon: FileCode },
  app:     { color: 'var(--tile-grey)',   Icon: Package },
  other:   { color: 'var(--tile-grey)',   Icon: File },
};

function kindOf(filename: string): FileKind {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return 'other';
  return KIND_BY_EXT[filename.slice(dot + 1).toLowerCase()] ?? 'other';
}

// ⚠️ Размер глифа — не «доля от плитки», а ближайшая ЧИСТАЯ доля сетки lucide (все иконки
// набора нарисованы на 24). При произвольном множителе (было 0.5 → 15 px, то есть 0.625 сетки)
// линии рисунка ложатся между пикселями: обводка выходит толщиной 1.37 px и размазывается на
// два, а мелкие детали — складка листа, ноты, клавиши — сливаются в кашу. На половине и трёх
// четвертях сетки координаты попадают на полупиксель, и глиф остаётся читаемым.
const GLYPH_STEPS = [12, 18, 24];
function glyphFor(size: number): number {
  const target = size * 0.6; // пропорция значка внутри плитки, как у iOS
  return GLYPH_STEPS.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best));
}

export function FileKindIcon({ filename, size = 30, muted = false }: {
  filename: string;
  size?: number;
  // Приглушённая плитка для строк, за которыми уже нет файла (удалён, отменён).
  muted?: boolean;
}) {
  const { color, Icon } = KIND_STYLE[kindOf(filename)];
  return (
    <span style={{
      width: size, height: size, flex: 'none',
      borderRadius: Math.round(size / 3.5),
      background: muted ? 'var(--surface-hover)' : color,
      color: muted ? 'var(--text-faint)' : '#fff',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {/* strokeWidth ровно 2 — та толщина, под которую набор и нарисован; дробные значения
          (было 2.2) съезжают с сетки вместе с рисунком. */}
      <Icon size={glyphFor(size)} strokeWidth={2} />
    </span>
  );
}
