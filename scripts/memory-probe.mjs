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
    priv: (m.memory?.privateBytes ?? 0) * 1024,
    cpu: m.cpu?.percentCPUUsage ?? 0,
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
  // ⚠️ Разбор САМОГО главного процесса. getAppMetrics говорит, СКОЛЬКО он держит, и молчит о том,
  // ЧТО там лежит, — а держит он больше всех остальных вместе взятых. Этот код выполняется прямо
  // в нём, поэтому process.memoryUsage() и статистика V8 здесь про него и есть.
  const v8 = process.mainModule.require('v8');
  const mu = process.memoryUsage();
  const hs = v8.getHeapStatistics();
  const main = {
    rss: mu.rss,
    heapTotal: mu.heapTotal,
    heapUsed: mu.heapUsed,
    external: mu.external,
    arrayBuffers: mu.arrayBuffers,
    malloced: hs.malloced_memory,
    peakMalloced: hs.peak_malloced_memory,
  };
  return { procs, views, main };
})()`;

function report(title, snap) {
  const { procs, views } = snap;
  const byPid = new Map();
  for (const v of views) {
    if (!byPid.has(v.pid)) byPid.set(v.pid, []);
    byPid.get(v.pid).push(v);
  }
  // ⚠️ Главное число — Private Bytes, а не Working Set. Working Set включает разделяемые страницы
  // и файловый кэш (в том числе mmap-нутый файл модели), поэтому сумма по процессам их задваивает,
  // а падение этого числа ничего не стоит: страницы просто вытеснили. Private — то, что процесс
  // реально забрал у системы. Оба печатаются рядом, чтобы разницу было видно, а не приходилось
  // верить на слово.
  const total = procs.reduce((s, p) => s + p.priv, 0);
  const totalWs = procs.reduce((s, p) => s + p.ws, 0);

  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`);
  console.log(`  процессов ${procs.length}, вью ${views.length}`);
  console.log(`  Private Bytes ${mb(total)}   ·   Working Set ${mb(totalWs)}`);

  const byType = new Map();
  for (const p of procs) byType.set(p.type, (byType.get(p.type) ?? 0) + p.priv);
  console.log('  Private Bytes по типу процесса:');
  for (const [t, v] of [...byType].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${pad(t, 14)} ${pad(mb(v), 9)} ${(v / total * 100).toFixed(0)}%`);
  }
  return { total, totalWs, byPid, procs, views, main: snap.main };
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
  console.log(`  ${pad('pid', 7)}${pad('тип вью', 14)}${pad('private', 10)}${pad('workset', 10)}что это`);
  const rows = [];
  for (const p of loaded.procs) {
    const vs = loaded.byPid.get(p.pid) ?? [];
    const what = vs.length
      ? vs.map((v) => v.url || `(без адреса, ${v.type})`).join(' + ')
      : `— процесс без вью (${p.type}${p.name ? `, ${p.name}` : ''})`;
    rows.push({ pid: p.pid, type: vs[0]?.type ?? p.type, ws: p.ws, priv: p.priv, what });
  }
  for (const r of rows.sort((a, b) => b.priv - a.priv)) {
    console.log(`  ${pad(r.pid, 7)}${pad(r.type, 14)}${pad(mb(r.priv), 10)}${pad(mb(r.ws), 10)}${r.what.slice(0, 62)}`);
  }

  // ⚠️ Главное число раздела: сколько держат рендереры, которые человеку сейчас ничего не
  // показывают. Это и есть «поповеры не умирают» в мегабайтах, а не в предположении.
  // Слой хрома (index.html) сюда НЕ входит — он и есть интерфейс, он виден всегда.
  const hidden = rows.filter((r) => !r.what.includes('/tab-') && !r.what.includes('index.html')
    && !r.what.startsWith('—'));
  const hiddenSum = hidden.reduce((s, r) => s + r.priv, 0);
  console.log(`\n  вью, ничего не показывающих человеку: ${hidden.length}, они держат ${mb(hiddenSum)}`);
  for (const r of hidden) console.log(`    ${pad(mb(r.priv), 9)}${r.what.slice(0, 70)}`);

  // ⚠️ Процесс Browser отслеживаем ОТДЕЛЬНО по всем этапам: сумма по типам его прячет, а он в
  // замере оказался самым крупным потребителем — этого не предполагала ни одна из гипотез.
  const browser = (s) => s.procs.find((p) => p.type === 'Browser')?.priv ?? 0;
  console.log('\n── главный процесс (Browser), Private Bytes по этапам ────────');
  console.log(`  холодный старт      ${mb(browser(cold))}`);
  console.log(`  после прогрева      ${mb(browser(warm))}   (+${mb(browser(warm) - browser(cold))})`);
  console.log(`  вкладки открыты     ${mb(browser(opened))}   (+${mb(browser(opened) - browser(warm))})`);
  console.log(`  вкладки нагружены   ${mb(browser(loaded))}   (+${mb(browser(loaded) - browser(opened))})`);

  // ── куда уходит главный процесс ────────────────────────────────────────────────────────────
  //
  // ⚠️ Раздел отвечает на вопрос, который прошлый замер только поставил: Browser держит больше
  // половины всей памяти, и почти всё берёт в первые секунды. getAppMetrics на этот вопрос
  // ответить не может — он знает сумму, а не состав.
  //
  // Три корзины, и различать их обязательно, потому что чинятся они по-разному:
  //   • V8 heap  — наши объекты в JS. Растёт от кода main-процесса; утечка здесь видна снимком кучи.
  //   • external — то, что V8 держит снаружи: ArrayBuffer'ы, буферы Node. Сюда попадают, например,
  //                прочитанные файлы и кэши в Buffer.
  //   • нативное — всё остальное: better-sqlite3, движок адблока, внутренности самого Chromium
  //                (сеть, дисковый кэш, композитор). V8 их не видит вовсе, снимок кучи бесполезен.
  //
  // ⚠️ «Нативное» считается вычитанием и потому приблизительно: private byte'ы Windows и учёт V8
  // меряют не одно и то же. Но порядок величины эта разность даёт честно, а нам сейчас нужен
  // именно он — понять, в какой из трёх корзин лежит гигабайт, прежде чем лезть внутрь.
  console.log('\n── куда уходит главный процесс ───────────────────────────────');
  console.log(`  ${pad('этап', 20)}${pad('private', 10)}${pad('rss', 10)}${pad('V8 heap', 10)}${pad('external', 10)}нативное`);
  const mainRow = (title, s) => {
    const priv = s.procs.find((p) => p.type === 'Browser')?.priv ?? 0;
    const m = s.main ?? {};
    const native = priv - (m.heapTotal ?? 0) - (m.external ?? 0);
    console.log(
      `  ${pad(title, 20)}${pad(mb(priv), 10)}${pad(mb(m.rss ?? 0), 10)}`
      + `${pad(mb(m.heapTotal ?? 0), 10)}${pad(mb(m.external ?? 0), 10)}${mb(native)}`,
    );
  };
  mainRow('холодный старт', cold);
  mainRow('после прогрева', warm);
  mainRow('вкладки открыты', opened);
  mainRow('вкладки нагружены', loaded);
  console.log('\n  ⚠️ где вырос гигабайт — в той корзине и надо копать. V8 heap → снимок кучи main;');
  console.log(`     нативное → подозреваемые по порядку: движок адблока, better-sqlite3, кэши Chromium.`);

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

  console.log('\n── итог (Private Bytes) ──────────────────────────────────────');
  console.log(`  холодный старт      ${mb(cold.total)}`);
  console.log(`  + прогрев поповеров ${mb(warm.total - cold.total)}`);
  console.log(`  + ${TABS} пустых вкладок  ${mb(opened.total - warm.total)}`);
  console.log(`  + нагрузка страниц  ${mb(loaded.total - opened.total)}`);
  console.log(`  ИТОГО               ${mb(loaded.total)}`);
  console.log('');
}, { main: true });
