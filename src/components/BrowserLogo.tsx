import { useState } from 'react';

// Логотип браузера-источника на экране переноса данных. Файлы — в src/public/browsers
// (см. scripts/download-browser-logos.mjs), путь относительный: он одинаково работает и в
// dev-сервере Vite, и из oblako-chrome:// в проде.
//
// ⚠️ Фолбэк не декоративный, а обязательный: у Яндекс.Браузера в наборе логотипа нет, а
// приблизительно перерисовывать чужой знак — хуже, чем честная буквенная плашка. Тот же путь
// работает и для источников, которые появятся позже (Safari).

// vendorId (см. ChromiumDiscovery.ts / FirefoxDiscovery.ts) → фирменный цвет буквенной плашки.
// ⚠️ Запись здесь ОТКЛЮЧАЕТ настоящий логотип, а не дополняет его (см. условие ниже). Firefox
// раньше стоял в этом списке как заглушка на время, пока его SVG не было в наборе; теперь он
// качается вместе с остальными, и запись убрана — иначе логотип лежал бы неиспользованным.
const BRAND_COLOR: Record<string, string> = {
  yandex: '#FC3F1D',
  safari: '#1B88F5',
};

interface Props {
  /** Часть sourceId до '::' — вендор браузера. */
  vendorId: string;
  /** Название источника: из него берётся буква для плашки. */
  label: string;
  size?: number;
}

export default function BrowserLogo({ vendorId, label, size = 40 }: Props) {
  const [failed, setFailed] = useState(false);

  if (failed || BRAND_COLOR[vendorId]) {
    // Буква на фирменном фоне. Для Яндекса это «Я» — то, чем его и узнают.
    const letter = vendorId === 'yandex' ? 'Я' : (label.trim().charAt(0) || '?').toUpperCase();
    return (
      <span style={{
        width: size, height: size, flex: 'none', borderRadius: 'var(--radius-pill)',
        background: BRAND_COLOR[vendorId] ?? 'var(--neutral-300)',
        color: 'var(--white, #fff)',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: Math.round(size * 0.48), fontWeight: 700, lineHeight: 1,
      }}>{letter}</span>
    );
  }

  return (
    <img
      src={`./browsers/${vendorId}.svg`}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{ width: size, height: size, flex: 'none', objectFit: 'contain' }}
    />
  );
}
