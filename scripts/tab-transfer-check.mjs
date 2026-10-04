// Отказ переноса должен сохранять оба дерева; одна вкладка не может принять билет дважды.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { detachTab, adoptTab } = require('../dist-electron/electron/tabTransfer.js');
const { moveTab } = require('../dist-electron/electron/window/tabMove.js');

function host(tabs = [], nodes = [], pinned = []) {
  const state = { tabs: new Map(tabs.map(t => [t.id, t])), nodes, pinned,
    errors: new Map(), activeId: tabs[0]?.id ?? 'hub' };
  const attached = new Set(tabs.flatMap(t => t.view ? [t.view] : []));
  const win = { isDestroyed: () => false,
    contentView: { removeChildView: v => attached.delete(v), addChildView: v => attached.add(v) } };
  const h = { window: () => win, state: () => state, canDetach: () => true,
    wire() {}, activate(id) { state.activeId = id; const t = state.tabs.get(id); if (t?.view) attached.add(t.view); },
    changed() { h.changes++; }, markPrivate() {},
    committed(id) { if (state.activeId === id) state.activeId = 'hub'; h.changes++; }, changes: 0 };
  return h;
}
const sleeping = (id) => ({ id, view: null, sleeping: { url: `https://${id}.test`, title: id,
  faviconData: null, faviconUrl: null }, lastActiveAt: 9, profileId: 'work', muted: true, aiTitle: 'saved name' });
const node = id => ({ type: 'single', tabId: id });
let passed = 0;
function test(label, run) { run(); passed++; console.log('ok  ' + label); }

test('закрепление и полная запись сохраняются; билет одноразовый', () => {
  const t = sleeping('pin'); const a = host([t], [], [t]); const b = host();
  const ticket = detachTab(a, t.id);
  assert.equal(a.changes, 0);
  assert.equal(adoptTab(b, ticket), t.id);
  assert.deepEqual(b.state().tabs.get(t.id), t);
  assert.equal(b.state().pinned[0].id, t.id);
  assert.equal(adoptTab(host(), ticket), null);
  ticket.restore(); assert.equal(a.state().tabs.has(t.id), false);
});
test('отказ возвращает группу, её порядок, active и ошибку', () => {
  const t = sleeping('grouped'); const a = host([t], [{ type: 'group', id: 'g', label: 'G', color: 'accent', collapsed: true, children: [node(t.id)] }]);
  const tree = structuredClone(a.state().nodes);
  const error = { type: 'load', code: -1, url: t.sleeping.url, offline: true };
  a.state().errors.set(t.id, error);
  const b = host(); b.wire = () => { throw Error('must not wire sleeping'); };
  b.activate = id => { b.state().activeId = id; if (id === t.id) throw Error('injected activate failure'); };
  const ticket = detachTab(a, t.id);
  assert.equal(adoptTab(b, ticket), null); ticket.restore();
  assert.deepEqual(a.state().nodes, tree);
  assert.equal(a.state().activeId, t.id);
  assert.equal(a.state().errors.get(t.id), error);
  assert.equal(b.state().tabs.size, 0); assert.deepEqual(b.state().nodes, []);
  assert.equal(b.state().activeId, 'hub');
});
test('ошибка создания окна откатывает перенос', () => {
  const t = sleeping('new'); const a = host([t], [node(t.id)]);
  const facade = { detachTabForMove: id => detachTab(a, id) };
  assert.equal(moveTab(facade, t.id, () => { throw Error('injected create failure'); }, () => {}, true), false);
  assert.equal(a.state().tabs.get(t.id), t); assert.deepEqual(a.state().nodes, [node(t.id)]);
});
test('коллизия id и split не меняют приёмник', () => {
  const t = sleeping('collision'); const a = host([t], [node(t.id)]); const b = host([sleeping(t.id)], [node(t.id)]);
  const ticket = detachTab(a, t.id); assert.equal(adoptTab(b, ticket), null); ticket.restore();
  assert.equal(b.state().tabs.size, 1);
  a.canDetach = () => false; assert.equal(detachTab(a, t.id), null);
  assert.equal(a.state().tabs.get(t.id), t);
});
test('мёртвая вью оставляет восстановимый адрес', () => {
  let dead = false;
  const view = { webContents: { isDestroyed: () => dead, getURL: () => 'https://live.test', getTitle: () => 'Live' } };
  const t = { ...sleeping('live'), sleeping: null, view };
  const a = host([t], [node(t.id)]); const ticket = detachTab(a, t.id); dead = true;
  assert.equal(adoptTab(host(), ticket), null); ticket.restore();
  assert.equal(a.state().tabs.get(t.id).view, null);
  assert.equal(a.state().tabs.get(t.id).sleeping.url, 'https://live.test');
});
console.log(`\n${passed} passed, 0 failed`);
