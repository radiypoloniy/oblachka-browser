import { useState } from 'react';
import { CRYPTO_CHOICES } from '../newtab/settings';

// Значок монеты картинкой. ⚠️ Не символом из шрифта: у половины монет своего знака в Unicode
// нет вовсе, а те, что есть («Ξ», «Ð», «₮»), Golos Text рисует неузнаваемыми буквами — рядом
// с голыми тикерами получался разнобой, по которому монету не опознать. SVG лежат в
// src/public/crypto (см. scripts/download-crypto-icons.mjs) и приезжают обычной картинкой по
// относительному пути — он одинаково работает и в dev-сервере Vite, и из oblako-chrome://
// в проде (та же связка, что у флагов стран в CountryFlag.tsx).
//
// Все значки набора — цветной кружок с белым знаком, то есть та же круглая плитка, что и
// остальные значки интерфейса; собственная подложка им не нужна.
interface Props {
  /** Тикер монеты, как в CRYPTO_CHOICES: 'BTC', 'ETH', … */
  code: string;
  size?: number;
}

export default function CryptoIcon({ code, size = 18 }: Props) {
  // Файл мог не доехать (скрипт качает только монеты из таблицы) — тогда честно показываем
  // тикер текстом вместо картинки-заглушки с крестом.
  const [failed, setFailed] = useState(false);
  const known = CRYPTO_CHOICES.find((c) => c.code === code);

  if (failed || !known) {
    return (
      <span style={{ fontSize: Math.round(size * 0.62), fontWeight: 600, letterSpacing: '-0.02em' }}>
        {code}
      </span>
    );
  }

  return (
    <img
      src={`./crypto/${code.toLowerCase()}.svg`}
      alt={known.label}
      title={known.label}
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{ flex: 'none', width: size, height: size, display: 'block' }}
    />
  );
}
