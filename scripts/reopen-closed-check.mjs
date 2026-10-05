// Порядок восстановления и сохранность истории при отказе создания окна.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { reopenTarget, reopenLastClosed } = require('../dist-electron/electron/window/reopenClosed.js');
const { AppSessionCoordinator } = require('../dist-electron/electron/AppSessionCoordinator.js');
let passed = 0;
const check = (label, fn) => { fn(); passed++; console.log('ok ' + label); };
const saved = (id, closedAt, empty = false) => ({ id, closedAt, snapshot: {
  pinnedTabs: [], nodes: empty ? [] : [{ type: 'single', url: 'https://example.test/' + id }], activeRef: { type: 'hub' },
} });
let stack = [{ url: 'https://example.test/tab', title: 'Tab', closedAt: 20 }];
const tabs = { closedSnapshot: () => stack, reopenLastClosedTab: () => { stack = stack.slice(1); } };
const coordinator = new AppSessionCoordinator({ save: () => true }, { windows: [], closedWindows: [saved('empty', 40, true), saved('window', 30)] });
check('более свежее окно идёт раньше вкладки; старая пустая запись пропускается', () => {
  assert.equal(reopenTarget(tabs, coordinator).saved.id, 'window');
});
check('ошибка создания не съедает окно из истории', () => {
  assert.throws(() => reopenLastClosed(tabs, coordinator, () => { throw Error('create failed'); }));
  assert.equal(reopenTarget(tabs, coordinator).saved.id, 'window');
});
check('окно возвращается один раз, следующее действие возвращает вкладку', () => {
  let restores = 0;
  reopenLastClosed(tabs, coordinator, w => { restores++; coordinator.register(w.id, () => w); });
  assert.equal(restores, 1);
  assert.equal(reopenTarget(tabs, coordinator).kind, 'tab');
  reopenLastClosed(tabs, coordinator, () => { throw Error('duplicate window'); });
  assert.equal(reopenTarget(tabs, coordinator), null);
});
check('более свежая вкладка не восстанавливает старое окно', () => {
  stack = [{ url: 'https://example.test/newer', title: 'Newer', closedAt: 50 }];
  const history = { closedWindows: () => [saved('older', 49)], saveNow: () => true };
  assert.equal(reopenTarget(tabs, history).kind, 'tab');
  reopenLastClosed(tabs, history, () => { throw Error('wrong order'); });
  assert.equal(reopenTarget(tabs, history).kind, 'window');
});
check('без окон работает прежнее восстановление вкладок; пустой стек безопасен', () => {
  stack = [{ url: 'https://example.test/tab', title: 'Tab', closedAt: 60 }];
  reopenLastClosed(tabs, null, () => { throw Error('no window'); });
  reopenLastClosed(tabs, null, () => { throw Error('no window'); });
  assert.equal(reopenTarget(tabs, null), null);
});
console.log(`Итого: ${passed} прошло, 0 не прошло`);
