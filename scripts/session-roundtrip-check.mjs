// Round-trip сессии: дерево вкладок → сохранили → восстановили → то же дерево.
//
// Зачем именно эта проверка. Формат session.json — самое дорогое место проекта при поломке: в нём
// лежат открытые вкладки человека, и ошибка тут стоит ему потерянной работы, а не покрасневшего
// теста. Проверить логику раньше было нечем — она жила приватными методами TabManager, который
// тянет WebContentsView и поднимается только вместе с приложением и БОЕВЫМ профилем. После выноса
// в shared/sessionTree.ts она проверяется за миллисекунды и на выдуманных данных.
//
// Восстановление здесь повторяет реальный путь из electron/main.ts: обход сохранённого дерева,
// создание вкладки на каждый URL по порядку и накопление очереди url → [tabId].
//
// Запуск: npm test -- session
import {
  serializeNodes, countSavedTabs, buildNodesFromSaved, collectSplitPairs,
} from '../shared/sessionTree.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${JSON.stringify(actual)}\n         ждали    ${JSON.stringify(expected)}`);
}

// ── Стенд: карта вкладок вместо живого TabManager ───────────────────────────
function makeWorld(tabs, pairs = {}) {
  return {
    view: (id) => tabs[id] ?? null,
    liveRatio: (leftId) => pairs[leftId] ?? null,
  };
}
const tab = (url, extra = {}) => ({ url, savable: true, ...extra });

// Повторяет electron/main.ts: обходит сохранённое дерево, «создаёт» вкладку на каждый URL
// по порядку и копит очередь url → [id]. Возвращает восстановленное дерево.
function restore(saved) {
  const urlToIds = new Map();
  let seq = 0;
  const push = (url) => {
    const id = `t${++seq}`;
    const list = urlToIds.get(url) ?? [];
    list.push(id);
    urlToIds.set(url, list);
    return id;
  };
  const collect = (nodes) => {
    for (const n of nodes) {
      if (n.type === 'single') push(n.url);
      else if (n.type === 'split-pair') { push(n.leftUrl); push(n.rightUrl); }
      else if (n.type === 'group') collect(n.children);
    }
  };
  collect(saved);
  return buildNodesFromSaved(saved, urlToIds);
}

// Форма дерева в терминах URL — чтобы сравнивать структуру, не завися от конкретных id.
function shape(nodes, idToUrl) {
  return nodes.map((n) => {
    if (n.type === 'single') return { single: idToUrl(n.tabId) };
    if (n.type === 'split-pair') return { pair: [idToUrl(n.leftTabId), idToUrl(n.rightTabId)], ratio: n.ratio };
    return { group: n.label, id: n.id, color: n.color, collapsed: n.collapsed, children: shape(n.children, idToUrl) };
  });
}
// После restore id выдаются подряд в порядке обхода — восстановить url можно из того же обхода.
function restoreWithUrls(saved) {
  const urls = [];
  const collect = (nodes) => {
    for (const n of nodes) {
      if (n.type === 'single') urls.push(n.url);
      else if (n.type === 'split-pair') { urls.push(n.leftUrl); urls.push(n.rightUrl); }
      else if (n.type === 'group') collect(n.children);
    }
  };
  collect(saved);
  const tree = restore(saved);
  return shape(tree, (id) => urls[Number(id.slice(1)) - 1]);
}
// Форма исходного дерева в тех же терминах — эталон для сравнения.
function savedShape(saved) {
  return saved.map((n) => {
    if (n.type === 'single') return { single: n.url };
    if (n.type === 'split-pair') return { pair: [n.leftUrl, n.rightUrl], ratio: n.ratio };
    return { group: n.label, id: n.id, color: n.color, collapsed: n.collapsed, children: savedShape(n.children) };
  });
}

console.log('\n— простое дерево переживает круг —');
{
  const world = makeWorld({ a: tab('https://a.ru'), b: tab('https://b.ru') });
  const nodes = [{ type: 'single', tabId: 'a' }, { type: 'single', tabId: 'b' }];
  const saved = serializeNodes(nodes, world);
  check('две вкладки сохранены', saved.map((s) => s.url), ['https://a.ru', 'https://b.ru']);
  check('после восстановления дерево то же', restoreWithUrls(saved), savedShape(saved));
  check('счётчик сходится', countSavedTabs(saved), 2);
}

console.log('\n— заголовок и иконка —');
{
  const world = makeWorld({ a: tab('https://a.ru', { title: 'Заголовок', faviconData: 'data:image/png;base64,X' }) });
  const saved = serializeNodes([{ type: 'single', tabId: 'a' }], world);
  check('title и faviconData сохраняются', saved[0], {
    type: 'single', url: 'https://a.ru', title: 'Заголовок', faviconData: 'data:image/png;base64,X',
  });
}
{
  // ⚠️ Пустые поля НЕ должны появляться в файле: формат объявляет их optional, и запись
  // title:undefined раздувала бы session.json пустышками при каждом автосейве.
  const world = makeWorld({ a: tab('https://a.ru') });
  const saved = serializeNodes([{ type: 'single', tabId: 'a' }], world);
  check('неизвестные title/favicon в файл не пишутся', Object.keys(saved[0]), ['type', 'url']);
}

