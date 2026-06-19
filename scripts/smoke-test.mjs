// Smoke-test: запуск Electron + CDP, список таргетов, скриншот.
// Работает на Node 21+ (встроенный WebSocket) без доп. зависимостей.
import { spawn } from 'node:child_process';
import http from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = resolve(ROOT, 'scripts', 'shots');
mkdirSync(SHOTS, { recursive: true });

const electronBin = resolve(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const CDP_PORT = 19234;
const wait = ms => new Promise(r => setTimeout(r, ms));

// ── 1. Запускаем Electron с CDP ──
console.log(`Запуск Electron (--remote-debugging-port=${CDP_PORT})…`);
const child = spawn(electronBin, [`--remote-debugging-port=${CDP_PORT}`, ROOT], {
  env: { ...process.env, NODE_ENV: 'production' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stderr.on('data', d => process.stdout.write('[e] ' + d.toString()));
child.on('exit', c => console.log('[e] exit:', c));

await wait(5000); // ждём полной загрузки React-хрома

// ── 2. Список CDP-таргетов ──
const cdpGet = path => new Promise((ok, fail) => {
  http.get({ hostname: '127.0.0.1', port: CDP_PORT, path }, res => {
    let b = '';
    res.on('data', c => b += c);
    res.on('end', () => { try { ok(JSON.parse(b)); } catch { ok(b); } });
  }).on('error', fail);
});

let targets;
try {
  targets = await cdpGet('/json/list');
} catch (e) {
  console.error('\nCDP недоступен:', e.message);
  child.kill(); process.exit(1);
}

console.log('\n── CDP targets ──');
for (const t of targets) {
  console.log(`  [${t.type}] "${t.title}" ${t.url}`);
}

// Выбираем chrome-слой (index.html или localhost) или первый не-devtools
const pageTarget = targets.find(t =>
  t.url && (t.url.includes('index.html') || t.url.includes('localhost'))
) ?? targets.find(t => !t.url?.startsWith('devtools://'));

if (!pageTarget) {
  console.log('\nСтраница не найдена в таргетах. Electron закрыт.');
  child.kill(); process.exit(1);
}
console.log(`\nВыбран: [${pageTarget.type}] "${pageTarget.title}" ${pageTarget.url}`);

// ── 3. Скриншот через CDP WebSocket ──
if (!pageTarget.webSocketDebuggerUrl) {
  console.log('webSocketDebuggerUrl отсутствует — пропускаем скриншот.');
} else {
  try {
    // Node 21+ имеет глобальный WebSocket
    const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await new Promise((ok, fail) => {
      ws.addEventListener('open', ok);
      ws.addEventListener('error', e => fail(e.error ?? e));
      setTimeout(() => fail(new Error('ws open timeout 5s')), 5000);
    });

    const shotData = await new Promise((ok, fail) => {
      ws.addEventListener('message', e => {
        const msg = JSON.parse(e.data);
        if (msg.id === 1) ok(msg.result?.data ?? null);
      });
      ws.addEventListener('error', e => fail(e.error ?? e));
      ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }));
      setTimeout(() => fail(new Error('screenshot timeout 10s')), 10000);
    });

    ws.close();

    if (shotData) {
      const shotPath = resolve(SHOTS, 'launch.png');
      writeFileSync(shotPath, Buffer.from(shotData, 'base64'));
      console.log('\nСкриншот:', shotPath);
    } else {
      console.log('\nPage.captureScreenshot вернул null/empty.');
    }
  } catch (e) {
    console.log('\nОшибка скриншота:', e.message);
  }
}

child.kill();
console.log('\nОК — Electron завершён.');
