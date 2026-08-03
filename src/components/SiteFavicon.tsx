import { useEffect, useState } from 'react';

// Значок сайта для строк архива (История, Закладки). Тянется через FaviconService в main — то
// есть ТОЛЬКО с самого домена, без сторонних favicon-сервисов: приватный браузер не должен
// светить список посещённого третьей стороне (см. electron/FaviconService.ts).
//
// ⚠️ Пока иконка едет — на её месте стоит буква домена, ровно того же размера. Это не украшение:
// подмена картинкой не должна двигать строку, иначе список дёргается по мере загрузки значков,
// а их там сотни.
//
// Кэш обещаний — общий на модуль: один и тот же домен встречается в списке десятки раз, и без
// него это были бы десятки одинаковых IPC-запросов (main тоже кэширует, но спамить незачем).
const cache = new Map<string, Promise<string | null>>();

function load(host: string): Promise<string | null> {
  let p = cache.get(host);
  if (!p) { p = window.oblako.getFavicon(host); cache.set(host, p); }
  return p;
}

export default function SiteFavicon({ url, size = 20 }: { url: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();

  useEffect(() => {
    if (!host) return;
    let alive = true;
    setSrc(null);
    void load(host).then((d) => { if (alive) setSrc(d); }).catch(() => { /* останется буква */ });
    return () => { alive = false; };
  }, [host]);

  const box: React.CSSProperties = {
    width: size, height: size, flexShrink: 0, borderRadius: 'var(--radius-sm)',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  };

  if (src) {
    return (
      <span style={box}>
        <img src={src} alt="" width={size} height={size} style={{ objectFit: 'contain' }} />
      </span>
    );
  }
  return (
    <span style={{
      ...box, background: 'var(--neutral-300)', color: 'var(--text-body)',
      fontSize: Math.round(size * 0.5), fontWeight: 600,
    }}>
      {(host.replace(/^www\./, '').charAt(0) || '?').toUpperCase()}
    </span>
  );
}
