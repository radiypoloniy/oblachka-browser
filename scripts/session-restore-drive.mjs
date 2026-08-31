// Живая проверка круга сессии: открыть вкладки → перезапустить приложение → те же вкладки.
//
// ⚠️ В `npm test` НЕ входит и не должна: та гоняет чистую логику и статику за секунду, а здесь
// дважды поднимается настоящее приложение. Круг сессии на чистой логике проверяет
// scripts/session-roundtrip-check.mjs (shared/sessionTree.ts) — но он ничего не знает о том,
// доезжает ли снимок до диска и поднимает ли его TabManager на старте. Эта проверка про это.
//
// Плоский случай — здесь; структура (группы, split-пара, закрепы) — в session-tree-drive.mjs.
// Разделены намеренно: когда красной становится эта, сломан сам круг «диск → TabManager», а когда
// та — уцелел круг, но потерялась форма дерева. Диагнозы разные, и сводить их в одну проверку
// значило бы каждый раз выяснять, который из двух.
//
// ⚠️ Профиль СВОЙ, во временной папке, и адреса берутся у ЭХО-СЕРВЕРА стенда. Раньше проверка
// поднимала Electron собственным кодом и ходила на example.com: это давало две беды сразу —
// свой запуск шёл мимо assertSafeProfile (единственная машинная защита от «а вдруг это боевой
// профиль»), а без сети проверка краснела по причине, к сессии отношения не имеющей. Оба пункта
// закрыты переходом на общий стенд.
//
// Запуск: npm run drive -- session-restore
import { withStand, wait } from './isolated-stand.mjs';

let ok = 0;
let bad = 0;
const check = (what, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ok   ${what}${detail ? ` — ${detail}` : ''}`); }
  else { bad++; console.log(` FAIL  ${what}${detail ? ` — ${detail}` : ''}`); }
};

// ⚠️ Раскодируем: кириллица в пути уезжает в %D0%BF%D0%B5…, и сравнение имён «первая» с ним
// не сходится. Поймано этой же проверкой на первом прогоне.
const leaf = (url) => {
  const tail = String(url ?? '').replace(/\/$/, '').split('/').pop();
  try { return decodeURIComponent(tail); } catch { return tail; }
};

await withStand(async (ctx) => {
  console.log('профиль:', ctx.profile, '\n');

  const NAMES = ['первая', 'вторая', 'третья'];
  for (const n of NAMES) {
    await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(ctx.echoUrl(`/${n}`))})`);
    await wait(500);
  }

  const before = await ctx.chrome.evaluate('window.oblako.getAllTabs()');
  const beforeLeaves = (before ?? []).map((t) => leaf(t.url));
  check('вкладки открылись', NAMES.every((n) => beforeLeaves.includes(n)), beforeLeaves.join(', '));

  // ⚠️ Эхо-сервер отвечает на самом деле — значит проверяется и то, что восстановленная вкладка
  // держит РАБОЧИЙ адрес, а не строку, которую омнибокс потом примет за поисковый запрос.
  check('страницы действительно загрузились с эхо-сервера',
    NAMES.every((n) => ctx.echo.hits.some((h) => {
      try { return decodeURIComponent(String(h.url)).includes(n); } catch { return false; }
    })));

  console.log('\n— перезапуск на том же профиле —');
  await ctx.restart();
  await wait(2500);

  const after = await ctx.chrome.evaluate('window.oblako.getAllTabs()');
  const afterLeaves = (after ?? []).map((t) => leaf(t.url));
  console.log('  после перезапуска:', afterLeaves.join(', '));

  check('все вкладки вернулись', NAMES.every((n) => afterLeaves.includes(n)));
  check('лишних вкладок не появилось',
    (after ?? []).length === (before ?? []).length, `${(before ?? []).length} → ${(after ?? []).length}`);
  check('порядок вкладок сохранён',
    JSON.stringify(afterLeaves) === JSON.stringify(beforeLeaves), afterLeaves.join(', '));
});

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло\n`);
process.exit(bad === 0 ? 0 : 1);
