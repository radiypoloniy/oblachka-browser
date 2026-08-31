// Куда уходит память: разбор app.getAppMetrics() ПО ПРОЦЕССАМ, с привязкой к вкладкам.
//
// ⚠️ Шаг 0 работы над памятью. Всё, что про память написано до замера, — гипотезы, и половина из
// них обычно неверна. Пока этого разбора нет, спорить не о чем: единственное число, которое у нас
// было, — суммарный Working Set, а он не говорит НИ на что уходит, НИ сколько стоит вкладка.
//
// ⚠️ Это ДИАГНОСТИКА, а не сторож: имя не *-drive.mjs, в `npm run drive` не входит и ничего не
// проваливает. Здесь нет «правильного» ответа — есть числа, которые надо прочитать.
//
// Что делает:
//   1. Поднимает приложение на изолированном профиле (боевые данные не открываются).
//   2. Мерит холодный старт: сколько процессов и сколько памяти сразу после запуска.
//   3. Ждёт весь каскад прогрева поповеров — они поднимаются отложенно и живут дальше сами.
//   4. Открывает N вкладок и заставляет каждую занять ИЗВЕСТНЫЙ объём.
//   5. Сшивает метрики по pid с вкладками (getOSProcessId) и печатает цену каждой.
//   6. Разведка: работает ли в Electron 42 заморозка страницы через CDP.
//
// ⚠️ Нагрузка СВОЯ, а не живые сайты. Двадцать реальных страниц дают красивое число и нулевую
// воспроизводимость: замер назавтра будет про другой веб, а не про другой браузер. Здесь каждая
// вкладка занимает ровно столько, сколько ей велено, — поэтому по разнице видно, что привязка
// pid↔вкладка вообще верна. Проверять инструмент до того, как им мерить, дешевле, чем потом
// объяснять расхождение.
//
// Запуск: npm run memory
//         npm run memory -- --tabs 8 --mb 30
import { withStand, wait } from './isolated-stand.mjs';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : def;
};
const TABS = opt('tabs', 12);
const MB_PER_TAB = opt('mb', 40);

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)} МБ`;
const pad = (s, n) => String(s).padEnd(n);

// ── чтение метрик из main ────────────────────────────────────────────────────────────────────

// ⚠️ getAppMetrics() отдаёт КИЛОБАЙТЫ и по ПРОЦЕССАМ — это и есть то, чего не хватало: суммарное
// число в TabManager собиралось отсюда же, но теряло и тип процесса, и pid.
const METRICS = `(() => {
  const { app, webContents } = process.mainModule.require('electron');
  const procs = app.getAppMetrics().map((m) => ({
    pid: m.pid,
    type: m.type,
    name: m.name ?? m.serviceName ?? '',
    ws: (m.memory?.workingSetSize ?? 0) * 1024,
    peak: (m.memory?.peakWorkingSetSize ?? 0) * 1024,
  }));
  // ⚠️ Связь pid↔вкладка лежала в одной строке и не использовалась ни разу: под давлением мы
  // выселяли самых ДАВНИХ, ничего не зная о том, кто из них дорогой.
  const views = webContents.getAllWebContents().map((w) => {
    let pid = 0;
    try { pid = w.getOSProcessId(); } catch { pid = 0; }
    let url = '';
    try { url = w.getURL(); } catch { url = ''; }
    return { pid, id: w.id, type: w.getType(), url: url.slice(0, 80), destroyed: w.isDestroyed() };
  });
  return { procs, views };
})()`;

function report(title, snap) {
  const { procs, views } = snap;
  const byPid = new Map();
  for (const v of views) {
    if (!byPid.has(v.pid)) byPid.set(v.pid, []);
    byPid.get(v.pid).push(v);
  }
  const total = procs.reduce((s, p) => s + p.ws, 0);

  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
  console.log(`  процессов ${procs.length}, вью ${views.length}, суммарно ${mb(total)}`);

  const byType = new Map();
  for (const p of procs) byType.set(p.type, (byType.get(p.type) ?? 0) + p.ws);
  console.log('  по типу процесса:');
  for (const [t, v] of [...byType].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${pad(t, 14)} ${pad(mb(v), 9)} ${(v / total * 100).toFixed(0)}%`);
  }
  return { total, byPid, procs, views };
}

// ── прогон ───────────────────────────────────────────────────────────────────────────────────

