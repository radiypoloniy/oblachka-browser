import { useEffect, useRef, useState } from 'react';
import type React from 'react';

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

// ⚠️ ЗНАЧОК ПРОСИТСЯ, ТОЛЬКО КОГДА СТРОКУ ВИДНО. История отдаёт до 500 записей, а на экране их
// пятнадцать — до этой правки список просил иконку для всех сразу. Каждая незнакомая иконка это
// поход В СЕТЬ сессией профиля (то есть через VPN, если он включён), и до трёх запросов на домен:
// FaviconService сначала пробует /favicon.ico, потом саму страницу, потом apple-touch-icon. Отсюда
// и брался «первый раз медленно, дальше нормально»: со второго раза всё лежит в кэше на диске.
//
// ⚠️ Приём не новый для проекта: ровно так же устроен Favicon в settings/kit.tsx (список
// исключений адблока — те же сотни строк). Здесь он просто не был применён.

function load(host: string, fetcher: (h: string) => Promise<string | null>): Promise<string | null> {
  let p = cache.get(host);
  if (!p) { p = fetcher(host); cache.set(host, p); }
  return p;
}

// ⚠️ `loadIcon` существует ради изолированных вью (поповер буфера): у них свой preload и боевого
// window.oblako там нет вовсе, а канал FAVICON_GET — тот же самый. Без этого параметра пришлось бы
// держать вторую копию компонента, которая разъедется с этой на первой же правке.
export default function SiteFavicon({ url, size = 20, loadIcon }: {
  url: string;
  size?: number;
  loadIcon?: (host: string) => Promise<string | null>;
}) {
  const [src, setSrc] = useState<string | null>(null);
  // Строку показали хоть раз — дальше значок грузится и остаётся, даже если она уехала за экран.
  const [seen, setSeen] = useState(false);
  const boxRef = useRef<HTMLSpanElement | null>(null);
  const host = (() => { try { return new URL(url).hostname; } catch { return ''; } })();

  useEffect(() => {
    if (seen) return;
    const el = boxRef.current;
    // IntersectionObserver может быть недоступен только в экзотике; тогда честнее показать
    // иконки, чем не показать их никогда.
    if (!el || typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver((entries) => {
      // rootMargin — запас на быструю прокрутку: значок успевает приехать до того, как строка
      // окажется под глазами.
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  useEffect(() => {
    if (!host) return;
    // Уже спрашивали этот домен в этом сеансе — отдаём сразу, не дожидаясь видимости: запроса
    // всё равно не будет, а мигание буквой при возврате к списку выглядит как подгрузка заново.
    if (!seen && !cache.has(host)) return;
    let alive = true;
    setSrc(null);
    const fetcher = loadIcon ?? ((h: string) => window.oblako.getFavicon(h));
    void load(host, fetcher).then((d) => { if (alive) setSrc(d); }).catch(() => { /* останется буква */ });
    return () => { alive = false; };
  }, [host, seen, loadIcon]);

  const box: React.CSSProperties = {
    width: size, height: size, flexShrink: 0, borderRadius: 'var(--radius-sm)',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  };

  if (src) {
    return (
      <span ref={boxRef} style={box}>
        <img src={src} alt="" width={size} height={size} style={{ objectFit: 'contain' }} />
      </span>
    );
  }
  return (
    <span ref={boxRef} style={{
      ...box, background: 'var(--neutral-300)', color: 'var(--text-body)',
      fontSize: Math.round(size * 0.5), fontWeight: 600,
    }}>
      {(host.replace(/^www\./, '').charAt(0) || '?').toUpperCase()}
    </span>
  );
}

/**
 * Готовая ссылка на значок — с честным откатом.
 *
 * ⚠️ Отличается от SiteFavicon выше тем, ОТКУДА берётся картинка. Тот сам спрашивает иконку у
 * main по хосту (архив, сотни строк, общий кэш); здесь ссылка уже есть — её отдал Chromium вместе
 * с состоянием вкладки.
 *
 * ⚠️ И ровно в этих местах не было обработки ошибки: сайдбар, цели быстрого поиска, карточка
 * перетаскиваемой вкладки. Стоит ссылке протухнуть — сайт сменил иконку, ресурс не отдаётся через
 * VPN, кэш подрезан — и Chromium рисует СВОЙ значок «сломанное изображение». Человек знает, что
 * иконка у сайта есть, поэтому читается это как поломка браузера.
 *
 * ⚠️ Состояние ошибки СБРАСЫВАЕТСЯ при смене ссылки: без этого первая же неудача навсегда скрыла
 * бы значки всех следующих вкладок в переиспользованном узле списка.
 */
export function FaviconImg({ src, size = 16, radius, fallback, style }: {
  src: string | null | undefined;
  size?: number;
  radius?: number | string;
  fallback: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [src]);
  if (!src || failed) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{ display: 'block', borderRadius: radius, objectFit: 'cover', ...style }}
    />
  );
}
