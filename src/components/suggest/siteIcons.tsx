import { useEffect, useState } from 'react';
import { Search, Globe } from 'lucide-react';
import type { SuggestDropdownItem } from '../../../shared/ipc';
import { siteHue } from '../desktop/siteTint';
import { RADIUS } from '../../styles/system';

// ── Значки и подписи сайтов в дропдауне омнибокса ────────────────────────────
//
// ⚠️ Вынесено из src/suggestdropdown.tsx не по вкусу, а по счёту: тот файл в базе храповика
// структуры, и исправление бага в нём (прокрутка к подсвеченной строке) добавило строк. Правило
// «файл из базы не растёт» оплачивается выносом, а не поднятием базы. Значки плитки идут в main
// тем же FAVICON_GET, что пароли и буфер, — не угадыванием /favicon.ico.

export function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

// Подпись плитки. ⚠️ Полный домен под иконкой — самая шумная часть плитки: «remna.oblaconnection.com»
// съедает две строки и читается как техническая строка, а не как имя сайта. Отрезаем доменную зону
// (её человек и так не проговаривает), оставляя узнаваемое имя: youtube, snob, daily.afisha.
// Косметика и только: адрес перехода берётся из item.url, а не отсюда.
const PUBLIC_SUFFIX = /\.(com|net|org|info|biz|io|dev|app|ai|me|tv|co|xyz|online|site|shop|store|cloud|ru|su|рф|ua|by|kz|de|fr|uk|nl|pl|it|es|cz|tr|cn|jp|kr|in|br|ca|au)(\.[a-z]{2})?$/i;
export function siteLabel(url: string): string {
  const host = hostOf(url);
  const short = host.replace(PUBLIC_SUFFIX, '');
  return short.length >= 2 ? short : host;
}

// «32 запроса», а не «32 запросов» — счётчик стоит на видном месте, и кривая форма бросается в
// глаза первой (живая жалоба по скриншоту).
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

// ⚠️ ЦВЕТ ЖИВЁТ НА ПАПКЕ, А НЕ НА ЗНАЧКЕ. Прошлый заход красил подложку каждого значка в
// собственный оттенок домена — восемь разноцветных квадратиков в ряд читались как рябь, а не как
// набор сайтов («я не просил красить иконки в разные цвета»). Теперь значок всегда на НЕЙТРАЛЬНОЙ
// белой подложке с тенью — ровно как закреплённые вкладки в сайдбаре (см. IconCell в Sidebar.tsx:
// var(--surface) + var(--shadow-card) + var(--radius-sm)), — а покрашен фон ПАПКИ, которая их
// объединяет. Цвет так работает на группировку, а не против неё.

// Кэш обещаний на модуль: восемь плиток часто делят хост со строками списка, и без него это
// были бы одинаковые IPC на каждый маунт. Main тоже кэширует, но спамить незачем.
const iconCache = new Map<string, Promise<string | null>>();
function loadIcon(host: string): Promise<string | null> {
  let p = iconCache.get(host);
  if (!p) {
    p = window.suggestDropdown.favicon(host).catch(() => null);
    iconCache.set(host, p);
  }
  return p;
}

function useHostIcon(url: string): string | null {
  const host = hostOf(url);
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!host) { setSrc(null); return; }
    let alive = true;
    setSrc(null);
    void loadIcon(host).then((d) => { if (alive) setSrc(d); });
    return () => { alive = false; };
  }, [host]);
  return src;
}

// Фавикон строки СПИСКА. search/suggest — не страницы, фавикона нет, остаётся лупа.
// Остальным — FaviconService через тот же FAVICON_GET, что у паролей и буфера: угадывать
// /favicon.ico вью больше не должна (у большинства сайтов его по этому пути нет).
export function RowIcon({ item, size }: { item: SuggestDropdownItem; size: number }) {
  const isSearchLike = item.kind === 'search' || item.kind === 'suggest';
  const src = useHostIcon(isSearchLike ? '' : item.url);
  if (isSearchLike || !src) {
    const Icon = isSearchLike ? Search : Globe;
    return (
      <span style={{
        width: size, height: size, flex: 'none',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--text-faint)',
      }}>
        <Icon size={Math.round(size * 0.62)} />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      width={size} height={size}
      style={{ borderRadius: RADIUS.tight, display: 'block', flex: 'none' }}
    />
  );
}

// ── Значок сайта на подложке ──────────────────────────────────────────────────────────────────
// ⚠️ Не компонент SiteIcon со стола: тот ходит в window.oblako, а у этой вью свой preload.
// Канал тот же (FAVICON_GET) — как у поповера буфера. Угадывать apple-touch/favicon.ico здесь
// нельзя: большинство сайтов кладёт иконку в <link>, и плитка оставалась буквой.
//
// ⚠️ Подложка ОБЩАЯ И НЕЙТРАЛЬНАЯ: значки сайтов — прозрачные PNG разной формы и плотности, без
// плашки они висят в воздухе и ряд читается как случайная россыпь. Плашка даёт всем одинаковый
// силуэт, а цвет остаётся папке (см. FOLDER_TINT_* выше).
export function SitePlate({ url, size, radius }: { url: string; size: number; radius: number }) {
  const host = hostOf(url);
  const src = useHostIcon(url);

  return (
    <span
      className="omni-plate"
      style={{
        width: size, height: size, flex: 'none', borderRadius: radius,
        background: 'var(--surface)', boxShadow: 'var(--shadow-card)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
      }}
    >
      {src ? (
        <img
          src={src} alt=""
          style={{ width: Math.round(size * 0.58), height: Math.round(size * 0.58), objectFit: 'contain', display: 'block' }}
        />
      ) : (
        // Буква — единственное место, где оттенок домена ещё нужен: без значка плашки сайтов
        // иначе неразличимы. Красится ТЕКСТ, не подложка.
        <span style={{
          fontWeight: 600, fontSize: Math.round(size * 0.42),
          color: `hsl(${siteHue(host)} 50% 45%)`,
        }}>
          {(host[0] ?? '?').toUpperCase()}
        </span>
      )}
    </span>
  );
}

