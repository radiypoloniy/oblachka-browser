// Живой круг сессии для ВСЕГО ДЕРЕВА: группа, split-пара, закреплённая вкладка → перезапуск →
// то же дерево. Не *-check.mjs — поднимает настоящее приложение, в npm test не входит.
//
// ⚠️ Ради чего заведена. CLAUDE.md называет этот код самым опасным в проекте: «Ломка формата или
// гонка в моменте сохранения/восстановления = потеря вкладок пользователя». Держат его сейчас две
// проверки, и обе мимо середины:
//   • session-roundtrip-check гоняет ЧИСТУЮ ЛОГИКУ shared/sessionTree.ts — он ничего не знает о
//     том, доезжает ли снимок до диска и поднимает ли его TabManager;
//   • session-restore-drive поднимает приложение, но кладёт в него ДВЕ ПЛОСКИЕ ВКЛАДКИ, то есть
//     ровно тот случай, в котором формат v5 нечему ломать.
// А теряются у человека не плоские вкладки. Теряются группы, пара split и закрепы — всё, что в
// снимке имеет структуру. Эта проверка про них.
//
// ⚠️ Сравниваем ФОРМУ и АДРЕСА, а не идентификаторы. При восстановлении id вкладок и групп
// выдаются заново — это не баг, а устройство: снимок хранит адреса, а не ссылки на живые объекты.
// Проверка, написанная «по id», была бы красной всегда и ничего не значила бы.
//
// ⚠️ Адреса берутся у ЭХО-СЕРВЕРА стенда, а не из интернета. Проверка про сессию, и падать она
// должна от сессии, а не от того, что на машине нет сети.
//
// ⚠️ Профиль изолированный (withStand: свой --user-data-dir во временной папке + assertSafeProfile).
// Вкладки, группы и закладки человека не открываются и не трогаются.
//
// Запуск: npm run drive -- session-tree
import { withStand, wait } from './isolated-stand.mjs';

