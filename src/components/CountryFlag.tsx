import { useState } from 'react';
import { knownCountryCode } from '../../shared/countries';

// Флаг страны картинкой. ⚠️ Не эмодзи: Windows не рисует regional indicator'ы как флаг
// (см. shared/countries.ts и shared/text.ts). SVG лежат в src/public/flags и приезжают
// обычной картинкой по относительному пути — он одинаково работает и в dev-сервере Vite,
// и из oblako-chrome:// в проде.
//
// Пропорция 4:3 — как у исходников flag-icons; тонкая рамка обязательна, иначе флаги с белым
// краем (Япония, Финляндия, Швейцария) растворяются в светлой теме.
interface Props {
  /** ISO 3166-1 alpha-2, нижний регистр. */
  code: string;
  /** Название страны — уходит в title, чтобы «почему такой флаг» проверялось наведением. */
  title?: string;
  /** Ширина в px; высота считается по пропорции. */
  width?: number;
}

export default function CountryFlag({ code, title, width = 20 }: Props) {
  // Файл мог не доехать (скрипт качает только страны из таблицы) — тогда честно ничего не
  // рисуем вместо иконки-заглушки с крестом.
  const [failed, setFailed] = useState(false);
  if (failed || !knownCountryCode(code)) return null;

  const height = Math.round((width * 3) / 4);
  return (
    <img
      src={`./flags/${code}.svg`}
      alt=""
      title={title}
      width={width}
      height={height}
      onError={() => setFailed(true)}
      style={{
        flex: 'none',
        width, height,
        borderRadius: 3,
        objectFit: 'cover',
        border: '1px solid var(--divider)',
        boxSizing: 'border-box',
      }}
    />
  );
}
