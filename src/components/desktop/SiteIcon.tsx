import { useEffect, useState } from 'react';

// Иконка сайта на рабочем столе — квадрат со скруглением, как на домашнем экране iPad.
//
// ⚠️ Почему не просто favicon. Favicon у большинства сайтов 16×16: растянутый до 96 px он
// превращается в мыло, и весь экран выглядит дёшево. Поэтому сначала пробуем apple-touch-icon —
// сайты держат её именно для домашнего экрана, она квадратная, крупная (180×180) и уже с полями.
// Favicon остаётся запасным путём: тогда рисуем его мелко по центру подложки, а не растягиваем.
//
// Загрузку apple-touch-icon делает сам renderer обычной <img>: это картинка с того же адреса,
// который человек и так открывает, никакого нового доступа она не требует. Ответ от FaviconService
// (main) используется как фолбэк — он уже умеет ходить только на сам домен, без сторонних
// favicon-сервисов.

interface Props {
  url: string;
  title: string;
  /** Сторона иконки в px — приходит из размера клетки сетки. */
  size: number;
  onOpen: (url: string) => void;
  /** Подпись под иконкой рисуется светлой на обоях и тёмной на белом фоне. */
  labelColor: string;
  labelShadow?: string;
}

type IconState =
  | { kind: 'loading' }
  | { kind: 'touch'; src: string }    // крупная квадратная — на всю плитку
  | { kind: 'favicon'; src: string; natural: number }  // мелкая — по центру подложки
  | { kind: 'letter' };               // ничего не нашлось

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}


export default function SiteIcon({ url, title, size, onOpen, labelColor, labelShadow }: Props) {
  const [icon, setIcon] = useState<IconState>({ kind: 'loading' });
  const host = hostOf(url);

  useEffect(() => {
    let alive = true;
    if (!host) { setIcon({ kind: 'letter' }); return; }

    // Пробуем apple-touch-icon напрямую: если её нет, <img> просто не загрузится.
    const probe = new Image();
    probe.onload = () => {
      // Совсем мелкую подсунутую заглушку за «крупную иконку» не принимаем.
      if (alive) setIcon(probe.naturalWidth >= 64 ? { kind: 'touch', src: probe.src } : { kind: 'letter' });
    };
    probe.onerror = () => {
      if (!alive) return;
      // Запасной путь — favicon из main (кэш на диске + память, ходит только на сам домен).
      void window.oblako.getFavicon(host).then((data) => {
        if (!alive) return;
        if (!data) { setIcon({ kind: 'letter' }); return; }
        // ⚠️ Запоминаем СОБСТВЕННЫЙ размер значка. Без него мы растягивали 16-пиксельную
        // фавиконку до 60 px и получали ровно те пиксельные лесенки, на которые жалуются:
        // растянуть растр без потерь нельзя, можно только не растягивать.
        const probe = new Image();
        probe.onload = () => { if (alive) setIcon({ kind: 'favicon', src: data, natural: probe.naturalWidth || 16 }); };
        probe.onerror = () => { if (alive) setIcon({ kind: 'favicon', src: data, natural: 16 }); };
        probe.src = data;
      }).catch(() => { if (alive) setIcon({ kind: 'letter' }); });
    };
    probe.src = `https://${host}/apple-touch-icon.png`;

    return () => { alive = false; };
  }, [host]);

  const radius = Math.round(size * 0.235); // пропорция скругления иконок iOS
  const label = title || host;

  return (
    <button
      onClick={() => onOpen(url)}
      title={label}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
        width: '100%', height: '100%', padding: 0, border: 'none',
        background: 'transparent', cursor: 'default',
      }}
    >
      <span style={{
        width: size, height: size, borderRadius: radius, flex: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        overflow: 'hidden',
        // ⚠️ Подложка БЕЛАЯ у всех видов, а не выведенный из домена цвет. Хешированный оттенок
        // задумывался как способ различать плитки, но на деле давал случайные пятна: сайт с
        // прозрачным логотипом получал фон, к которому не имеет никакого отношения — красный
        // ютуб рядом с зелёным конвертером выглядели набором чужих наклеек. Белая плитка с
        // тенью — то же, что у иконок приложений на светлом фоне: форма читается, а цвет несёт
        // сам логотип, которому для этого никто не мешает.
        background: 'var(--surface-solid)',
        border: '1px solid var(--divider)',
        boxShadow: 'var(--appicon-shadow)',
      }}>
        {icon.kind === 'touch' && (
          <img src={icon.src} alt="" width={size} height={size} style={{ width: size, height: size, objectFit: 'cover' }} />
        )}
        {icon.kind === 'favicon' && (() => {
          // ⚠️ ЛЕСТНИЦА по собственному размеру значка, а не одно правило на всех. Прошлый заход
          // менял крайности местами: сперва любую фавиконку растягивали до 62% плитки (крупно,
          // но в лесенках), потом жёстко запретили растягивать (чётко, но 16 px посреди плитки
          // в 90 — это и есть «супер мелкая»). Ни то, ни другое не годится, потому что значки
          // приходят РАЗНЫЕ: FaviconService нарочно ищет крупный (apple-touch-icon и
          // <link sizes>), и когда он его находит, значок обязан занять плитку целиком.
          //  • от 64 px — настоящая иконка приложения, кладём во всю плитку;
          //  • 32…63 — приличный значок, даём 62% и чуть-чуть растягиваем, это незаметно;
          //  • меньше 32 — только по своему размеру, растягивать нечего.
          const dpr = window.devicePixelRatio || 1;
          const nat = icon.natural;
          if (nat >= 64) {
            return <img src={icon.src} alt="" width={size} height={size} style={{ width: size, height: size, objectFit: 'cover' }} />;
          }
          const px = nat >= 32
            ? Math.round(size * 0.62)
            : Math.min(Math.round(size * 0.62), Math.round(nat / dpr));
          return <img src={icon.src} alt="" style={{ width: px, height: px, objectFit: 'contain' }} />;
        })()}
        {(icon.kind === 'letter' || icon.kind === 'loading') && (
          <span style={{
            fontSize: Math.round(size * 0.42), fontWeight: 600, lineHeight: 1,
            // На белой плитке белая буква не видна — берём цвет текста темы.
            color: 'var(--text-muted)',
            // Пока идёт проверка иконки, буква уже стоит на месте: подмена картинкой не двигает
            // раскладку, а пустая плитка выглядела бы поломкой.
            opacity: icon.kind === 'loading' ? 0.75 : 1,
          }}>
            {(label.charAt(0) || '?').toUpperCase()}
          </span>
        )}
      </span>
      <span style={{
        maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        fontSize: 'var(--fs-xs)', fontWeight: 500, color: labelColor, textShadow: labelShadow,
      }}>{label}</span>
    </button>
  );
}
