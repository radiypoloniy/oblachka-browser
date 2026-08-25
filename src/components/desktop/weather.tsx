// Погода, общая для стола и для AI-панели: значок, словесное состояние и КОЖА (краска плитки
// с парной краской текста).
//
// ⚠️ Вынесено из widgets.tsx ради панели: там погода рисовалась ЭМОДЗИ (☀️ 🌤️ ⛅), то есть
// шрифтом системы — на разных машинах разным, не следующим ни краске плитки, ни теме. Тянуть
// ради одной картинки весь widgets.tsx (а с ним часы, крипту и локальные виджеты) в бандл
// панели нельзя — отсюда отдельный файл. Тот же приём, что с Toggle.tsx для поповеров.

// WMO-код → имя файла Meteocons (см. scripts/download-icons.mjs).
//
// ⚠️ Эмодзи здесь не годятся: они рисуются шрифтом системы, выглядят по-разному на разных
// машинах и рядом с крупной температурой смотрятся наклейкой. Meteocons — цветные объёмные
// SVG в том же стиле, что системный виджет Apple.
export function wmoIconName(code: number, day = true): string {
  if (code === 0) return day ? 'clear-day' : 'clear-night';
  if (code <= 2) return day ? 'partly-cloudy-day' : 'partly-cloudy-night';
  if (code === 3) return day ? 'overcast-day' : 'overcast-night';
  if (code <= 48) return day ? 'fog-day' : 'fog-night';
  if (code <= 57) return 'drizzle';
  if (code <= 67) return 'rain';
  if (code <= 77) return 'snow';
  if (code <= 82) return 'rain';
  if (code <= 86) return 'sleet';
  if (code <= 99) return day ? 'thunderstorms-day-rain' : 'thunderstorms-night-rain';
  return 'not-available';
}

// ⚠️ Путь ОТНОСИТЕЛЬНЫЙ: файл рисуется из двух разных документов (новая вкладка и aipanel.html),
// и оба лежат в корне сборки рядом с папкой weather. Тот же приём, что у масок appicons.
export function WeatherIcon({ code, day, size }: { code: number; day: boolean; size: number }) {
  return (
    <img
      src={`./weather/${wmoIconName(code, day)}.svg`}
      alt=""
      width={size}
      height={size}
      style={{ width: size, height: size, flex: 'none', display: 'block' }}
    />
  );
}

export function wmoText(code: number): string {
  if (code === 0) return 'Ясно';
  if (code <= 2) return 'Малооблачно';
  if (code === 3) return 'Пасмурно';
  if (code <= 48) return 'Туман';
  if (code <= 57) return 'Морось';
  if (code <= 67) return 'Дождь';
  if (code <= 77) return 'Снег';
  if (code <= 82) return 'Ливень';
  if (code <= 86) return 'Снегопад';
  return 'Гроза';
}

// Цвет плитки — от времени суток и состояния неба. Это и есть «настроение» виджета Apple:
// ясный день голубой, пасмурный серо-синий, ночь тёмная.
/**
 * Кожа погоды: плоская краска и краска текста к ней.
 *
 * ⚠️ Погода — единственная плитка со СВОИМ цветом (он означает время суток и осадки). Тона взяты
 * из общего плакатного набора: ясно — небо, ночь — чай, дождь и снег — холодные промежуточные,
 * пасмурно — бумага-тень.
 *
 * ⚠️ Краска идёт ПАРОЙ с цветом, иначе половина состояний нечитаема: на небе и бумаге-тени нужен
 * тёмный текст, на чае и дожде — светлый. Прежний код ставил белый на все пять.
 */
export type WeatherSkin = { bg: string; ink: string };
const SKIN_DARK = 'var(--on-poster-dark)';
const SKIN_LIGHT = 'var(--on-poster-light)';

export function weatherSkin(code: number, isDay: boolean): WeatherSkin {
  if (!isDay) return { bg: 'var(--poster-tea)', ink: SKIN_LIGHT };
  // Снег: почти белая плоскость — единственное состояние, которое читается светлым по смыслу.
  if (code >= 71) return { bg: '#CFDCE4', ink: SKIN_DARK };
  // ⚠️ Дождь темнее, чем просится на глаз (#7E93A8), и это про контраст, а не про вкус: на том
  // тоне светлая краска давала 2.71, то есть подписи «ощущается» и «воздух» читались с трудом.
  // #55697D — первый шаг вниз, на котором пара проходит 4.5:1.
  if (code >= 51) return { bg: '#55697D', ink: SKIN_LIGHT };
  if (code >= 3)  return { bg: 'var(--surface-sunken)', ink: 'var(--text-body)' };
  return { bg: 'var(--poster-sky)', ink: SKIN_DARK };
}