console.log('\n— что в сессию не идёт —');
{
  const world = makeWorld({
    ok: tab('https://ok.ru'),
    priv: tab('https://secret.ru', { savable: false }),   // инкогнито или короткоживущая
    hub: tab('', { savable: false }),                      // псевдо-вкладка без URL
  });
  const nodes = [{ type: 'single', tabId: 'ok' }, { type: 'single', tabId: 'priv' }, { type: 'single', tabId: 'hub' }];
  const saved = serializeNodes(nodes, world);
  check('несохраняемые вкладки отброшены', saved.map((s) => s.url), ['https://ok.ru']);
}
{
  // Узел ссылается на вкладку, которой уже нет в tabMap — «осиротевший» узел.
  const world = makeWorld({ a: tab('https://a.ru') });
  const saved = serializeNodes([{ type: 'single', tabId: 'a' }, { type: 'single', tabId: 'ghost' }], world);
  check('узел без вкладки пропускается', saved.length, 1);
}

console.log('\n— split-пара —');
{
  const world = makeWorld({ l: tab('https://l.ru'), r: tab('https://r.ru') }, { l: 0.35 });
  const nodes = [{ type: 'split-pair', leftTabId: 'l', rightTabId: 'r', ratio: 0.5 }];
  const saved = serializeNodes(nodes, world);
  check('живой ratio важнее записанного в узле', saved[0].ratio, 0.35);
  check('пара переживает круг', restoreWithUrls(saved), savedShape(saved));
  check('пара считается за две вкладки', countSavedTabs(saved), 2);
}
{
  const world = makeWorld({ l: tab('https://l.ru'), r: tab('https://r.ru') });
  const saved = serializeNodes([{ type: 'split-pair', leftTabId: 'l', rightTabId: 'r', ratio: 0.42 }], world);
  check('без живой пары берётся ratio узла', saved[0].ratio, 0.42);
}
{
  // Половина пары приватная — пара обязана выродиться в одиночную вкладку, а не исчезнуть целиком
  // и не сохранить приватный адрес.
  const world = makeWorld({ l: tab('https://l.ru'), r: tab('https://secret.ru', { savable: false }) });
  const saved = serializeNodes([{ type: 'split-pair', leftTabId: 'l', rightTabId: 'r', ratio: 0.5 }], world);
  check('пара вырождается в одиночную вкладку', saved, [{ type: 'single', url: 'https://l.ru' }]);
}
{
  const world = makeWorld({ l: tab('https://a.ru', { savable: false }), r: tab('https://b.ru', { savable: false }) });
  const saved = serializeNodes([{ type: 'split-pair', leftTabId: 'l', rightTabId: 'r', ratio: 0.5 }], world);
  check('пара из двух несохраняемых исчезает', saved, []);
}
{
  // ⚠️ ratio приходит ИЗ ФАЙЛА — то есть это недоверенное число: файл могли поправить руками или
  // он мог побиться. Без зажима панель уехала бы за край окна.
  const restored = restore([{ type: 'split-pair', leftUrl: 'https://l.ru', rightUrl: 'https://r.ru', ratio: 0.99 }]);
  check('слишком большой ratio из файла зажимается', restored[0].ratio, 0.8);
  const restored2 = restore([{ type: 'split-pair', leftUrl: 'https://l.ru', rightUrl: 'https://r.ru', ratio: -3 }]);
  check('отрицательный ratio из файла зажимается', restored2[0].ratio, 0.2);
}

console.log('\n— группы —');
{
  const world = makeWorld({ a: tab('https://a.ru'), b: tab('https://b.ru') });
  const nodes = [{
    type: 'group', id: 'g1', label: 'Работа', color: 'blue', collapsed: true,
    children: [{ type: 'single', tabId: 'a' }, { type: 'single', tabId: 'b' }],
  }];
  const saved = serializeNodes(nodes, world);
  check('группа переживает круг целиком', restoreWithUrls(saved), savedShape(saved));
  check('вкладки внутри группы посчитаны', countSavedTabs(saved), 2);
}
{
  // Все вкладки группы приватные — после рестарта осталась бы пустая полоса без содержимого.
  const world = makeWorld({ a: tab('https://a.ru', { savable: false }) });
  const saved = serializeNodes([{
    type: 'group', id: 'g1', label: 'Пустая', color: null, collapsed: false,
    children: [{ type: 'single', tabId: 'a' }],
  }], world);
  check('опустевшая группа в сессию не идёт', saved, []);
}
{
  const world = makeWorld({ a: tab('https://a.ru'), l: tab('https://l.ru'), r: tab('https://r.ru') });
  const nodes = [{
    type: 'group', id: 'g1', label: 'Внешняя', color: 'red', collapsed: false,
    children: [
      { type: 'single', tabId: 'a' },
      { type: 'group', id: 'g2', label: 'Внутренняя', color: null, collapsed: true,
        children: [{ type: 'split-pair', leftTabId: 'l', rightTabId: 'r', ratio: 0.6 }] },
    ],
  }];
  const saved = serializeNodes(nodes, world);
  check('вложенная группа с парой переживает круг', restoreWithUrls(saved), savedShape(saved));
  check('пара внутри вложенной группы найдена', collectSplitPairs(restore(saved)).length, 1);
}

