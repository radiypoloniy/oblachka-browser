// Проверяет реальную ширину сайдбара через CDP.
import { spawn } from 'node:child_process';
import http from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Корень считаем от расположения скрипта, как в smoke-test.mjs/diag-hub-shadow.mjs —
// абсолютный путь конкретной машины сюда прописывать нельзя (утекает имя пользователя).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CDP_PORT = 19236;

const child = spawn(resolve(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
  ['--remote-debugging-port=' + CDP_PORT, ROOT],
  { env: { ...process.env, NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] }
);
child.stderr.on('data', () => {});

await new Promise(r => setTimeout(r, 5000));

const targets = await new Promise((ok, fail) => {
  http.get({ hostname: '127.0.0.1', port: CDP_PORT, path: '/json/list' }, res => {
    let b = ''; res.on('data', c => b += c); res.on('end', () => ok(JSON.parse(b)));
  }).on('error', fail);
});

const t = targets.find(t => t.url.includes('index.html'));
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((ok, fail) => {
  ws.addEventListener('open', ok);
  ws.addEventListener('error', e => fail(e.error ?? e));
  setTimeout(() => fail(new Error('ws open timeout')), 5000);
});

const expr = `(() => {
  const aside = document.querySelector('aside');
  const btns = [...document.querySelectorAll('button')].map(b => b.title).slice(0, 8);
  return JSON.stringify({ offsetWidth: aside?.offsetWidth, styleWidth: aside?.style?.width, buttons: btns });
})()`;

const result = await new Promise((ok, fail) => {
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id === 1) ok(m.result?.result?.value);
  });
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, returnByValue: true } }));
  setTimeout(() => fail(new Error('eval timeout')), 5000);
});

console.log('DOM state:', result);
ws.close();
child.kill();
