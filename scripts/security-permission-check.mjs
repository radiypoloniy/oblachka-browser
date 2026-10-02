// Проверяем реальные обработчики с подменёнными ОС и хранилищем, без доступа к профилю.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
function load(name, mocks) {
  const filename = path.join(root, 'dist-electron/electron', name + '.js');
  const nativeRequire = createRequire(filename);
  const module = { exports: {} };
  const run = vm.runInThisContext(`(function(require,module,exports,__dirname){${fs.readFileSync(filename, 'utf8')}\n})`, { filename });
  run(id => Object.hasOwn(mocks, id) ? mocks[id] : nativeRequire(id), module, module.exports, path.dirname(filename));
  return module.exports;
}

const records = new Map();
class FakeDb {
  pragma() {}
  exec() {}
  prepare() {
    return {
      get: (origin, key) => records.has(origin + '|' + key) ? { decision: records.get(origin + '|' + key) } : undefined,
      run: (origin, key, decision) => records.set(origin + '|' + key, decision),
    };
  }
}
const { PermissionManager } = load('PermissionManager', {
  electron: { app: { getPath: () => 'unused-test-profile' } },
  'better-sqlite3': FakeDb,
  './BackgroundWebContents': { isBackgroundWebContents: () => false },
});
const manager = new PermissionManager();
await manager.initialize();
const questions = [];
let requestHandler;
manager.attach({
  setPermissionRequestHandler: fn => { requestHandler = fn; },
  setPermissionCheckHandler: () => {},
}, (req, wcId) => questions.push({ req, wcId }));
const answers = [];
const wc = { id: 1, getURL: () => 'https://example.test' };
requestHandler(wc, 'notifications', value => answers.push(value), {});
requestHandler(wc, 'notifications', value => answers.push(value), {});
assert.equal(questions.length, 1);
manager.respond(questions[0].req.requestId, true, false);
assert.deepEqual(answers, [true, true]);
assert.equal(manager.hintFor('https://example.test'), null);

const first = manager.askOwn('https://example.test', 'external-app:tg', 1);
const duplicate = manager.askOwn('https://example.test', 'external-app:tg', 1);
const otherTab = manager.askOwn('https://example.test', 'external-app:tg', 2);
assert.equal(questions.length, 3);
manager.cancel(questions[1].req.requestId);
assert.deepEqual(await Promise.all([first, duplicate]), [false, false]);
manager.respond(questions[2].req.requestId, true, true);
assert.equal(await otherTab, true);
assert.equal(await manager.askOwn('https://example.test', 'external-app:tg', 2), true);
records.set('https://example.test|external-app', 'granted');
const newScheme = manager.askOwn('https://example.test', 'external-app:bank', 2);
assert.equal(questions.length, 4);
manager.cancel(questions[3].req.requestId);
assert.equal(await newScheme, false);
console.log('ok повторные запросы: ответ, отмена, граница вкладок и схем');

const opened = [];
const external = load('ExternalProtocol', { electron: { shell: { openExternal: async url => opened.push(url) } } });
const scopes = [];
external.setExternalConsentAsk(async (origin, scheme) => { scopes.push([origin, scheme]); return true; });
for (const origin of ['https://example.test', 'http://example.test', 'https://www.example.test', 'https://example.test:8443']) {
  assert.equal(await external.openExternalWithConsent(null, 'tg://resolve', origin, 1), true);
}
assert.equal(new Set(scopes.map(([origin]) => origin)).size, 4);
await external.openExternalWithConsent(null, 'bank://pay', 'https://example.test', 1);
assert.deepEqual(scopes.at(-1), ['https://example.test', 'bank']);
assert.equal(await external.openExternalWithConsent(null, 'tg://resolve', 'file:///secret.html', 1), false);
assert.equal(opened.length, 5);
console.log('ok внешние приложения: точный origin и конкретная схема');

const handlers = new Map();
let authorized = false;
let exportCalls = 0;
let dialogs = 0;
const passwordIpc = load('ipc/passwords', {
  electron: { ipcMain: { handle: (key, fn) => handlers.set(key, fn) }, dialog: { showSaveDialog: async () => { dialogs++; return { canceled: true }; } } },
  '../PasswordAutofillManager': {},
  '../WindowRegistry': { broadcastToChrome: () => {} },
});
passwordIpc.registerPasswordsIpc({
  autofill: {}, passwords: { exportVault: () => { exportCalls++; return 'encrypted'; } },
  ensurePasswordAuth: async () => authorized, winOf: () => ({}),
});
const { IPC } = createRequire(import.meta.url)(path.join(root, 'dist-electron/shared/ipc'));
assert.equal(await handlers.get(IPC.PASSWORDS_EXPORT)({}, 'phrase'), false);
assert.equal(exportCalls, 0);
assert.equal(dialogs, 0);
authorized = true;
await handlers.get(IPC.PASSWORDS_EXPORT)({}, 'phrase');
assert.equal(exportCalls, 1);
assert.equal(dialogs, 1);
console.log('ok отказ авторизации блокирует экспорт до расшифровки и диалога');

const events = [];
const savedPasswords = [];
let canSave = false;
let canFill = true;
const pm = {
  list: () => savedPasswords, generate: () => 'new-secret',
  add: input => {
    events.push('save');
    if (canSave) savedPasswords.push({ ...input, id: savedPasswords.length + 1, origin: new URL(input.url).origin, createdAt: Date.now() });
    return canSave;
  },
};
const tabs = {
  getActiveId: () => 'tab', getActiveWebContents: () => ({ getURL: () => 'https://example.test/login' }),
  sendPasswordFill: () => { events.push('fill'); return canFill; },
};
const autofill = load('PasswordAutofillManager', {
  './WindowRegistry': { contextForWindow: () => ({ tabs }) },
  './PasswordManager': { originOf: url => new URL(url).origin },
});
autofill.init(pm, () => {}, () => {}, () => ({ suggestStrong: true, autofill: true }), async () => true, () => {});
const win = {};
autofill.handleFieldInteraction(win, 'tab', 'https://example.test/login', 'icon', { role: 'new', formKind: 'signup' });
assert.equal(await autofill.handleGenerateAndFill(win), false);
assert.deepEqual(events, ['save']);
assert.equal(savedPasswords.length, 0);
canSave = true;
events.length = 0;
assert.equal(await autofill.handleGenerateAndFill(win), true);
assert.deepEqual(events, ['save', 'fill']);
canFill = false;
assert.equal(await autofill.handleGenerateAndFill(win), false);
assert.equal(savedPasswords.length, 2);
console.log('ok генерация: ошибка записи блокирует подстановку, сохранение предшествует отправке');
