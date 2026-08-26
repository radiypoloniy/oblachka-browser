import { useEffect, useState } from 'react';
import { buildChromeGround, buildChromeGroundFromMesh, accentFromMesh, overlaySymbolColor, CHROME_OVERLAY_PX } from '../../shared/chromeGround';
import type { Ground } from '../../shared/chromeGround';
import { isDarkTheme } from '../../shared/ipc';
import type { ThemePrefs } from '../../shared/ipc';
import { loadNewTabSettings, subscribeNewTabSettings, posterToneCss } from '../newtab/settings';
import { findMesh, subscribeMeshes } from '../newtab/gradients';

// Внешний вид окна: тема на корне, земля под островами, полоса системных кнопок Windows.
//
// ⚠️ ТРИ ЭФФЕКТА ЖИВУТ ВМЕСТЕ, ПОТОМУ ЧТО СВЯЗАНЫ ПОРЯДКОМ, а не потому, что похожи по теме.
// Порядок объявления = порядок выполнения, и на нём держатся две уже случавшиеся поломки:
//   1) земля читает --sidebar-tint и --app-bg ПОСЛЕ того, как тему проставили на корень — иначе
//      считается по токенам прошлой темы, и после переключения светлая ↔ тёмная фон остаётся
//      прежним, пока человек не тронет что-нибудь ещё («приходится менять тему на другую»);
//   2) полоса системных кнопок берёт верх земли ПОСЛЕ того, как земля посчитана.
// Разрезать этот хук по одному эффекту нельзя: разъедется порядок. Вызывать его в App нужно
// ровно там, где раньше стоял первый из трёх, — до онбординга и разметки, после состояния темы.

// Разрешает CSS-цвет (в том числе color-mix, который getComputedStyle отдаёт формулой) в #rrggbb.
// Нужен нативному API титлбара: полоса системных кнопок рисуется ОС и принимает только готовый
// цвет. Пробный элемент — единственный способ заставить браузер посчитать формулу; живёт он один
// кадр и за пределами экрана.
function resolveColor(css: string): string {
  try {
    const probe = document.createElement('div');
    probe.style.cssText = `position:fixed;left:-9999px;top:0;width:1px;height:1px;background:${css}`;
    document.body.appendChild(probe);
    const value = getComputedStyle(probe).backgroundColor;
    probe.remove();
    const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

    // ⚠️ У color-mix() Chromium отдаёт НЕ rgb(), а `color(srgb 0.83 0.89 0.97)` — доли, не байты.
    // Разбор, ждавший только rgb(), возвращал пустую строку, вызывающий уходил на фолбэк, и полоса
    // системных кнопок оставалась цвета --app-bg поверх цветного окна. Проверено замером.
    const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/.exec(value);
    if (srgb) return '#' + srgb.slice(1, 4).map((v) => hex(Number(v) * 255)).join('');

    // ⚠️ ПРОЗРАЧНОЕ ЗНАЧЕНИЕ — ЭТО ОШИБКА РАЗБОРА, А НЕ ЦВЕТ, и именно на этом ломалась полоса
    // системных кнопок. Chromium отдаёт `rgba(0, 0, 0, 0)`, когда переменная не разрешилась
    // (стили ещё не применены, опечатка в имени, значение не цвет), а регулярка ниже совпадала с
    // такой строкой и возвращала #000000 — то есть ЧЁРНЫЙ выдавался за честно посчитанный цвет.
    // Фолбэк при этом не срабатывал никогда: у вызывающего на руках был «валидный» хекс.
    // Замер на чистом профиле (лог в обработчике WINDOW_SET_OVERLAY): в main приезжало
    // {"color":"#000000","symbolColor":"#3C3C43"} — светлые символы Windows на чёрном фоне поверх
    // светлого окна, ровно то, что было видно глазом.
    const alpha = /^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/.exec(value);
    if (alpha && Number(alpha[1]) < 0.99) return '';

    const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
    if (rgb) return '#' + rgb.slice(1, 4).map((v) => hex(Number(v))).join('');
    return '';
  } catch {
    return '';
  }
}

