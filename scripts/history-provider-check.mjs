// Поиск обязан пользоваться выбранным provider даже без установленной локальной модели.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const filename = path.resolve('dist-electron/electron/TranslationService.js');
const native = createRequire(filename), module = { exports: {} };
let localChecks = 0, calls = 0, queued = 0, kind = 'openai-compatible';
const provider = {
  get connection() { return { kind }; },
  async generate() { calls++; return { out: '0', tokens: 1, stopReason: 'stop' }; },
};
const mocks = {
  './uiText': { uiLanguage: () => 'ru' }, './TranslationConfig': {},
  './ModelRegistry': { getDefault: () => { localChecks++; return null; } },
  './inference/InferenceHost': { onInferenceProcessGone() {} },
  './ai/registry': { modelFor: () => provider }, './ai/FileStore': {},
  './QwenQueue': { withQwenQueue: async fn => { queued++; return fn(); } },
};
vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename,'utf8')}\n})`, { filename })(
  id => Object.hasOwn(mocks, id) ? mocks[id] : native(id), module, module.exports);
const candidates = [{ id: 1, title: 'Проверка', url: 'https://test.invalid', score: 1 }];
assert.deepEqual(await module.exports.rerankHistoryCandidates('проверка', candidates), [0]);
assert.equal(localChecks, 0); assert.equal(queued, 0); assert.equal(calls, 1);
kind = 'local';
assert.deepEqual(await module.exports.rerankHistoryCandidates('проверка', candidates), [0]);
assert.equal(queued, 1);
console.log('ok: внешний поиск не проверяет GGUF; локальный сохраняет общую очередь');