let ok = 0;
let bad = 0;
const check = (what, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ok   ${what}${detail ? ` — ${detail}` : ''}`); }
  else { bad++; console.log(` FAIL  ${what}${detail ? ` — ${detail}` : ''}`); }
};

/** Короткое имя страницы из адреса — по нему и сверяем состав дерева. */
const leaf = (url) => {
  const tail = String(url ?? '').replace(/\/$/, '').split('/').pop();
  try { return decodeURIComponent(tail); } catch { return tail; }
};

/** Дерево в виде, пригодном для сравнения: типы узлов + адреса вместо id. */
function shapeOf(nodes, byId) {
  return (nodes ?? []).map((n) => {
    if (n.type === 'single') return { t: 'single', url: leaf(byId[n.tabId]) };
    if (n.type === 'split-pair') {
      return { t: 'split', left: leaf(byId[n.leftTabId]), right: leaf(byId[n.rightTabId]), ratio: n.ratio };
    }
    return { t: 'group', label: n.label, collapsed: n.collapsed, children: shapeOf(n.children, byId) };
  });
}

await withStand(async (ctx) => {
  console.log('профиль:', ctx.profile, '\n');

  const snapshot = async () => {
    const tabs = await ctx.chrome.evaluate('window.oblako.getAllTabs()');
    const nodes = await ctx.chrome.evaluate('window.oblako.getSidebarNodes()');
    const byId = Object.fromEntries((tabs ?? []).map((t) => [t.id, t.url]));
    return {
      tabs: tabs ?? [],
      nodes: nodes ?? [],
      shape: shapeOf(nodes, byId),
      pinned: (tabs ?? []).filter((t) => t.isPinned).map((t) => leaf(t.url)).sort(),
      sides: Object.fromEntries((tabs ?? []).filter((t) => t.splitSide).map((t) => [leaf(t.url), t.splitSide])),
    };
  };

  // ⚠️ echoUrl — ФУНКЦИЯ, а не строка (см. isolated-stand.mjs). Подставленная в шаблон как
  // значение, она превращалась в текст стрелочной функции, омнибокс принимал его за поисковый
  // запрос, и вкладки уходили в поисковик вместо эхо-сервера. Поймано этой же проверкой.
  const u = (name) => ctx.echoUrl(`/${name}`);
  const mk = async (name) => {
    const id = await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(u(name))})`);
    await wait(500);
    return id;
  };

  console.log('— собираем дерево —');
  const plain = await mk('plain');
  const pinned = await mk('pinned');
  const grpA = await mk('grp-a');
  const grpB = await mk('grp-b');
  const splitL = await mk('split-left');
  const splitR = await mk('split-right');
  check('шесть вкладок создались', [plain, pinned, grpA, grpB, splitL, splitR].every(Boolean));

  await ctx.chrome.evaluate(`window.oblako.togglePinTab(${JSON.stringify(pinned)})`);
  await wait(400);

  await ctx.chrome.evaluate(`window.oblako.createGroup(${JSON.stringify(grpA)})`);
  await wait(600);
  const withGroup = await ctx.chrome.evaluate('window.oblako.getSidebarNodes()');
  const groupId = (withGroup ?? []).find((n) => n.type === 'group')?.id ?? null;
  check('группа завелась', Boolean(groupId), groupId ?? 'группы нет');
  if (groupId) {
    await ctx.chrome.evaluate(`window.oblako.addTabToGroup(${JSON.stringify(groupId)}, ${JSON.stringify(grpB)})`);
    await wait(400);
    await ctx.chrome.evaluate(`window.oblako.renameGroup(${JSON.stringify(groupId)}, ${JSON.stringify('Отчётность')})`);
    await wait(400);
  }

  // ⚠️ Левой панелью становится АКТИВНАЯ вкладка, правой — та, чей id передан. Поэтому сначала
  // активируем левую: без этого пара соберётся из случайной вкладки, и проверка будет про другое.
  await ctx.chrome.evaluate(`window.oblako.activateTab(${JSON.stringify(splitL)})`);
  await wait(500);
  await ctx.chrome.evaluate(`window.oblako.enterSplit(${JSON.stringify(splitR)})`);
  await wait(800);
  // Доля НЕ по умолчанию: 0.5 совпала бы со значением, которое подставляется при разборе битого
  // снимка, и «восстановилось» было бы неотличимо от «не восстановилось».
  await ctx.chrome.evaluate('window.oblako.setSplitRatio(0.35)');
  await wait(600);

  const before = await snapshot();
  console.log('  дерево до перезапуска:', JSON.stringify(before.shape));
  check('в дереве есть группа', before.shape.some((n) => n.t === 'group'));
  check('в дереве есть split-пара', before.shape.some((n) => n.t === 'split'));
  check('закреплённая вкладка одна', before.pinned.length === 1, before.pinned.join(','));

  console.log('\n— перезапуск на том же профиле —');
  await ctx.restart();
  await wait(2500);

  const after = await snapshot();
  console.log('  дерево после перезапуска:', JSON.stringify(after.shape));

  console.log('\n— что доехало —');
  check('число вкладок совпадает',
    after.tabs.length === before.tabs.length, `${before.tabs.length} → ${after.tabs.length}`);
  check('состав адресов совпадает',
    JSON.stringify(after.tabs.map((t) => leaf(t.url)).sort()) === JSON.stringify(before.tabs.map((t) => leaf(t.url)).sort()));
  check('закреп пережил перезапуск',
    JSON.stringify(after.pinned) === JSON.stringify(before.pinned), after.pinned.join(',') || 'закрепов нет');

  const groupBefore = before.shape.find((n) => n.t === 'group');
  const groupAfter = after.shape.find((n) => n.t === 'group');
  check('группа на месте', Boolean(groupAfter));
  check('имя группы цело', groupAfter?.label === groupBefore?.label, groupAfter?.label ?? '—');
  check('состав группы цел',
    JSON.stringify(groupAfter?.children) === JSON.stringify(groupBefore?.children),
    JSON.stringify(groupAfter?.children ?? null));

  const splitBefore = before.shape.find((n) => n.t === 'split');
  const splitAfter = after.shape.find((n) => n.t === 'split');
  check('split-пара на месте', Boolean(splitAfter));
  check('стороны пары не поменялись местами',
    splitAfter?.left === splitBefore?.left && splitAfter?.right === splitBefore?.right,
    `${splitAfter?.left} | ${splitAfter?.right}`);
  // ⚠️ Доля — единственное недоверенное число снимка: оно приходит ИЗ ФАЙЛА и зажимается
  // clampSplitRatio. Потеря именно её выглядит как «панели разъехались сами».
  check('доля панелей цела', splitAfter?.ratio === splitBefore?.ratio,
    `${splitBefore?.ratio} → ${splitAfter?.ratio}`);

  // ⚠️ Сторона панели живёт ДВАЖДЫ: в узле дерева (leftTabId/rightTabId) и в самой вкладке
  // (splitSide, по нему main кладёт WebContentsView). Разъедутся — пара нарисуется, а страницы
  // окажутся не в своих половинах.
  check('стороны у самих вкладок совпадают с деревом',
    JSON.stringify(after.sides) === JSON.stringify(before.sides), JSON.stringify(after.sides));

  check('порядок узлов верхнего уровня цел',
    JSON.stringify(after.shape.map((n) => n.t)) === JSON.stringify(before.shape.map((n) => n.t)),
    JSON.stringify(after.shape.map((n) => n.t)));
});

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло\n`);
process.exit(bad === 0 ? 0 : 1);
