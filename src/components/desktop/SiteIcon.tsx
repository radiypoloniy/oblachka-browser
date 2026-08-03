import { useEffect, useState } from 'react';

// Иконка сайта на рабочем столе — квадрат со скруглением, как на домашнем экране iPad.
//
// ⚠️ Почему не просто favicon. Favicon у большинства сайтов 16×16: растянутый до 96 px он
// превращается в мыло, и весь экран выглядит дёшево. Поэтому сначала пробуем apple-touch-icon —
// сайты держат её именно для домашнего экрана, она квадратная, крупная (180×180) и уже с полями.
// Favicon остаётся запасным путём — размер значка в любом случае решает MARK_RATIO ниже.
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
  | { kind: 'touch'; src: string }    // крупная квадратная (apple-touch-icon)
  | { kind: 'favicon'; src: string; natural: number }  // значок из FaviconService
  | { kind: 'letter' };               // ничего не нашлось

// ⚠️ ОДНО правило на все виды значков: марка сайта живёт ВНУТРИ плитки с полями, а не в край.
// Разводить «apple-touch-icon — во всю плитку, favicon — с полями» бессмысленно: FaviconService
// сам ищет apple-touch-icon по разметке и отдаёт её же под видом favicon, то есть вид значка
// зависел бы от того, лежит ли она по каноническому адресу, — лотерея, а не правило.
// Сама доля выстрадана двумя крайностями: 16 px по центру плитки в 90 («супер мелкая») и значок
// в край (красный квадрат ютуба вплотную к кромке — «слишком большая»). 0.72 — то самое среднее.
const MARK_RATIO = 0.72;

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
        {(icon.kind === 'touch' || icon.kind === 'favicon') && (() => {
          const full = Math.round(size * MARK_RATIO);
          // Растягивать растр нельзя — только не растягивать: 16-пиксельный значок, раздутый до
          // 65 px, и есть те самые пиксельные лесенки. Крупный (от 32 px) чуть подтянуть можно,
          // этого глаз не ловит; мелкий рисуем по его собственному размеру.
          const dpr = window.devicePixelRatio || 1;
          const px = icon.kind === 'touch' || icon.natural >= 32
            ? full
            : Math.min(full, Math.round(icon.natural / dpr));
          return (
            <img
              src={icon.src}
              alt=""
              style={{
                width: px, height: px, objectFit: 'contain',
                // Скругление — ради непрозрачных квадратных значков (их кладут те, кто рисовал
                // иконку для домашнего экрана): без него они торчали бы острыми углами внутри
                // скруглённой плитки. Прозрачной марке скругление не видно вовсе.
                borderRadius: Math.round(px * 0.235),
              }}
            />
          );
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
