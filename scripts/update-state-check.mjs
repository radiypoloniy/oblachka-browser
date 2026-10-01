// Проверяем, что проверки сервера не уничтожают уже скачанное обновление.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../electron/UpdateManager.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
let checks = 0;
let installs = 0;
class FakeUpdater extends EventEmitter {
  async restorePendingUpdate() { this.emit('update-downloaded', { version: '0.8.9' }); return true; }
  checkForUpdates() { checks++; return Promise.resolve(); }
  quitAndInstall() { installs++; }
}
const app = { isPackaged: true, getVersion: () => '0.8.8' };
const module = { exports: {} };
const context = vm.createContext({ module, exports: module.exports, process: { platform: 'win32' },
  setTimeout: () => ({ unref() {} }), setInterval: () => ({ unref() {} }),
  require: name => {
    if (name === 'electron') return { app };
    if (name === 'electron-updater') return {};
    if (name === './updates/WindowsUpdater') return { WindowsUpdater: FakeUpdater };
    throw Error(name);
  },
});
vm.runInContext(code, context);
const manager = new module.exports.UpdateManager();
manager.initialize(() => {});
await Promise.resolve();
await Promise.resolve();
assert.equal(manager.getStatus().kind, 'downloaded');
for (let i = 0; i < 20; i++) manager.check();
assert.equal(checks, 0);
assert.equal(manager.getStatus().kind, 'downloaded');
manager.install();
assert.equal(installs, 1);
console.log('  ok   восстановленное обновление сохраняет готовность после повторных проверок');
console.log('  ok   установка доступна после отложенного решения');