await withStand(async (ctx) => {
  console.log(`\nпрофиль: ${ctx.profile}`);
  console.log(`сценарий: ${TABS} вкладок по ${MB_PER_TAB} МБ нагрузки\n`);

  const snap = async () => ctx.evalMain(METRICS);

  await wait(2500);
  const cold = report('холодный старт', await snap());

  // ⚠️ Ждём каскад прогрева целиком: зоны перетаскивания, AI-панель, карточка сайта и загрузки
  // поднимаются отложенно (самый поздний — через 3600 мс после показа окна) и дальше живут сами.
  // Именно эта разница и есть цена «поповеры создаются лениво и не умирают».
  await wait(6000);
  const warm = report('после прогрева поповеров', await snap());
  console.log(`  прирост от прогрева: ${mb(warm.total - cold.total)}`);

  console.log(`\n  открываем ${TABS} вкладок…`);
  for (let i = 0; i < TABS; i++) {
    await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(ctx.echoUrl(`/tab-${i}`))})`);
    await wait(250);
  }
  await wait(4000);
  const opened = report(`${TABS} вкладок открыто (пустые)`, await snap());
  console.log(`  прирост от вкладок: ${mb(opened.total - warm.total)}  (~${mb((opened.total - warm.total) / TABS)} на вкладку)`);

  // ⚠️ Нагрузка кладётся В САМОЙ СТРАНИЦЕ, а не эмулируется: только так занятая память попадёт в
  // рендерер вкладки, а не в наш процесс, и привязку pid↔вкладка можно будет проверить на просвет.
  console.log(`\n  нагружаем каждую вкладку на ${MB_PER_TAB} МБ…`);
  const load = await ctx.evalMain(`(async () => {
    const { webContents } = process.mainModule.require('electron');
    const guests = webContents.getAllWebContents().filter((w) => w.getURL().includes('/tab-'));
    let done = 0;
    for (const w of guests) {
      try {
        await w.executeJavaScript(
          'window.__ballast = new Uint8Array(' + ${MB_PER_TAB} + ' * 1024 * 1024).fill(7); window.__ballast.length'
        );
        done++;
      } catch { /* вкладка не доехала — посчитаем по факту */ }
    }
    return { guests: guests.length, done };
  })()`);
  console.log(`  нагружено ${load.done} из ${load.guests}`);
  await wait(3000);
  const loaded = report(`${TABS} вкладок под нагрузкой`, await snap());
  const delta = loaded.total - opened.total;
  console.log(`  прирост от нагрузки: ${mb(delta)}  (ждали ~${MB_PER_TAB * load.done} МБ)`);
  console.log(delta > MB_PER_TAB * load.done * 1024 * 1024 * 0.6
    ? '  ✓ привязка сходится: занятое в страницах видно в метриках'
    : '  ⚠ прирост меньше ожидаемого — метрики или нагрузка врут, доверять цене вкладки нельзя');

  // ── цена каждой вкладки ────────────────────────────────────────────────────────────────────
  console.log('\n── цена каждой вью ───────────────────────────────────────────');
  console.log(`  ${pad('pid', 7)}${pad('тип вью', 16)}${pad('память', 10)}что это`);
  const rows = [];
  for (const p of loaded.procs) {
    const vs = loaded.byPid.get(p.pid) ?? [];
    const what = vs.length
      ? vs.map((v) => v.url || `(без адреса, ${v.type})`).join(' + ')
      : `— процесс без вью (${p.type}${p.name ? `, ${p.name}` : ''})`;
    rows.push({ pid: p.pid, type: vs[0]?.type ?? p.type, ws: p.ws, what });
  }
  for (const r of rows.sort((a, b) => b.ws - a.ws)) {
    console.log(`  ${pad(r.pid, 7)}${pad(r.type, 16)}${pad(mb(r.ws), 10)}${r.what.slice(0, 78)}`);
  }

  // ⚠️ Главное число раздела: сколько держат рендереры, которые человеку сейчас ничего не
  // показывают. Это и есть «поповеры не умирают» в мегабайтах, а не в предположении.
  // Слой хрома (index.html) сюда НЕ входит — он и есть интерфейс, он виден всегда.
  const hidden = rows.filter((r) => !r.what.includes('/tab-') && !r.what.includes('index.html')
    && !r.what.startsWith('—'));
  const hiddenSum = hidden.reduce((s, r) => s + r.ws, 0);
  console.log(`\n  вью, ничего не показывающих человеку: ${hidden.length}, они держат ${mb(hiddenSum)}`);
  for (const r of hidden) console.log(`    ${pad(mb(r.ws), 9)}${r.what.slice(0, 70)}`);

  // ⚠️ Процесс Browser отслеживаем ОТДЕЛЬНО по всем этапам: сумма по типам его прячет, а он в
  // замере оказался самым крупным потребителем — этого не предполагала ни одна из гипотез.
  const browser = (s) => s.procs.find((p) => p.type === 'Browser')?.ws ?? 0;
  console.log('\n── главный процесс (Browser) по этапам ───────────────────────');
  console.log(`  холодный старт      ${mb(browser(cold))}`);
  console.log(`  после прогрева      ${mb(browser(warm))}   (+${mb(browser(warm) - browser(cold))})`);
  console.log(`  вкладки открыты     ${mb(browser(opened))}   (+${mb(browser(opened) - browser(warm))})`);
  console.log(`  вкладки нагружены   ${mb(browser(loaded))}   (+${mb(browser(loaded) - browser(opened))})`);

  // ── разведка: работает ли заморозка через CDP ──────────────────────────────────────────────
  //
  // ⚠️ От этого ответа зависит, существует ли «третья передача» (заморозка между живой вкладкой и
  // выгруженной) вообще. Разведка ничего не меняет: одна вкладка, туда и обратно.
  console.log('\n── разведка: заморозка страницы через CDP ────────────────────');
  const freeze = await ctx.evalMain(`(async () => {
    const { webContents } = process.mainModule.require('electron');
    const w = webContents.getAllWebContents().find((x) => x.getURL().includes('/tab-0'));
    if (!w) return { ошибка: 'подопытная вкладка не найдена' };
    const out = {};
    try { w.debugger.attach('1.3'); } catch (e) { out.attach = String(e.message); }
    try {
      await w.debugger.sendCommand('Page.enable');
      await w.debugger.sendCommand('Page.setWebLifecycleState', { state: 'frozen' });
      out.frozen = true;
    } catch (e) { out.frozen = String(e.message); }
    try {
      await w.debugger.sendCommand('Memory.forciblyPurgeJavaScriptMemory');
      out.purged = true;
    } catch (e) { out.purged = String(e.message); }
    try {
      await w.debugger.sendCommand('Page.setWebLifecycleState', { state: 'active' });
      out.thawed = true;
    } catch (e) { out.thawed = String(e.message); }
    try { w.debugger.detach(); } catch { /* уже отцеплен */ }
    return out;
  })()`);
  console.log(`  Page.setWebLifecycleState('frozen'):        ${freeze.frozen === true ? 'РАБОТАЕТ' : freeze.frozen}`);
  console.log(`  Memory.forciblyPurgeJavaScriptMemory:      ${freeze.purged === true ? 'РАБОТАЕТ' : freeze.purged}`);
  console.log(`  возврат в 'active':                        ${freeze.thawed === true ? 'РАБОТАЕТ' : freeze.thawed}`);
  if (freeze.attach) console.log(`  attach: ${freeze.attach}`);

  // ⚠️ Оговорка, без которой числа выше можно прочитать неправильно. getAppMetrics отдаёт ТОЛЬКО
  // Working Set (privateBytes из Electron убран), а он включает разделяемые страницы — то есть
  // сумма по процессам их СЧИТАЕТ НЕСКОЛЬКО РАЗ. Годится для «кто из них дороже» и для «стало
  // легче или нет», но абсолютное «браузер занимает X» по нему называть нельзя.
  console.log('\n  ⚠️ Working Set включает разделяемые страницы: сумма по процессам их');
  console.log('     задваивает. Числа сравнимы между собой, абсолютная сумма завышена.');

  console.log('\n── итог ──────────────────────────────────────────────────────');
  console.log(`  холодный старт      ${mb(cold.total)}`);
  console.log(`  + прогрев поповеров ${mb(warm.total - cold.total)}`);
  console.log(`  + ${TABS} пустых вкладок  ${mb(opened.total - warm.total)}`);
  console.log(`  + нагрузка страниц  ${mb(loaded.total - opened.total)}`);
  console.log(`  ИТОГО               ${mb(loaded.total)}`);
  console.log('');
}, { main: true });
