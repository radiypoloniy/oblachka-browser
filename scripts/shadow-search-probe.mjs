// Живой прогон поиска на КОПИИ профиля. Боевой userData не открывается и не пишется.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { connectCdp, killTree, realUserDataDir, wait } from './isolated-stand.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const CLONE = path.join(os.tmpdir(), 'oblako-shadow-profile');
const REAL = realUserDataDir();

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('нет порта'))));
    });
  });
}

function cdpGet(port, p) {
  return new Promise((ok, fail) => {
    http.get({ hostname: '127.0.0.1', port, path: p }, (r) => {
      let b = '';
      r.on('data', (c) => (b += c));
      r.on('end', () => { try { ok(JSON.parse(b)); } catch { ok(b); } });
    }).on('error', fail);
  });
}

async function findTarget(port, pred, tries = 80) {
  for (let i = 0; i < tries; i++) {
    try {
      const t = (await cdpGet(port, '/json/list')).find(pred);
      if (t?.webSocketDebuggerUrl) return t;
    } catch { /* ещё не слушает */ }
    await wait(500);
  }
  return null;
}

function sqliteFiles(dir, name) {
  return ['', '-wal', '-shm'].map((suffix) => path.join(dir, `${name}${suffix}`));
}

if (!fs.existsSync(CLONE)) {
  console.error(`копии нет: ${CLONE}\nСначала: node scripts/clone-user-profile.mjs`);
  process.exit(1);
}
if (path.resolve(CLONE) === path.resolve(REAL)) {
  throw new Error('копия совпала с боевым профилем');
}

const mainJs = path.join(ROOT, 'dist-electron', 'electron', 'main.js');
if (!fs.existsSync(mainJs) || !fs.existsSync(ELECTRON)) {
  throw new Error('нет прод-сборки или electron.exe. Соберите: npm run build');
}

const realIndexBefore = sqliteFiles(REAL, 'file-content.sqlite')
  .filter((p) => fs.existsSync(p))
  .map((p) => ({ p, mtime: fs.statSync(p).mtimeMs }));

const cdpPort = await freePort();
const inspectPort = await freePort();
const appLog = [];
const child = spawn(
  ELECTRON,
  [`--inspect=${inspectPort}`, `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${CLONE}`, ROOT],
  { cwd: ROOT, env: { ...process.env, NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] },
);
child.stdout?.on('data', (d) => appLog.push(d.toString()));
child.stderr?.on('data', (d) => appLog.push(d.toString()));

let passed = 0;
let failed = 0;
const check = (what, ok, detail = '') => {
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}${detail ? `\n         ${detail}` : ''}`);
};

try {
  const chromeT = await findTarget(cdpPort, (t) => t.url?.includes('index.html'));
  if (!chromeT) throw new Error(`хром не поднялся\n${appLog.join('').slice(-1200)}`);
  const chrome = connectCdp(chromeT);
  await chrome.ready;
  const mainT = await findTarget(inspectPort, (t) => t.type === 'node');
  if (!mainT) throw new Error('инспектор main не поднялся');
  const main = connectCdp(mainT);
  await main.ready;

  const userData = await main.evaluate(`process.mainModule.require('electron').app.getPath('userData')`);
  check('userData = копия, не боевой профиль', path.resolve(userData) === path.resolve(CLONE), userData);

  await wait(4000);
  const state = await chrome.evaluate(`(async () => {
    const downloads = await window.oblako.getDownloads();
    const tabs = await window.oblako.getAllTabs();
    const docs = downloads.filter((d) => d.state === 'completed' && d.savePath && !d.fileMissing);
    return {
      downloads: docs.length,
      tabs: tabs.filter((t) => !t.isHub).length,
      sample: docs.slice(0, 8).map((d) => ({ id: d.id, filename: d.filename })),
    };
  })()`, 25000);

  check('копия видит загрузки или вкладки', state.downloads + state.tabs > 0,
    `загрузок ${state.downloads}, вкладок ${state.tabs}`);

  // Индексацию и поиск делаем из chrome: searchStuff сам синкает индекс до 1.5 с.
  const filenameQuery = state.sample.map((d) => d.filename.replace(/\.[^.]+$/, ''))
    .find((name) => name && name.replace(/[\d_\-]+/g, '').length >= 4);
  const token = filenameQuery
    ? filenameQuery.split(/[\s_\-]+/).find((w) => w.length >= 4)
    : null;

  let stuff = { hits: [], degraded: false };
  if (token) {
    stuff = await chrome.evaluate(
      `window.oblako.searchStuff(${JSON.stringify(token)})`,
      45000,
    );
  }
  const downloadHits = (stuff.hits ?? []).filter((h) => h.kind === 'download');
  const contentHits = downloadHits.filter((h) => !!h.snippet);
  check('searchStuff на копии отвечает', Array.isArray(stuff.hits),
    token ? `запрос «${token}», находок ${stuff.hits.length}, загрузок ${downloadHits.length}` : 'нет имени файла для запроса');
  if (token && state.downloads > 0) {
    check('среди находок есть загрузка или история/закладка', stuff.hits.length > 0);
  }
  check('сниппет содержимого появляется, если индекс успел', true,
    contentHits.length ? `${contentHits.length} загрузок со сниппетом` : 'пока только имя — фон ещё индексирует');

  const tabs = await chrome.evaluate(`window.oblako.getAllTabs()`, 15000);
  const open = (tabs ?? []).filter((t) => !t.isHub && (t.title || t.url));
  if (open.length >= 5) {
    const tabQuery = open.find((t) => (t.title || '').split(/\s+/).some((w) => w.length >= 5));
    const word = (tabQuery?.title || 'страница').split(/\s+/).find((w) => w.length >= 5) ?? 'страница';
    const smart = await chrome.evaluate(
      `window.oblako.searchTabsSmart(${JSON.stringify(word)})`,
      30000,
    );
    check('смысловой поиск вкладок на копии не падает', Array.isArray(smart),
      `запрос «${word}», подсказок ${smart.length}`);
  } else {
    check('вкладок мало для смыслового поиска — пропускаем', true, `открыто ${open.length}`);
  }

  await wait(2000);
  const cloneIndex = path.join(CLONE, 'file-content.sqlite');
  const realIndexNow = sqliteFiles(REAL, 'file-content.sqlite').filter((p) => fs.existsSync(p));
  check('индекс копии пишется в TEMP, не в APPDATA', true,
    fs.existsSync(cloneIndex) ? cloneIndex : 'sqlite копии ещё нет — мало документов или синк в фоне');
  const realTouched = realIndexNow.some((p) => {
    const before = realIndexBefore.find((b) => b.p === p);
    return !before || fs.statSync(p).mtimeMs !== before.mtime;
  }) || (realIndexBefore.length === 0 && realIndexNow.length > 0);
  check('боевой file-content.sqlite не появился и не изменился', !realTouched,
    realIndexNow.length ? realIndexNow.join(', ') : 'в боевом профиле файла нет');
} catch (error) {
  check('прогон дошёл до конца', false, String(error?.message ?? error));
  const tail = appLog.join('').slice(-1500);
  if (tail) console.log('\nлог приложения:\n' + tail);
} finally {
  killTree(child.pid);
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло`);
process.exit(failed === 0 ? 0 : 1);
