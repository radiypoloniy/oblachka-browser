// Скриншоты для README (docs/images/*.png) — снимаются, а не рисуются руками.
//
// ⚠️ Профиль ИЗОЛИРОВАННЫЙ (withStand): в кадр не попадёт ни одна вкладка, закладка или история
// человека. Сайты — настоящие, из интернета: это витрина, а не проверка, и эхо-страницы на
// скриншоте продукта выглядели бы заглушкой.
//
// ⚠️ Кадр — СКЛЕЙКА capturePage всех вью окна (electron/screenshotCapture.ts), тот же путь, что у
// снимка Ctrl+Shift+S: BrowserWindow.capturePage дочерних WebContentsView не видит, а снимок
// экрана ОС зависит от того, что лежит поверх окна.
//
// Запуск: npm run build && node scripts/readme-shots.mjs [имя-сцены…]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withStand, wait } from './isolated-stand.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'docs', 'images');
fs.mkdirSync(OUT, { recursive: true });
const only = process.argv.slice(2);

// Размер окна в CSS-пикселях. Масштаб экрана сверху даёт чёткость на HiDPI.
const WIDTH = 1440;
const HEIGHT = 900;
// Скругление вью страницы, как его кладёт TabManager (setBorderRadius): склейка его не видит.
const PAGE_RADIUS = 20;

const main = (ctx, body) => ctx.evalMainSync(`(() => {
  const req = process.mainModule.require, root = req('electron').app.getAppPath();
  const mod = (name) => req(req('path').join(root, 'dist-electron/electron', name));
  // Окно браузера — из реестра: среди окон есть служебные, в том числе видимое 1×1.
  const win = mod('WindowRegistry.js').mainContext().win;
  ${body}
})()`);

async function shot(ctx, name) {
  // ⚠️ Перекрытое окно Chromium не перерисовывает, и capturePage отдаёт ПОСЛЕДНИЙ кадр — до
  // перекрытия. Поэтому окно держится поверх всех (см. ниже), а перед кадром вью перерисовываются.
  await main(ctx, `win.contentView.children.forEach((v) => v.webContents?.invalidate?.()); return 1;`);
  await wait(700);
  await main(ctx, `
    globalThis.__shot = null;
    mod('screenshotCapture.js').captureBrowserWindow(win, null).then((r) => {
      globalThis.__shot = { ...r, scale: req('electron').screen.getDisplayMatching(win.getBounds()).scaleFactor,
        page: win.contentView.children.slice(1).map((v) => v.getBounds()) };
    });
    return 1;`);
  let layers = null;
  for (let i = 0; i < 60 && !layers; i++) {
    await wait(200);
    layers = await ctx.evalMainSync('globalThis.__shot');
  }
  if (!layers?.layers) throw new Error(`кадр ${name} не снялся`);
  console.log(`  слои ${name}: ${layers.width}×${layers.height}, ${layers.layers.length} шт.`);
  // Склейка на canvas в слое хрома: без новых зависимостей в node.
  const data = await ctx.chrome.evaluate(`(async () => {
    const shot = ${JSON.stringify(layers)};
    const c = document.createElement('canvas');
    c.width = shot.width; c.height = shot.height;
    const g = c.getContext('2d');
    for (const [i, l] of shot.layers.entries()) {
      const img = new Image();
      img.src = l.url;
      await img.decode();
      g.save();
      if (i > 0) { g.beginPath(); g.roundRect(l.x, l.y, l.w, l.h, ${PAGE_RADIUS} * shot.scale); g.clip(); }
      g.drawImage(img, l.x, l.y, l.w, l.h);
      g.restore();
    }
    return c.toDataURL('image/png').split(',')[1];
  })()`, 60000);
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
  console.log(`  снят  docs/images/${name}.png`);
}

