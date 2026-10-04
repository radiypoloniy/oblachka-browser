// Отмена выхода не должна выключать сервисы или стирать данные; повторный выход не дублирует работу.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerAppShutdown } from '../electron/AppShutdown.ts';

function fakeApp() {
  const app = new EventEmitter();
  app.veto = false;
  app.exits = 0;
  app.quit = () => {
    const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    app.emit('before-quit', event);
    if (app.veto || event.defaultPrevented) return;
    app.emit('will-quit', event);
    if (!event.defaultPrevented) app.exits++;
  };
  return app;
}
const tick = () => new Promise(resolve => setImmediate(resolve));
let passed = 0;
const check = (title, fn) => { fn(); passed++; console.log('  ok   ' + title); };

const app = fakeApp();
const calls = [];
let finishStop;
const stopped = new Promise(resolve => { finishStop = resolve; });
const controller = registerAppShutdown(app, {
  saveSession: () => calls.push('save'),
  stopServices: async () => { calls.push('stop'); await stopped; },
  clearExitData: async () => { calls.push('clear'); },
});
app.veto = true;
app.quit();
check('отмена закрытия сохраняет runtime и данные', () => {
  assert.deepEqual(calls, ['save']);
  assert.equal(controller.isShuttingDown(), false);
  assert.equal(app.exits, 0);
});
app.veto = false;
app.quit();
app.quit();
check('подтверждённый выход ждёт остановки, повторный не дублирует её', () => {
  assert.equal(controller.isShuttingDown(), true);
  assert.equal(calls.filter(x => x === 'stop').length, 1);
  assert.equal(calls.includes('clear'), false);
  assert.equal(app.exits, 0);
});
finishStop();
await tick();
check('очистка после остановки, затем ровно одно завершение', () => {
  assert.equal(calls.filter(x => x === 'clear').length, 1);
  assert.ok(calls.indexOf('stop') < calls.indexOf('clear'));
  assert.equal(app.exits, 1);
});

const failedApp = fakeApp();
const errors = [];
const warn = console.warn;
console.warn = (...args) => errors.push(args);
try {
  registerAppShutdown(failedApp, {
    saveSession: () => {},
    stopServices: async () => { throw Error('stop-test'); },
    clearExitData: async () => { throw Error('clear-test'); },
  });
  failedApp.quit();
  await tick();
  check('ошибки остановки и очистки не оставляют приложение зависшим', () => {
    assert.equal(errors.length, 2);
    assert.equal(failedApp.exits, 1);
  });
} finally {
  console.warn = warn;
}
console.log(`Итого: ${passed} прошло, 0 не прошло`);
