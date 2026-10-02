// Только синтетические данные во временном профиле: боевую историю стенд не открывает.
// Запуск после сборки: node scripts/history-performance-bench.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { withStand, wait } from './isolated-stand.mjs';

const sizes = [10_000, 100_000, 500_000];
const samples = 20;
const modulePath = (name) => path.resolve(`dist-electron/electron/${name}.js`);
const report = {
  measuredAt: new Date().toISOString(),
  machine: { platform: process.platform, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, ramGiB: +(os.totalmem() / 2 ** 30).toFixed(1) },
  samples,
  methodology: 'Fresh temporary profile per size; fixed synthetic URL/title visits, one loopback domain, no content chunks. First SQL read reported separately; subsequent reads are warm. Temporary window kept on top during UI measurement; visibility checked. UI timing ends after matching DOM and two animation frames, not a screenshot/presentation timestamp. Not a cold OS disk-cache benchmark.',
  results: [],
};
const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { medianMs: +sorted[Math.floor(sorted.length / 2)].toFixed(2), p95Ms: +sorted[Math.ceil(sorted.length * .95) - 1].toFixed(2), maxMs: +sorted.at(-1).toFixed(2), rawMs: values.map((v) => +v.toFixed(2)) };
};

for (const size of sizes) {
  console.log(`History benchmark: ${size} visits`);
  await withStand(async (ctx) => {
    // Пути берём из приложения и проверяем ДО открытия второй SQLite-связи.
    const seeded = await ctx.evalMain(`(async () => {
      const req = process.mainModule.require.bind(process.mainModule);
      const { app } = req('electron');
      const paths = req(${JSON.stringify(modulePath('ProfilePaths'))});
      const store = req(${JSON.stringify(modulePath('ProfileStore'))});
      const data = req(${JSON.stringify(modulePath('ProfileData'))});
      await data.initProfileData(store.getActiveProfile().id);
      const dbPath = paths.profileDataPath(store.getActiveProfile().id, 'history.sqlite');
      const p = req('path');
      const relative = p.relative(${JSON.stringify(ctx.profile)}, dbPath);
      if (!relative || relative.startsWith('..') || p.isAbsolute(relative) || p.resolve(app.getPath('userData')) !== p.resolve(${JSON.stringify(ctx.profile)})) throw Error('Unsafe benchmark profile');
      const Database = req(${JSON.stringify(path.resolve('node_modules/better-sqlite3'))});
      const db = new Database(dbPath);
      if (db.prepare('SELECT COUNT(*) AS n FROM history').get().n !== 0) throw Error('Expected empty history');
      const insert = db.prepare('INSERT INTO history(url,title,last_visit,visit_count) VALUES (?,?,?,?)');
      const start = performance.now();
      db.transaction(() => {
        for (let i = 0; i < ${size}; i++) insert.run(${JSON.stringify(ctx.echoUrl('/history-bench/'))} + i,
          'benchmark-common Страница ' + i + (i % 5000 === 0 ? ' benchmark-rare' : ''),
          Date.UTC(2025, 0, 1) - i * 3600000, 1 + i % 10);
      })();
      const seedMs = performance.now() - start;
      const plans = {
        recent: db.prepare('EXPLAIN QUERY PLAN SELECT id,url,title,last_visit,visit_count FROM history ORDER BY last_visit DESC LIMIT 500').all(),
        search: db.prepare('EXPLAIN QUERY PLAN SELECT id,url,title,last_visit,visit_count FROM history WHERE url LIKE ? OR title LIKE ? ORDER BY last_visit DESC LIMIT 500').all('%benchmark-rare%', '%benchmark-rare%'),
      };
      db.close();
      globalThis.__historyBench = data.activeHistory();
      return { seedMs, plans, versions: process.versions };
    })()`);
    report.versions ??= seeded.versions;
    const sql = await ctx.evalMain(`(async () => {
      const h = globalThis.__historyBench;
      const cases = { recent: () => h.getRecent(), common: () => h.search('benchmark-common'), rare: () => h.search('benchmark-rare'), missing: () => h.search('benchmark-absent') };
      const result = {};
      for (const [name, read] of Object.entries(cases)) {
        const times = [], timerDelays = []; let rows = 0, firstMs;
        for (let i = 0; i <= ${samples}; i++) {
          // Таймер поставлен ПЕРЕД синхронным чтением: его задержка видна остальным задачам main.
          const timerStart = performance.now();
          const pending = new Promise(resolve => setTimeout(() => resolve(performance.now() - timerStart), 0));
          const started = performance.now(); const entries = read(); const elapsed = performance.now() - started;
          rows = entries.length;
          const delay = await pending;
          if (i === 0) firstMs = elapsed; else { times.push(elapsed); timerDelays.push(delay); }
          await new Promise(resolve => setImmediate(resolve));
        }
        result[name] = { rows, firstMs, times, timerDelays };
      }
      return result;
    })()`);
    assert.equal(sql.recent.rows, 500);
    assert.equal(sql.common.rows, 500);
    assert.equal(sql.rare.rows, Math.ceil(size / 5000));
    assert.equal(sql.missing.rows, 0);
    const metrics = Object.fromEntries(Object.entries(sql).map(([name, value]) => [name, { rows: value.rows, firstMs: +value.firstMs.toFixed(2), warm: stats(value.times), mainTimerDelay: stats(value.timerDelays) }]));
    await ctx.evalMain(`(() => {
      const { BrowserWindow } = process.mainModule.require('electron');
      const win = BrowserWindow.getAllWindows().find(w => w.contentView.children.some(v => v.webContents.getURL().includes('index.html')));
      if (!win) throw Error('Benchmark window not found');
      if (win.isMinimized()) win.restore(); win.show(); win.setAlwaysOnTop(true); win.moveTop(); win.focus();
    })()`);
    await ctx.chrome.send('Page.bringToFront');
    const ui = await ctx.chrome.evaluate(`(async () => {
      const prefix = ${JSON.stringify(ctx.echoUrl('/history-bench/'))};
      const rows = () => [...document.querySelectorAll('[title]')].filter(e => e.getAttribute('title').startsWith(prefix));
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
      const until = async (test) => { const started = performance.now(); while (!test()) { if (performance.now() - started > 15000) throw Error('History DOM timeout'); await new Promise(r => setTimeout(r, 10)); } await frame(); await frame(); };
      const initialVisibility = document.visibilityState;
      if (initialVisibility !== 'visible') throw Error('UI benchmark requires visible window');
      const started = performance.now();
      const id = await window.oblako.createSpecialTab('history');
      const createMs = performance.now() - started;
      await until(() => rows().length === 500);
      const openMs = performance.now() - started;
      const reopenTimes = [];
      for (let i = 0; i < 5; i++) {
        await window.oblako.closeTab(i === 0 ? id : globalThis.__benchTabId);
        await until(() => rows().length === 0);
        const t = performance.now();
        globalThis.__benchTabId = await window.oblako.createSpecialTab('history');
        await until(() => rows().length === 500);
        reopenTimes.push(performance.now() - t);
      }
      const input = [...document.querySelectorAll('input')].find(e => /истории|history/i.test(e.placeholder));
      if (!input) throw Error('History input not found');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const setQuery = value => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); };
      const queryStart = performance.now(); setQuery('benchmark-rare');
      await until(() => rows().length === ${Math.ceil(size / 5000)});
      const rareSearchMs = performance.now() - queryStart;
      setQuery(''); await until(() => rows().length === 500);
      let scroller = rows()[0];
      while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
      if (!scroller) throw Error('History scroll container not found');
      const scrollGaps = []; let prev = await frame();
      for (let i = 0; i < 40; i++) { scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * i / 39; const now = await frame(); scrollGaps.push(now - prev); prev = now; }
      const bursts = ['benchmark-a', 'benchmark-ab', 'benchmark-abs', 'benchmark-abse', 'benchmark-absent', 'benchmark-rare'];
      const burstStart = performance.now();
      for (const query of bursts) { setQuery(query); await new Promise(r => setTimeout(r, 30)); }
      await until(() => rows().length === ${Math.ceil(size / 5000)});
      const burstMs = performance.now() - burstStart;
      // Проверяем, что поздний ответ не вернул устаревшие строки.
      await new Promise(r => setTimeout(r, 300));
      if (rows().length !== ${Math.ceil(size / 5000)} || input.value !== bursts.at(-1)) throw Error('Stale search result');
      if (document.visibilityState !== 'visible') throw Error('Window hidden during UI benchmark');
      return { initialVisibility, createMs, openMs, reopenTimes, rareSearchMs, burstMs, scrollGaps, finalQuery: input.value, finalRows: rows().length };
    })()`, 30000);
    const ipc = await ctx.chrome.evaluate(`(async () => {
      const times = []; for (let i = 0; i < ${samples}; i++) { const t = performance.now(); const rows = await window.oblako.searchHistory('benchmark-absent'); if (rows.length !== 0) throw Error('Unexpected IPC result'); times.push(performance.now() - t); } return times;
    })()`);
    report.results.push({ size, seedMs: +seeded.seedMs.toFixed(2), plans: seeded.plans, sql: metrics,
      ui: { initialVisibility: ui.initialVisibility, createMs: +ui.createMs.toFixed(2), openMs: +ui.openMs.toFixed(2), reopen: stats(ui.reopenTimes), rareSearchMs: +ui.rareSearchMs.toFixed(2), burstMs: +ui.burstMs.toFixed(2), scrollFrameGaps: stats(ui.scrollGaps), finalQuery: ui.finalQuery, finalRows: ui.finalRows }, missingSearchIpc: stats(ipc) });
    console.log(JSON.stringify({ size, recentMs: metrics.recent.warm.medianMs, missingMs: metrics.missing.warm.medianMs, mainTimerP95Ms: metrics.missing.mainTimerDelay.p95Ms, openMs: ui.openMs, burstMs: ui.burstMs }));
    await wait(100);
  }, { main: true });
}
const output = path.resolve('scripts/reports/history-performance-baseline.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
const lines = [
  '# История: исходные замеры', '',
  `Дата: ${report.measuredAt}. Electron ${report.versions.electron}, Chromium ${report.versions.chrome}.`, '',
  `Машина: ${report.machine.cpu}, ${report.machine.ramGiB} GiB RAM.`, '',
  'Повтор: `npm run build`, затем `node scripts/history-performance-bench.mjs`. Каждый объём проверяется в новом временном профиле. Реальный профиль не открывается. Скрипт перезаписывает этот отчёт и JSON с отдельными отсчётами.', '',
  '| Посещений | Последние 500, SQL медиана | Нет совпадений, SQL медиана / p95 | Main-таймер p95 при этом поиске | Повторное открытие, медиана | Серия ввода, до финального результата |',
  '|---:|---:|---:|---:|---:|---:|',
  ...report.results.map(r => `| ${r.size} | ${r.sql.recent.warm.medianMs} мс | ${r.sql.missing.warm.medianMs} / ${r.sql.missing.warm.p95Ms} мс | ${r.sql.missing.mainTimerDelay.p95Ms} мс | ${r.ui.reopen.medianMs} мс | ${r.ui.burstMs} мс |`), '',
  '## Что проверяется', '',
  '- 20 прогретых SQL-замеров на случай; первый вызов записан отдельно. Таймер main ставится перед синхронным запросом, его задержка включает сам запрос и накладные расходы планировщика.',
  '- Проверяется количество результатов: обычное чтение и частый запрос — 500, редкий — одна запись на 5000 посещений, отсутствующий — 0.',
  '- Первое открытие и пять повторных открытий: до появления 500 строк и двух requestAnimationFrame. Это оценка готовности DOM, а не измерение момента вывода пикселей на монитор.',
  '- Прокрутка через 40 кадров; серия из шести изменений поля с интервалом 30 мс (пять запросов без совпадений, последний с редкими совпадениями). Проверяется итоговый набор и отсутствие возврата устаревших результатов через 300 мс.',
  '- Ещё 20 отсутствующих поисков через настоящий renderer → IPC → main.', '',
  '## Границы вывода', '',
  'Данные синтетические: URL и заголовки, без чанков текста, FTS, AI, импорта и удаления. Один локальный домен исключает массовые сетевые загрузки favicon. OS-кэш диска не сбрасывается. UI-сценарии, кроме повторных открытий, измерены по одному разу; их нельзя использовать как строгие пороги регрессии.', '',
  'Предварительный прогон показал, что скрытое окно может ждать requestAnimationFrame десятки секунд. Эти значения не вошли в итоговую таблицу. В итоговом прогоне временное окно удерживается сверху и проверяется document.visibilityState.', '',
  '## Вывод', '',
  'Чтение последних 500 использует индекс даты и почти не зависит от объёма базы. Поиск `%подстрока%` по URL/заголовку при редких или отсутствующих совпадениях сканирует весь набор через индекс даты. Синхронный запрос занимает main-процесс; серия изменений поля повторяет эту работу. Это подтверждённое место для следующей отдельной оптимизации. Текущие ограничение списка и ленивые favicon этим стендом не меняются.', '',
];
fs.writeFileSync(output.replace(/\.json$/, '.md'), lines.join('\n'));
console.log(`Saved ${output}`);
