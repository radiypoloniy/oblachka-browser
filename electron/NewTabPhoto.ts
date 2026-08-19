import { app, net, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

// «Фото дня» для фона новой вкладки. Качаем ТОЛЬКО через main (net.fetch = Chromium-сеть, уважает
// VPN/прокси/kill-switch — приватный режим не течёт мимо туннеля), кэшируем на календарный день в
// userData и держим в памяти. Источник — Lorem Picsum с дневным сидом (без API-ключа, реальные
// фото, стабильны в пределах суток). Опция включается пользователем в разделе «Интерфейс».
const DIR = path.join(app.getPath('userData'), 'newtab-photo');
/**
 * Размер снимка под ФАКТИЧЕСКИЙ экран, а не константой.
 *
 * ⚠️ Здесь стояло 1920×1080. На мониторе 2560 такой снимок растягивается на 133 %, и картинка
 * мылится ещё до всякого размытия — это первая из трёх причин, по которым обои выглядели дёшево.
 * Округляем вверх до сотни: у picsum каждый размер — отдельный кадр, и точное совпадение с
 * пикселями экрана только мешало бы кэшу.
 */
function photoSize(): { width: number; height: number } {
  const { size, scaleFactor } = screen.getPrimaryDisplay();
  const round = (v: number) => Math.min(3840, Math.ceil((v * scaleFactor) / 100) * 100);
  return { width: round(size.width), height: round(size.height) };
}

let memCache: { date: string; dataUrl: string } | null = null;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD (локальная дата достаточно точна для «фото дня»)
}

export async function getPhotoOfDay(): Promise<{ ok: boolean; dataUrl?: string }> {
  const date = todayKey();
  if (memCache?.date === date) return { ok: true, dataUrl: memCache.dataUrl };

  const file = path.join(DIR, `${date}.jpg`);
  // 1) кэш на диске (сегодняшний)
  try {
    const buf = fs.readFileSync(file);
    const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
    memCache = { date, dataUrl };
    return { ok: true, dataUrl };
  } catch { /* нет кэша — качаем */ }

  // 2) сеть
  try {
    const res = await net.fetch(`https://picsum.photos/seed/${date}/${photoSize().width}/${photoSize().height}`, { redirect: 'follow' });
    if (!res.ok) return { ok: false };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024) return { ok: false }; // подозрительно мало для фото — не кэшируем мусор
    try {
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(file, buf);
      // чистим прошлые дни — на диске держим только сегодняшнее фото
      for (const f of fs.readdirSync(DIR)) {
        if (f !== `${date}.jpg`) { try { fs.unlinkSync(path.join(DIR, f)); } catch { /* уже нет */ } }
      }
    } catch { /* нет доступа к диску — отдадим из памяти, просто без диск-кэша */ }
    const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
    memCache = { date, dataUrl };
    return { ok: true, dataUrl };
  } catch {
    return { ok: false }; // офлайн/сеть недоступна — вкладка сама откатится на пресет
  }
}