const tab = (ctx, url) => ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(url)})`);
const api = (ctx, call) => ctx.chrome.evaluate(`window.oblako.${call}`);

// Вкладки витрины. Открываются один раз и переиспользуются сценами обоих языков.
const PAGES = {
  cloud: 'https://en.wikipedia.org/wiki/Cloud',
  github: 'https://github.com/electron/electron',
  hn: 'https://news.ycombinator.com',
  cumulus: 'https://en.wikipedia.org/wiki/Cumulus_cloud',
};
const ids = {};

async function setAiPanel(ctx, open) {
  const now = await ctx.evalMainSync(`(() => { const req = process.mainModule.require, root = req('electron').app.getAppPath();
    const win = req(req('path').join(root, 'dist-electron/electron', 'WindowRegistry.js')).mainContext().win;
    return win.contentView.children.some((v) => v.getVisible?.() && /aipanel/.test(v.webContents?.getURL?.() ?? '')); })()`);
  if (now !== open) await api(ctx, 'toggleAiPanel()');
  await wait(1500);
}

const SCENES = {
  async browse(ctx, sfx) {
    await api(ctx, `activateTab(${JSON.stringify(ids.cumulus)})`);
    await setAiPanel(ctx, true);
    await wait(2500);
    await shot(ctx, `browse${sfx}`);
    await setAiPanel(ctx, false);
  },
  async split(ctx, sfx) {
    await api(ctx, `activateTab(${JSON.stringify(ids.github)})`);
    await wait(800);
    await api(ctx, `enterSplit(${JSON.stringify(ids.hn)}, 'right')`);
    await wait(3000);
    await shot(ctx, `split${sfx}`);
    await api(ctx, `exitSplit(${JSON.stringify(ids.github)})`);
    await wait(1000);
  },
  async shield(ctx, sfx) {
    await api(ctx, `activateTab(${JSON.stringify(ids.cumulus)})`);
    await wait(1200);
    // Щит — первая кнопка в адресной строке. Ищем по точке, а не по классу: у пилюли нет имени.
    const field = await ctx.chrome.evaluate(`(() => { const i = document.querySelector('input'); const r = i.getBoundingClientRect(); return [r.left, r.top + r.height / 2]; })()`);
    await ctx.chrome.evaluate(`document.elementFromPoint(${field[0]} - 14, ${field[1]})?.closest('button')?.click()`);
    await wait(2000);
    await shot(ctx, `shield${sfx}`);
    await ctx.chrome.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
    await api(ctx, `activateTab(${JSON.stringify(ids.cumulus)})`);
    await wait(1000);
  },
  async settings(ctx, sfx) {
    await api(ctx, `createSpecialTab('settings', 'general')`);
    await wait(2500);
    await shot(ctx, `settings${sfx}`);
  },
  async 'desktop-dark'(ctx, sfx) {
    const prefs = await api(ctx, 'getTheme()');
    await api(ctx, `setTheme('dark', 'charcoal')`);
    await api(ctx, `activateTab('hub')`);
    await wait(5000); // виджеты погоды и курсов ходят в сеть
    await shot(ctx, `desktop-dark${sfx}`);
    await api(ctx, `setTheme(${JSON.stringify(prefs.mode)}, ${JSON.stringify(prefs.palette)})`);
    await wait(1000);
  },
};

async function prepare(ctx) {
  // Поверх всех окон на время съёмки — иначе кадры устаревшие (см. shot). Окно стенда временное.
  await main(ctx, `win.setContentSize(${WIDTH}, ${HEIGHT}); win.center(); win.setAlwaysOnTop(true, 'screen-saver'); win.show(); win.focus(); return 1;`);
  await wait(1500);
  for (const [key, url] of Object.entries(PAGES)) {
    ids[key] = await tab(ctx, url);
    await wait(1500);
  }
  await wait(3000);
}

// ⚠️ Каждый язык — со СВОЕГО перезапуска, а не переключением на ходу: поповеры и панели
// поднимаются один раз и держат язык, с которым загрузились. Переключение посреди съёмки давало
// кадры, где половина интерфейса ещё на прежнем языке, — витрине такое не годится.
// Английский — основной README, русский — README.ru.md (суффикс -ru).
for (const [lang, sfx, city] of [['en', '', 'London'], ['ru', '-ru', 'Москва']]) {
  await withStand(async (ctx) => {
    await api(ctx, `setUiLanguage('${lang}')`);
    // Город для виджета погоды: настройки стола живут в localStorage хрома (src/newtab/settings.ts),
    // и читаются при монтировании — поэтому пишем ДО перезапуска.
    // ⚠️ И сбрасываем на диск сами: стенд снимает процесс через taskkill /F, и без flushStorageData
    // запись до диска не доживает. Перезагрузка хрома вместо этого роняла CDP-контекст стенда.
    await ctx.chrome.evaluate(`(() => { const k = 'oblako-newtab-settings'; let s = {};
      try { s = JSON.parse(localStorage.getItem(k) || '{}'); } catch {}
      s.weather = { ...(s.weather || { show: false, units: 'c' }), city: ${JSON.stringify(city)} };
      localStorage.setItem(k, JSON.stringify(s)); return 1; })()`);
    await ctx.evalMainSync(`(process.mainModule.require('electron').session.defaultSession.flushStorageData(), 1)`);
    await wait(1000);
    await ctx.restart(1500);
    await prepare(ctx);
    for (const [name, scene] of Object.entries(SCENES)) {
      if (only.length && !only.includes(name)) continue;
      await scene(ctx, sfx);
    }
  }, { main: true });
}
