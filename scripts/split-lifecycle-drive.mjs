// Живой регрессионный сценарий для нескольких split-пар: парковка, выход и закрытие панелей.
// ⚠️ withStand запускает приложение на временном профиле и локальном эхо-сервере.
// Запуск: npm run drive -- split-lifecycle
import { withStand, wait } from './isolated-stand.mjs';

let passed = 0;
let failed = 0;
function check(label, condition, detail = '') {
  if (condition) passed++; else failed++;
  console.log(` ${condition ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
}

await withStand(async (ctx) => {
  const call = (method, ...args) => ctx.chrome.evaluate(
    `window.oblako.${method}(${args.map((arg) => JSON.stringify(arg)).join(',')})`,
  );
  const state = async () => {
    // IPC-снимок атомарен: отдельные запросы вкладок и узлов могли бы застать разные кадры.
    await wait(350);
    return call('getSyncState');
  };
  const pairs = (s) => s.nodes.filter((n) => n.type === 'split-pair');
  const singles = (s) => s.nodes.filter((n) => n.type === 'single').map((n) => n.tabId);
  const active = (s) => s.tabs.find((t) => t.isActive)?.id;
  const tab = (s, id) => s.tabs.find((t) => t.id === id);
  const pairIs = (n, left, right) => n?.leftTabId === left && n?.rightTabId === right;
  const consistent = (s) => {
    const byId = new Map(s.tabs.map((t) => [t.id, t]));
    return pairs(s).every((n) =>
      byId.get(n.leftTabId)?.splitSide === 'left' &&
      byId.get(n.rightTabId)?.splitSide === 'right' &&
      n.leftTabId !== n.rightTabId,
    );
  };

  const ids = {};
  for (const name of ['a', 'b', 'c', 'd', 'e']) {
    ids[name] = await call('createTab', ctx.echoUrl(`/split-${name}`));
  }
  check('пять независимых страниц созданы', new Set(Object.values(ids)).size === 5);

  await call('activateTab', ids.a);
  await call('enterSplit', ids.b);
  let s = await state();
  check('первая пара собрана', pairs(s).length === 1 && pairIs(pairs(s)[0], ids.a, ids.b));
  check('стороны первой пары согласованы', consistent(s));

  await call('activateTab', ids.c); // первая пара остаётся в дереве, но уходит с экрана
  await call('enterSplit', ids.d);
  s = await state();
  check('две пары существуют одновременно', pairs(s).length === 2 &&
    pairIs(pairs(s)[0], ids.a, ids.b) && pairIs(pairs(s)[1], ids.c, ids.d));
  check('вторая пара активна, первая припаркована', active(s) === ids.c && consistent(s));

  await call('exitSplit', ids.a); // разбираем не показываемую пару
  s = await state();
  check('выход из припаркованной пары не тронул показываемую',
    pairs(s).length === 1 && pairIs(pairs(s)[0], ids.c, ids.d) && active(s) === ids.c);
  check('панели припаркованной пары стали одиночными',
    singles(s).includes(ids.a) && singles(s).includes(ids.b) &&
    tab(s, ids.a)?.splitSide === null && tab(s, ids.b)?.splitSide === null && consistent(s));

  await call('closeTab', ids.c); // закрываем активную панель показываемой пары
  s = await state();
  check('закрытие активной панели оставило вторую активной',
    pairs(s).length === 0 && !tab(s, ids.c) && active(s) === ids.d &&
    singles(s).includes(ids.d) && tab(s, ids.d)?.splitSide === null);
  check('остальные страницы пережили закрытие',
    [ids.a, ids.b, ids.d, ids.e].every((id) => Boolean(tab(s, id))));

  await call('activateTab', ids.a);
  await call('enterSplit', ids.b);
  await call('activateTab', ids.e); // снова паркуем пару
  await call('closeTab', ids.b); // теперь закрываем панель припаркованной пары
  s = await state();
  check('закрытие припаркованной панели не сменило активную вкладку',
    pairs(s).length === 0 && !tab(s, ids.b) && active(s) === ids.e);
  check('вторая панель припаркованной пары сохранилась одиночной',
    singles(s).includes(ids.a) && tab(s, ids.a)?.splitSide === null);
});

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
