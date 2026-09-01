import { useEffect, useState } from 'react';
import { Search, Globe } from 'lucide-react';
import type { SuggestDropdownItem } from '../../../shared/ipc';
import { siteHue } from '../desktop/siteTint';
import { RADIUS } from '../../styles/system';

// ── Значки и подписи сайтов в дропдауне омнибокса ────────────────────────────
//
// ⚠️ Вынесено из src/suggestdropdown.tsx не по вкусу, а по счёту: тот файл в базе храповика
// структуры, и исправление бага в нём (прокрутка к подсвеченной строке) добавило строк. Правило
// «файл из базы не растёт» оплачивается выносом, а не поднятием базы — и значки оказались самым
// чистым куском: ни состояния вью, ни разговора с main, ни клавиатуры.

function originOf(url: string): string | null {
  try { return new URL(url).origin; } catch { return null; }
}
function hostOf(url: string): string {
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

// Фавикон строки СПИСКА — тот же приём, что TileCard в Hub.tsx (`${origin}/favicon.ico` + onError-
// фолбэк на генерик-иконку): никакой новой инфраструктуры/IPC, страница просто пробует
// стандартный путь к иконке сайта сама. search/suggest — не страницы, для них фавикона в
// принципе не существует, там остаётся иконка-лупа, как и раньше.
export function RowIcon({ item, size }: { item: SuggestDropdownItem; size: number }) {
  const isSearchLike = item.kind === 'search' || item.kind === 'suggest';
  const [ok, setOk] = useState(true);
  const origin = isSearchLike ? null : originOf(item.url);
  if (isSearchLike || !origin || !ok) {
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
      src={`${origin}/favicon.ico`}
      alt=""
      width={size} height={size}
      style={{ borderRadius: RADIUS.tight, display: 'block', flex: 'none' }}
      onError={() => setOk(false)}
    />
  );
}

// ── Значок сайта на подложке ──────────────────────────────────────────────────────────────────
// ⚠️ Не компонент SiteIcon со стола: тот ходит за фолбэком в window.oblako (getFavicon), а у этой
// вью свой крошечный preload без боевого API. Поэтому здесь свой каскад: крупная apple-touch-icon
// первым заходом (16-пиксельная фавиконка, растянутая до 32 px, — это ровно те пиксельные
// лесенки, из-за которых плитки выглядят дёшево), затем favicon.ico, затем буква.
//
// ⚠️ Подложка ОБЩАЯ И НЕЙТРАЛЬНАЯ: значки сайтов — прозрачные PNG разной формы и плотности, без
// плашки они висят в воздухе и ряд читается как случайная россыпь. Плашка даёт всем одинаковый
// силуэт, а цвет остаётся папке (см. FOLDER_TINT_* выше).
export function SitePlate({ url, size, radius }: { url: string; size: number; radius: number }) {
  const origin = originOf(url);
  const host = hostOf(url);
  const [src, setSrc] = useState<string | null>(origin ? `${origin}/apple-touch-icon.png` : null);
  const [stage, setStage] = useState<'touch' | 'favicon' | 'letter'>(origin ? 'touch' : 'letter');

  // Адрес плитки поменялся (список пересобрался) — начинаем поиск значка заново.
  useEffect(() => {
    setSrc(origin ? `${origin}/apple-touch-icon.png` : null);
    setStage(origin ? 'touch' : 'letter');
  }, [origin]);

  const fail = () => {
    if (stage === 'touch' && origin) { setStage('favicon'); setSrc(`${origin}/favicon.ico`); return; }
    setStage('letter'); setSrc(null);
  };

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
          src={src} alt="" onError={fail}
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

