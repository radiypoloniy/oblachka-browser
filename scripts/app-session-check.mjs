// Миграции, резервные копии, отказы записи и политика закрытия — только временные файлы.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AppSessionStore } = require('../dist-electron/electron/AppSessionStore.js');
const { AppSessionCoordinator, windowsToRestore } = require('../dist-electron/electron/AppSessionCoordinator.js');
const { decodeAppSession, trimClosedWindows } = require('../dist-electron/shared/appSession.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oblako-session-check-'));
const source = fs.readFileSync(new URL('../electron/SessionManager.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const module = { exports: {} };
vm.runInNewContext(code, { module, exports: module.exports, require: name => name === 'electron' ? { app: { getPath: () => dir, getVersion: () => 'test' } } : require(name), console, setTimeout, clearTimeout });
const legacy = new module.exports.SessionManager();
const snapshot = (suffix, pinned = false) => ({ pinnedTabs: pinned ? [{ url: `https://example.com/pin-${suffix}` }] : [], nodes: [{ type: 'single', key: suffix, url: `https://example.com/${suffix}`, profileId: 'work' }], activeRef: { type: 'key', key: suffix } });
const window = (id, pinned = false) => ({ id, snapshot: snapshot(id, pinned), bounds: { x: 10, y: 20, width: 1000, height: 700 } });
const store = () => new AppSessionStore(dir, 'test', d => legacy.decode(d));
const file = path.join(dir, 'session-v6.json');
const legacyFile = path.join(dir, 'session.json');
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('  ok   ' + name); };
const quietWarn = console.warn;
console.warn = () => {};
try {
  for (let version = 1; version <= 5; version++) {
    const tab = { url: 'https://example.com/legacy', title: 'Legacy', profileId: 'work' };
    const data = { version, savedAt: 'date', pinnedTabs: [tab], tabs: [tab], nodes: [{ type: 'single', ...tab }], activeTabIndex: 0, activeTabType: 'normal', activeRef: { type: 'url', url: tab.url } };
    const raw = JSON.stringify(data);
    fs.rmSync(file, { force: true });
    fs.rmSync(`${file}.bak`, { force: true });
    fs.writeFileSync(legacyFile, raw);
    const s = store(); const loaded = s.load();
    check(`миграция v${version} и исходник до первой записи`, () => {
      assert.equal(loaded.windows.length, 1);
      assert.equal(loaded.windows[0].snapshot.pinnedTabs[0].profileId, 'work');
      assert.equal(s.save(loaded), true, s.lastError ?? 'save');
      assert.equal(JSON.parse(fs.readFileSync(file)).version, 6);
      assert.equal(fs.readFileSync(legacyFile, 'utf8'), raw);
      assert.ok(fs.readdirSync(dir).filter(n => n.includes('pre-v6')).some(n => fs.readFileSync(path.join(dir, n), 'utf8') === raw));
    });
  }
  const a = { windows: [window('a')], closedWindows: [] };
  const b = { windows: [window('b', true)], closedWindows: [] };
  check('прежняя многооконная v6 импортируется без изменения исходника', () => {
    fs.rmSync(file);
    fs.rmSync(`${file}.bak`, { force: true });
    const raw = JSON.stringify({ version: 6, savedAt: 'date', ...b });
    fs.writeFileSync(legacyFile, raw);
    const imported = store();
    assert.deepEqual(imported.load(), b);
    assert.equal(imported.save(b), true);
    assert.equal(fs.readFileSync(legacyFile, 'utf8'), raw);
  });
  const s = store(); s.load();
  s.save(a); s.save(b);
  check('старый exe не заменяет многооконную сессию и закрепления', () => {
    const before = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(legacyFile, JSON.stringify({ version: 5, savedAt: 'date', pinnedTabs: [], nodes: [], activeRef: { type: 'hub' } }));
    assert.deepEqual(store().load(), b);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  });
  check('при отсутствии основного файла новая резервная копия важнее прежней сессии', () => {
    fs.rmSync(file);
    assert.deepEqual(store().load(), a);
    assert.equal(s.save(a), true);
    assert.equal(s.save(b), true);
  });
  fs.writeFileSync(file, '{corrupt');
  const recovery = store();
  check('битый основной файл восстанавливается из последнего хорошего backup', () => {
    assert.deepEqual(recovery.load(), a);
    assert.equal(recovery.save(a), true);
    assert.ok(fs.readdirSync(dir).some(n => n.includes('.corrupt.') && fs.readFileSync(path.join(dir, n), 'utf8') === '{corrupt'));
  });
  check('отказ rename оставляет основной файл и backup пригодными', () => {
    const before = fs.readFileSync(file, 'utf8');
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => { if (to === file) throw Error('test rename'); return rename(from, to); };
    try { assert.equal(recovery.save(b), false); } finally { fs.renameSync = rename; }
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    assert.deepEqual(store().load(), a);
    assert.ok(decodeAppSession(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8'))));
  });
  check('будущая версия не перезаписывается даже после нескольких сохранений', () => {
    const raw = JSON.stringify({ version: 99, secretNewData: 'retained' });
    fs.writeFileSync(file, raw);
    const future = store(); assert.equal(future.load(), null);
    assert.equal(future.save(a), false); assert.equal(future.save(b), false);
    assert.equal(fs.readFileSync(file, 'utf8'), raw);
    assert.ok(fs.readdirSync(dir).some(n => n.includes('.from-v99.') && fs.readFileSync(path.join(dir, n), 'utf8') === raw));
  });
  check('дубликат windowId и повреждённое дерево отвергаются целиком', () => {
    assert.equal(decodeAppSession({ version: 6, savedAt: 'date', windows: [window('a'), window('a')], closedWindows: [] }), null);
    const invalid = window('broken'); invalid.snapshot.nodes = [{ type: 'unknown' }];
    assert.equal(decodeAppSession({ version: 6, savedAt: 'date', windows: [invalid], closedWindows: [] }), null);
  });
  check('лимит закрытых окон не удаляет закреплённые деревья', () => {
    const closed = Array.from({ length: 30 }, (_, i) => ({ ...window(String(i), i < 3), closedAt: i }));
    const trimmed = trimClosedWindows(closed);
    assert.equal(trimmed.length, 23);
    assert.equal(trimmed.filter(w => w.snapshot.pinnedTabs.length).length, 3);
  });
  const writes = []; const c = new AppSessionCoordinator({ save: snap => { writes.push(structuredClone(snap)); return true; } }, null);
  let aLive = window('a', true), bLive = window('b');
  c.register('a', () => aLive); c.register('b', () => bLive); c.enable(); c.saveNow();
  check('явный выход сохраняет все окна, закрытия не уменьшают захваченный набор', () => {
    c.beginQuit(); c.close('a', aLive); c.close('b', bLive);
    assert.deepEqual(writes.at(-1).windows.map(w => w.id), ['a', 'b']);
    assert.equal(writes.at(-1).closedWindows.length, 0);
  });
  const c2 = new AppSessionCoordinator({ save: snap => { writes.push(structuredClone(snap)); return true; } }, null);
  c2.register('a', () => aLive); c2.register('b', () => bLive); c2.enable();
  c2.beginQuit(); c2.close('a', aLive); c2.cancelQuit(); bLive = window('b2'); bLive.id = 'b'; c2.saveNow();
  check('отмена выхода возобновляет автосейв и сохраняет закрытое закреплённое окно', () => {
    assert.deepEqual(writes.at(-1).windows.map(w => w.id), ['b']);
    assert.deepEqual(windowsToRestore(writes.at(-1)).map(w => w.id), ['b', 'a']);
  });
  c2.close('b', bLive);
  check('последнее обычное окно и ранее закрытое закреплённое возвращаются без дублей', () => {
    const restored = writes.at(-1);
    assert.deepEqual(windowsToRestore(restored).map(w => w.id), ['b', 'a']);
    const next = new AppSessionCoordinator({ save: snap => { writes.push(structuredClone(snap)); return true; } }, restored);
    for (const w of windowsToRestore(restored)) next.register(w.id, () => w);
    next.enable(); next.saveNow();
    assert.equal(writes.at(-1).closedWindows.length, 0);
  });
  check('нарушенный инвариант не затирает общий снимок; приватное окно исключается', () => {
    const c3 = new AppSessionCoordinator({ save: snap => { writes.push(structuredClone(snap)); return true; } }, null);
    c3.register('a', () => aLive); c3.register('private', () => false); c3.enable(); c3.saveNow();
    assert.equal(writes.at(-1).windows.length, 1);
    const count = writes.length; aLive = null;
    assert.equal(c3.saveNow(), false); assert.equal(writes.length, count);
    c3.close('private', false); c3.close('a', null);
  });
} finally {
  console.warn = quietWarn;
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`Итого: ${passed} прошло, 0 не прошло`);
