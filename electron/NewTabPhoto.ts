import { app, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fetchInProfile } from './ProfileSession';

// «Фото дня» для фона новой вкладки. Качаем ТОЛЬКО через main (fetchInProfile = Chromium-сеть, уважает
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

let memCache: { key: string; dataUrl: string } | null = null;

/**
 * Ключ снимка: дата И РАЗМЕР ЭКРАНА.
 *
 * ⚠️ Размер в ключе обязателен. Кэш лежал под именем `2026-08-19.jpg`, то есть только по дате —
 * и снимок, скачанный когда-то в 1920×1080, продолжал раздаваться на мониторе 2560 даже после
 * того, как загрузка научилась запрашивать правильный размер. Правка «качать под экран» не
 * давала никакого эффекта ровно поэтому: до сети дело не доходило.
 *
 * ⚠️ Ключ меняется и при переезде окна на другой монитор — это и есть «адаптивно наверняка»:
 * пересчёт происходит не по флагу, а потому что имя файла другое.
 */
function photoKey(): string {
  const { width, height } = photoSize();
  return `${todayKey()}-${width}x${height}`;
}

/**
 * Сдвиг «другое фото»: сколько дней назад брать снимок.
 *
 * ⚠️ Не случайный выбор, а шаг назад по календарю. У Wikimedia на каждый день ровно одна картинка
 * дня, отобранная людьми, — то есть «другое фото» это «вчерашнее», и оно тоже хорошее. Случайный
 * сид дал бы то, ради чего мы уходим от picsum: непредсказуемое качество.
 */
let dayOffset = 0;
export function shufflePhoto(): void { dayOffset += 1; }

function dayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - dayOffset);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}
function todayKey(): string { return dayKey(); }

/**
 * Ссылка на картинку дня Wikimedia нужной ширины.
 *
 * ⚠️ ПОЧЕМУ НЕ PICSUM. Прежний источник отдавал полноэкранный кадр весом 39–77 КБ — примерно
 * 0,012 бита на пиксель, то есть уровень превью. Ни размер под монитор, ни кэш этого исправить не
 * могли: мы грузили мыло в оригинале. У Wikimedia на том же дне оригинал 3271×3271 весит 6,4 МБ,
 * и это настоящая фотография, отобранная редакцией Commons.
 *
 * ⚠️ Качаем НЕ ОРИГИНАЛ, а миниатюру по ширине экрана: у Commons для этого есть /thumb/ — сервер
 * пересчитает сам, и вместо шести мегабайт приезжает разумный файл нужного размера.
 */
async function wikimediaPhotoUrls(date: string): Promise<string[] | null> {
  const [y, m, d] = date.split('-');
  const feed = `https://api.wikimedia.org/feed/v1/wikipedia/en/featured/${y}/${m}/${d}`;
  try {
    // ⚠️ User-Agent обязателен: Wikimedia отвечает отказом на запросы без него, и это их
    // задокументированное требование, а не каприз.
    const res = await fetchInProfile(feed, { headers: { 'User-Agent': 'OblakoBrowser/0.5 (https://oblako.app)' } });
    if (!res.ok) return null;
    const json = await res.json() as { image?: { thumbnail?: { source?: string } } };
    const thumb = json.image?.thumbnail?.source;
    if (!thumb) return null;

    // ⚠️ Берём ГОТОВЫЙ ШАБЛОН МИНИАТЮРЫ из ответа и подменяем в нём ширину, а не собираем путь
    // сами. Собранный вручную путь ломается на первом же файле с непростым именем: у Commons в
    // именах живут скобки и точки, закодированные процентами, плюс к ссылке приклеены
    // utm-параметры. Замер: самодельная ссылка отвечала 400 и 404 на всех ширинах.
    const clean = thumb.split('?')[0] ?? thumb;
    // ⚠️ ШИРИНЫ ПЕРЕБИРАЕМ СВЕРХУ ВНИЗ. Commons отказывает на слишком больших миниатюрах: замер
    // на живом снимке — 1920 px отдаёт 617 КБ и код 200, а 2560 px возвращает 400. Предсказать
    // потолок нельзя (он зависит от файла), поэтому берём первый размер, который сервер согласился
    // отдать: сначала под экран, потом привычные ступени вниз.
    const widths = [photoSize().width, 1920, 1600, 1280].filter((w, i, a) => a.indexOf(w) === i);
    return widths.map((w) => clean.replace(/\/\d+px-/, `/${w}px-`));
  } catch {
    return null;
  }
}

export async function getPhotoOfDay(): Promise<{ ok: boolean; dataUrl?: string }> {
  const date = todayKey();
  const key = photoKey();
  if (memCache?.key === key) return { ok: true, dataUrl: memCache.dataUrl };

  const file = path.join(DIR, `${key}.jpg`);
  // 1) кэш на диске (сегодняшний)
  try {
    const buf = fs.readFileSync(file);
    const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
    memCache = { key, dataUrl };
    return { ok: true, dataUrl };
  } catch { /* нет кэша — качаем */ }

  // 2) сеть
  try {
    const urls = await wikimediaPhotoUrls(date);
    if (!urls) return { ok: false };
    let buf: Buffer | null = null;
    for (const url of urls) {
      const res = await fetchInProfile(url, { headers: { 'User-Agent': 'OblakoBrowser/0.5 (https://oblako.app)' }, redirect: 'follow' });
      if (!res.ok) continue;
      const candidate = Buffer.from(await res.arrayBuffer());
      // Ответ-заглушка весит пару килобайт: для полноэкранного снимка это заведомо не фотография.
      if (candidate.length < 20_000) continue;
      buf = candidate;
      break;
    }
    if (!buf) return { ok: false };
    try {
      fs.mkdirSync(DIR, { recursive: true });
      // ⚠️ Чистим чужие снимки: ключ теперь включает размер, и без уборки папка копила бы по файлу
      // на каждое разрешение, которое человек когда-либо видел (док-станция, проектор, ноутбук).
      for (const name of fs.readdirSync(DIR)) {
        if (name !== `${key}.jpg`) { try { fs.unlinkSync(path.join(DIR, name)); } catch { /* занят — переживём */ } }
      }
      fs.writeFileSync(file, buf);
      // чистим прошлые дни — на диске держим только сегодняшнее фото
      for (const f of fs.readdirSync(DIR)) {
        if (f !== `${date}.jpg`) { try { fs.unlinkSync(path.join(DIR, f)); } catch { /* уже нет */ } }
      }
    } catch { /* нет доступа к диску — отдадим из памяти, просто без диск-кэша */ }
    const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
    memCache = { key, dataUrl };
    return { ok: true, dataUrl };
  } catch {
    return { ok: false }; // офлайн/сеть недоступна — вкладка сама откатится на пресет
  }
}