console.log('\n— одинаковые адреса —');
{
  // ⚠️ Две вкладки одного адреса — обычное дело (две почты, два документа). Очередь url → [id]
  // обязана раздать РАЗНЫЕ id по порядку, иначе обе половины дерева укажут на одну вкладку.
  const world = makeWorld({ a: tab('https://a.ru'), b: tab('https://a.ru'), c: tab('https://a.ru') });
  const nodes = [{ type: 'single', tabId: 'a' }, { type: 'single', tabId: 'b' }, { type: 'single', tabId: 'c' }];
  const saved = serializeNodes(nodes, world);
  const tree = restore(saved);
  check('три вкладки одного адреса получили разные id', tree.map((n) => n.tabId), ['t1', 't2', 't3']);
}
{
  // Тот же адрес по обе стороны пары — половины обязаны быть разными вкладками.
  const tree = restore([{ type: 'split-pair', leftUrl: 'https://a.ru', rightUrl: 'https://a.ru', ratio: 0.5 }]);
  check('половины пары с одним адресом — разные вкладки', [tree[0].leftTabId, tree[0].rightTabId], ['t1', 't2']);
}

console.log('\n— инвариант «ничего не потеряли» —');
{
  // Тот самый счёт, по которому TabManager решает, сохранять ли сессию вообще: если сериализовано
  // не столько вкладок, сколько сохраняемых в tabMap, автосейв отменяется целиком.
  const world = makeWorld({
    a: tab('https://a.ru'), b: tab('https://b.ru'), l: tab('https://l.ru'), r: tab('https://r.ru'),
    g1: tab('https://g1.ru'), priv: tab('https://p.ru', { savable: false }),
  });
  const nodes = [
    { type: 'single', tabId: 'a' },
    { type: 'split-pair', leftTabId: 'l', rightTabId: 'r', ratio: 0.5 },
    { type: 'group', id: 'g', label: 'Г', color: null, collapsed: false,
      children: [{ type: 'single', tabId: 'g1' }, { type: 'single', tabId: 'priv' }] },
    { type: 'single', tabId: 'b' },
  ];
  const saved = serializeNodes(nodes, world);
  check('счётчик равен числу сохраняемых вкладок', countSavedTabs(saved), 5);
  check('всё дерево переживает круг', restoreWithUrls(saved), savedShape(saved));
}

console.log('\n— пары для split-состояния —');
{
  const nodes = restore([
    { type: 'split-pair', leftUrl: 'https://l1.ru', rightUrl: 'https://r1.ru', ratio: 0.3 },
    { type: 'group', id: 'g', label: 'Г', color: null, collapsed: false,
      children: [{ type: 'split-pair', leftUrl: 'https://l2.ru', rightUrl: 'https://r2.ru', ratio: 0.7 }] },
  ]);
  const pairs = collectSplitPairs(nodes);
  check('найдены ОБЕ пары, включая вложенную в группу', pairs.length, 2);
  check('ratio каждой пары свой', pairs.map((p) => p.ratio), [0.3, 0.7]);
}

console.log('\n— профиль вкладки —');
{
  // ⚠️ Поле НЕОБЯЗАТЕЛЬНОЕ и добавлено БЕЗ смены версии формата — как title/faviconData до него.
  // Цена ошибки здесь — вкладки людей, поэтому проверяются обе стороны: и что профиль доезжает,
  // и что файл БЕЗ профиля читается по-прежнему.
  const world = makeWorld({
    a: tab('https://work.ru', { profileId: 'pwork' }),
    b: tab('https://home.ru'),
  });
  const saved = serializeNodes([{ type: 'single', tabId: 'a' }, { type: 'single', tabId: 'b' }], world);
  check('профиль сохранён у той вкладки, у которой он есть', saved[0].profileId, 'pwork');
  // ⚠️ У основного профиля поля НЕТ вовсе: это умолчание при чтении, и писать его в каждую
  // строку значило бы раздувать сессию ради нулевой информации.
  check('у вкладки без профиля поля нет', 'profileId' in saved[1], false);
  check('дерево от этого не изменилось', restoreWithUrls(saved), savedShape(saved));
  check('счётчик сходится', countSavedTabs(saved), 2);

  // Файл, записанный ДО появления профилей, обязан читаться как раньше.
  const old = [{ type: 'single', url: 'https://old.ru', title: 'Старая' }];
  check('старый файл читается', restore(old).length, 1);
}

console.log('\n— пустая сессия —');
{
  check('пустое дерево сохраняется пустым', serializeNodes([], makeWorld({})), []);
  check('пустое восстанавливается пустым', restore([]), []);
  check('счётчик пустого — ноль', countSavedTabs([]), 0);
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
