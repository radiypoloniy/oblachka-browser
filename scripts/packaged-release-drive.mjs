// Проверяет упакованный win-unpacked на временном профиле: UI, IPC и нативный SQLite сейфа.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { connectCdp, killTree, wait } from './isolated-stand.mjs';

const exe = path.resolve('release/win-unpacked/Oblako.exe');
if (!fs.existsSync(exe)) throw new Error('Упакованного Oblako.exe нет');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'oblako-packaged-'));
const port = await new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});
const child = spawn(exe, [`--user-data-dir=${profile}`, `--remote-debugging-port=${port}`], {
  env: { ...process.env, NODE_ENV: 'production' },
  stdio: 'ignore', windowsHide: true,
});
let cdp;
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    try {
      const rows = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/json/list`, (response) => {
          let body = '';
          response.on('data', (chunk) => { body += chunk; });
          response.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
        }).on('error', reject);
      });
      target = rows.find((row) => row.url?.includes('index.html') && row.webSocketDebuggerUrl);
    } catch { /* приложение ещё запускается */ }
    if (!target) await wait(500);
  }
  if (!target) throw new Error('Упакованный интерфейс не запустился за 30 секунд');
  cdp = connectCdp(target);
  await cdp.ready;
  const result = await cdp.evaluate(`(async () => {
    const api = window.oblako;
    if (!api?.addPassword || !api?.listPasswords) return { bridge: false };
    const added = await api.addPassword({ url: 'https://release-check.example/login',
      username: 'smoke', password: 'temporary-secret', title: 'Release check' });
    const rows = await api.listPasswords();
    return { bridge: true, added, listed: rows.some((row) => row.username === 'smoke') };
  })()`);
  if (!result?.bridge || !result.added || !result.listed) throw new Error(`Упакованный сейф: ${JSON.stringify(result)}`);
  console.log(JSON.stringify(result));
} finally {
  cdp?.close();
  killTree(child.pid);
  await wait(500);
  const tempRoot = path.resolve(os.tmpdir()) + path.sep;
  if (path.resolve(profile).startsWith(tempRoot) && path.basename(profile).startsWith('oblako-packaged-')) {
    fs.rmSync(profile, { recursive: true, force: true });
  }
}