/**
 * Считает землю окна и держит её в согласии с темой. Наружу отдаёт землю для разметки
 * (`chromeTintStyle`/`tintedPlateVars` в App) и признак тёмной темы — остальное делает сам:
 * читает выбор темы из main и слушает его изменения, проставляет атрибуты на корне, раздаёт тему
 * в chrome-вью и красит полосу системных кнопок.
 *
 * ⚠️ Тёмная тема — НЕ то же самое, что инкогнито. Приватная вкладка принудительно тёмная, но
 * `dark` наружу отдаётся именно как выбор темы: разметке нужны оба признака по отдельности.
 */
export function useChromeAppearance(incognito: boolean): { ground: Ground | null; dark: boolean } {
  // Оформление (см. ThemePrefs в shared/ipc.ts). Владеет значением main — оно на диске и одно на
  // все окна; здесь только копия для отрисовки. До первого ответа держим светлую — она же дефолт
  // настроек, поэтому мигания «тёмная → светлая» на старте не будет.
  const [themePrefs, setThemePrefs] = useState<ThemePrefs>({ mode: 'light', palette: 'charcoal', systemDark: false });
  const dark = isDarkTheme(themePrefs);
  const palette = themePrefs.palette;

  // Выбор темы живёт в main (settings.json): читаем при старте и слушаем изменения — их шлёт и
  // соседнее окно, где человек ткнул настройку, и сама система при смене светлой/тёмной.
  // ⚠️ Стоит ПЕРВЫМ из эффектов этого хука: остальные читают уже применённые токены темы.
  useEffect(() => {
    void window.oblako.getTheme().then(setThemePrefs).catch(() => { /* останемся на светлой */ });
    return window.oblako.onThemeChanged(setThemePrefs);
  }, []);
  // Подмешка акцента от сетки: считается вместе с землёй (ниже), а применяется темой (сразу под
  // этим). Из-за этой пары эффекты и нельзя развести по разным местам.
  const [meshWash, setMeshWash] = useState<{ accent: string; tint: string } | null>(null);

  // Тема. Инкогнито принудительно тёмный (data-theme="dark") + флаг data-incognito, который в
  // theme-dark.css перекрашивает острова в «приятно-чёрный» (см. блок [data-incognito]).
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', (dark || incognito) ? 'dark' : 'light');
    // Палитра — вторая ось (см. palettes.css). В инкогнито она тоже проставляется, но правил там
    // не даёт: приватный режим обязан выглядеть одинаково независимо от вкуса, иначе он перестаёт
    // читаться как режим.
    root.setAttribute('data-palette', palette);
    if (incognito) root.setAttribute('data-incognito', 'true');
    else root.removeAttribute('data-incognito');
    if (meshWash) {
      root.style.setProperty('--accent', meshWash.accent);
      root.style.setProperty('--sidebar-tint', meshWash.tint);
    } else {
      root.style.removeProperty('--accent');
      root.style.removeProperty('--sidebar-tint');
    }
    // Раздаём ту же тему во все отдельные chrome-вью (поповеры/дропдаун живут в своих document,
    // этот атрибут сам по себе до них не дойдёт) — см. main.ts::broadcastChromeTheme.
    void window.oblako.setChromeTheme(dark || incognito, incognito, palette, meshWash);
  }, [dark, incognito, palette, meshWash]);

  // Цветной фон окна — та же настройка, что раньше называлась «цветной сайдбар» (ключ в хранилище
  // не менялся, чтобы не терять уже сделанный выбор). Красит теперь всё окно.
  const [groundPrefs, setGroundPrefs] = useState(() => loadNewTabSettings().sidebar);
  const [meshRev, setMeshRev] = useState(0);
  useEffect(() => subscribeNewTabSettings(() => setGroundPrefs(loadNewTabSettings().sidebar)), []);
  useEffect(() => subscribeMeshes(() => setMeshRev((n) => n + 1)), []);
  const chromeTinted = groundPrefs.tinted;

  // ⚠️ Земля считается в JS, а не формулами CSS: нужны поворот тона и притемнение ПО СВЕТИМОСТИ
  // (см. shared/chromeGround.ts). Ни того, ни другого color-mix не умеет, а без них цветной фон
  // в тёмной теме становится СВЕТЛЕЕ островов и выворачивает иерархию.
  // ⚠️ Считается в ЭФФЕКТЕ, а не в useMemo, и это несущее различие. Токены темы проставляет
  // ДРУГОЙ эффект (data-theme/data-palette на корне), а useMemo выполняется во время рендера —
  // то есть ДО него. Земля успевала посчитаться по СТАРЫМ токенам, и после переключения светлая ↔
  // тёмная фон оставался прежним, пока человек не трогал что-нибудь ещё (живая жалоба: «приходится
  // менять тему на другую, чтобы всё пришло в норму»). Эффект стоит ПОСЛЕ того, который применяет
  // тему: порядок объявления = порядок выполнения, тот же приём, что у полосы системных кнопок ниже.
  const [ground, setGround] = useState<Ground | null>(null);
  useEffect(() => {
    if (!chromeTinted) { setGround(null); setMeshWash(null); return; }
    // ⚠️ Тон земли берётся ИЗ ИСТОЧНИКА, а не всегда из палитры: 'poster' означает, что человек
    // выбрал краску напрямую. Дальше путь общий — та же подмешка долей amount к --app-bg, тот же
    // потолок 30%. Плакатная краска здесь работает как ТОН ЗЕМЛИ, а не как заливка хрома.
    const tint = resolveColor(
      groundPrefs.source === 'poster' ? posterToneCss(groundPrefs.tone) : 'var(--sidebar-tint)',
    );
    const appBg = resolveColor('var(--app-bg)');
    const surface = resolveColor('var(--surface)');
    if (!tint || !appBg || !surface) { setGround(null); setMeshWash(null); return; }
    const input = { tint, appBg, surface, amount: groundPrefs.amount, dark: dark || incognito };
    if (groundPrefs.source === 'mesh') {
      const mesh = findMesh(groundPrefs.meshId);
      if (mesh) {
        const g = buildChromeGroundFromMesh(mesh, input);
        setGround(g);
        // Акцент берём В РОДСТВЕ с землёй этой же сетки — иначе на зелёном хроме он выходил розовым.
        const accent = accentFromMesh(mesh, input.dark, g.top);
        setMeshWash({ accent, tint: accent });
        return;
      }
    }
    setGround(buildChromeGround(input));
    setMeshWash(null);
    // palette — ради ПЕРЕЧИТЫВАНИЯ токенов: палитра меняет их, не меняя dark.
    // meshRev — сетку правили в каталоге, не трогая sidebar.meshId.
  }, [chromeTinted, groundPrefs.amount, groundPrefs.source, groundPrefs.meshId, groundPrefs.tone, meshRev, dark, incognito, palette]);

  // Синхронизируем фон и цвет иконок зоны системных кнопок с темой.
  // color = --app-bg темы (прозрачность не работает: Windows рисует backgroundColor окна,
  // а не web-контент, что даёт видимую плашку при несовпадении). Нативный Electron API,
  // CSS-переменную сюда не прокинуть — литералы обязаны совпадать с токенами вручную
  // (Коммит 1: light --app-bg сменился на #F2F2F7, синхронизировано; dark --app-bg не менялся).
  // symbolColor = --text-body темы: light — Apple label (#3C3C43), dark раньше был #EAE8E3 —
  // не совпадал с реальным --text-body dark, исправлено заодно; значения = --app-bg темы.
  useEffect(() => {
    // ⚠️ Фон берём из ЖИВОГО значения --app-bg, а не из литерала: с палитрами (см. palettes.css)
    // теней у этого токена стало восемь, и любой захардкоженный хекс означал бы полосу системных
    // кнопок чужого цвета в большинстве палитр. Эффект стоит ПОСЛЕ того, который проставляет
    // data-theme/data-palette (порядок объявления = порядок выполнения), поэтому читается уже
    // применённая палитра. Фолбэк — прежний литерал светлой темы, если строка вдруг не хекс.
    // ⚠️ При включённом ЦВЕТНОМ ФОНЕ берём ВЕРХНЮЮ СТУПЕНЬ подкраски, а не --app-bg: полоса
    // системных кнопок Windows не участвует в web-раскладке вовсе (её рисует ОС по цвету из
    // setTitleBarOverlay), поэтому градиент до неё не доезжает и она оставалась серым
    // прямоугольником поверх цветного окна. Ось градиента специально вертикальная — тогда цвет
    // верхней кромки в точности равен этой ступени (см. CHROME_TINT_TOP в styles/island.ts).
    // ⚠️ Значение приходится РАЗРЕШАТЬ пробным элементом: это color-mix(), а getComputedStyle
    // вернул бы формулу, а не цвет.
    // ⚠️ ЗНАЧЕНИЕ РАЗРЕШАЕМ ПРОБНЫМ ЭЛЕМЕНТОМ, а не читаем переменную. getPropertyValue отдаёт
    // ТЕКСТ объявления, а --app-bg с переходом на шкалу нейтрали стал ссылкой (`var(--n4)`) —
    // регулярка на hex перестала совпадать, и полоса системных кнопок молча уходила в фолбэк
    // светлой темы. В тёмной теме это выглядело как «кнопки Windows не совпадают с браузером»,
    // причём только при выключенном цветном фоне: с включённым цвет приходит из ground.top.
    // Пробный элемент даёт итоговый цвет при любой форме значения — hex, var() или color-mix().
    // ⚠️ И БЕРЁМ ВЕРХНЮЮ ТОЧКУ МАРШРУТА, а не --app-bg: земля рисуется пространством
    // (chromeSpaceStyle), у которого верх — --space-1, а --app-bg описывает ПЛОСКУЮ землю,
    // которой на экране больше нет. Источник цвета для полосы теперь ровно один — верх земли,
    // и при включённой подкраске его даёт ground.top, посчитанный той же функцией, что рисует
    // градиент. Исключений не осталось.
    // ⚠️ ЧИТАЕМ В СЛЕДУЮЩЕМ КАДРЕ. Значение берётся пробным элементом из ЖИВЫХ стилей, а эффект
    // может выполниться раньше, чем браузер применит только что выставленные data-theme/
    // data-palette: тогда в полосу уезжает цвет ПРЕДЫДУЩЕЙ темы и остаётся там навсегда — пока
    // не изменится одна из зависимостей. Именно так на чистом профиле получался тёмный
    // прямоугольник поверх светлого окна.
    // ⚠️ НЕ ОДИН КАДР, А НЕСКОЛЬКО ПОПЫТОК. Цвет берётся из ЖИВЫХ стилей пробным элементом, а
    // первый кадр после монтирования может прийти раньше, чем применены и токены темы, и
    // выставленные тут же data-theme/data-palette. Одна попытка означала бы «не разрешилось —
    // живи с фолбэком до следующей смены темы»; пять кадров закрывают запуск на холодную, а если
    // не разрешилось и за них, уходим на фолбэк осознанно.
    let tries = 0;
    let id = 0;
    const apply = () => {
      const raw = chromeTinted ? (ground?.top ?? '') : resolveColor('var(--ground-1)');
      const ok = /^#[0-9a-f]{6}$/i.test(raw);
      if (!ok && tries < 5) { tries += 1; id = requestAnimationFrame(apply); return; }
      // ⚠️ Фолбэк ЗАВИСИТ ОТ ТЕМЫ. Прежний литерал светлой темы означал, что при любой осечке
      // разрешения цвета в тёмной теме полоса кнопок становилась светлой — то есть ошибка
      // выглядела как «кнопки Windows не от этого окна».
      const fallback = (dark || incognito) ? '#121213' : '#F2F2F7';
      const base = ok ? raw : fallback;
      void window.oblako.setTitleBarOverlay({
        // ⚠️ Затемнения под модалкой здесь БОЛЬШЕ НЕТ, и это возврат к тому, как ведут себя
        // настоящие приложения Windows. Ни WinUI-диалог, ни Chrome, ни VS Code не перекрашивают
        // зону системных кнопок, когда открывают модальное окно: кнопки принадлежат РАМКЕ окна,
        // а не содержимому, они остаются живыми и нажимаемыми — свернуть и закрыть окно можно и
        // при открытом диалоге. Затемнять их значит говорить неправду об их состоянии. Прежняя
        // механика (счётчик слоёв + умножение цвета на непрозрачность scrim'а) заводилась ради
        // «чтобы не осталось незатемнённого места», а давала на чистом профиле почти чёрный
        // прямоугольник в углу светлого окна — см. scrimState.ts, удалён вместе с ней.
        color: base,
        symbolColor: overlaySymbolColor(base),
        height: CHROME_OVERLAY_PX,
      });
    };
    id = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(id);
    // palette в зависимостях не ради самого значения, а ради ПЕРЕЧИТЫВАНИЯ --app-bg:
    // палитра меняет его, не меняя ни dark, ни incognito. chromeTinted — по той же причине:
    // включение цветного фона меняет цвет полосы кнопок, не трогая ни тему, ни палитру.
  }, [dark, incognito, palette, chromeTinted, ground]);

  return { ground, dark };
}
