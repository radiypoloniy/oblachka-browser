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
  | { kind: 'favicon'; src: string }  // мелкая — по центру подложки
  | { kind: 'letter' };               // ничего не нашлось

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

// Цвет подложки под мелкую иконку и под букву. Берём из имени домена — так две разные плитки
// не сливаются в одинаковые серые квадраты, а цвет у сайта всегда один и тот же.
function tintFor(host: string): string {
  let hash = 0;
  for (let i = 0; i < host.length; i++) hash = (hash * 31 + host.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `linear-gradient(180deg, hsl(${hue} 62% 62%), hsl(${hue} 58% 48%))`;
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
        setIcon(data ? { kind: 'favicon', src: data } : { kind: 'letter' });
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
        background: icon.kind === 'touch' ? 'var(--surface-solid)' : tintFor(host),
        boxShadow: 'var(--appicon-shadow)',
      }}>
        {icon.kind === 'touch' && (
          <img src={icon.src} alt="" width={size} height={size} style={{ width: size, height: size, objectFit: 'cover' }} />
        )}
        {icon.kind === 'favicon' && (
          <img src={icon.src} alt="" style={{ width: Math.round(size * 0.5), height: Math.round(size * 0.5), objectFit: 'contain' }} />
        )}
        {(icon.kind === 'letter' || icon.kind === 'loading') && (
          <span style={{
            fontSize: Math.round(size * 0.42), fontWeight: 600, lineHeight: 1,
            color: 'var(--appicon-glyph)',
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
