// Проводка per-view IPC: владение после переноса, приватность и источник URL.
// Запуск после сборки: npm test -- tab-guest-signals
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { IPC } = require('../dist-electron/shared/ipc/index.js');
const { wireTabGuestSignals } = require('../dist-electron/electron/tabGuestSignals.js');

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(` ${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) console.log(`       получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

class FakeIpc extends EventEmitter {
  handlers = new Map();
  steps = [];
  removeHandler(channel) { this.steps.push(`remove:${channel}`); this.handlers.delete(channel); }
  handle(channel, fn) { this.steps.push(`handle:${channel}`); this.handlers.set(channel, fn); }
}
const wc = { ipc: new FakeIpc(), getURL: () => 'https://trusted.test/login' };
const calls = [];
let owned = true;
let incognito = false;
const hooks = {
  mine: () => owned,
  isIncognito: () => incognito,
  onPasswordForm: (...args) => calls.push(['form', ...args]),
  onPasswordSubmit: (...args) => calls.push(['submit', ...args]),
  onPasswordFieldAnchor: (...args) => calls.push(['anchor', ...args]),
  onMediaReport: (...args) => calls.push(['media', ...args]),
  onPasswordDismiss: () => calls.push(['dismiss']),
  onAutofillFieldFocus: (...args) => calls.push(['focus', ...args]),
  onAutofillPasteBlob: (...args) => calls.push(['paste', ...args]),
  onPageCopy: (...args) => calls.push(['copy', ...args]),
  onAutofillDismiss: () => calls.push(['autofill-dismiss']),
  mapFields: async (origin, fields) => { calls.push(['map', origin, fields]); return { 0: 'value' }; },
  onAutofillSubmit: (...args) => calls.push(['autofill-submit', ...args]),
};
wireTabGuestSignals(wc, hooks);
check('map-fields сначала снимает старый handler', wc.ipc.steps, [
  `remove:${IPC.AUTOFILL_MAP_FIELDS}`, `handle:${IPC.AUTOFILL_MAP_FIELDS}`,
]);

wc.ipc.emit(IPC.PASSWORDS_FORM_DETECTED, {}, { hasLoginForm: true, hasUsernameField: false, url: 'https://attacker.test/' });
check('URL берётся из WebContents, не из payload', calls.pop(),
  ['form', true, false, 'https://trusted.test/login']);
wc.ipc.emit(IPC.CLIPBOARD_COPIED, {}, { text: 'секрет', title: 'title' });
check('обычная вкладка передаёт копию', calls.pop(),
  ['copy', 'секрет', 'https://trusted.test/login', 'title', { html: '', links: [] }]);
incognito = true;
wc.ipc.emit(IPC.CLIPBOARD_COPIED, {}, { text: 'приватно', title: 'title' });
check('инкогнито не пишет в буфер браузера', calls.length, 0);
incognito = false;

const mapped = await wc.ipc.handlers.get(IPC.AUTOFILL_MAP_FIELDS)({}, { fields: { a: 'b' }, origin: 'https://attacker.test/' });
check('map-fields использует origin страницы', calls.pop(), ['map', 'https://trusted.test', { a: 'b' }]);
check('ответ map-fields сохранён', mapped, { 0: 'value' });
owned = false;
wc.ipc.emit(IPC.PASSWORDS_CREDENTIAL_SUBMITTED, {}, { username: 'u', password: 'p' });
check('старый владелец после переноса не получает пароль', calls.length, 0);
check('старый владелец не отвечает на map-fields', await wc.ipc.handlers.get(IPC.AUTOFILL_MAP_FIELDS)({}, {}), {});

wireTabGuestSignals(wc, { ...hooks, mine: () => true });
wc.ipc.emit(IPC.PASSWORDS_FORM_DETECTED, {}, { hasLoginForm: false, hasUsernameField: true });
check('после передачи вкладки отвечает только новый владелец', calls.splice(0),
  [['form', false, true, 'https://trusted.test/login']]);
check('новый владелец переустановил единственный map-fields handler',
  wc.ipc.steps.slice(-2), [`remove:${IPC.AUTOFILL_MAP_FIELDS}`, `handle:${IPC.AUTOFILL_MAP_FIELDS}`]);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
