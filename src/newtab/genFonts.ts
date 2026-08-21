import unboundedCyr from '../assets/fonts/unbounded-cyrillic.woff2?url';
import unboundedLat from '../assets/fonts/unbounded-latin.woff2?url';

// У iframe уникальный origin: Unbounded из хрома туда не виден, и плитка падает в Segoe.
// Классические data: + font-src data:. Кэш на сессию — файлы маленькие, но тащить в каждый srcdoc
// с диска каждый раз незачем.

let cached = '';

export async function genFontCss(): Promise<string> {
  if (cached) return cached;
  const faces = await Promise.all([
    face('Unbounded', unboundedCyr, '600 800'),
    face('Unbounded', unboundedLat, '600 800'),
  ]);
  cached = faces.join('');
  return cached;
}

async function face(family: string, url: string, weight: string): Promise<string> {
  const buf = await (await fetch(url)).arrayBuffer();
  const b64 = bufToB64(buf);
  return `@font-face{font-family:${family};font-style:normal;font-weight:${weight};font-display:block;`
    + `src:url(data:font/woff2;base64,${b64}) format("woff2")}`;
}

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
