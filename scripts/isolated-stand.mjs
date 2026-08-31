// Стенд изолированного профиля: свой --user-data-dir, эхо-сервер, CDP, убийство дерева процессов.
//
// Зачем. Волна 1 аудита (утечки VPN/WebRTC/инкогнито) не проверяется чтением кода. smoke-test.mjs
// и check-dom.mjs открывают БОЕВОЙ userData — после серии замеров это уже стёрло холсты и вешало
// single-instance lock. Этот модуль — единственная дверь для живых проверок: временная папка,
// эхо, CDP, taskkill /T.
//
//   npm run stand           — самопроверка (поднять, открыть эхо, снять, выйти кодом)
//   npm run stand -- --keep — оставить профиль в %TEMP% для отладки
//
// Импорт из будущих прогонов волны 1:
//   import { withStand, echoUrl } from './isolated-stand.mjs'
//
// ⚠️ Не класть в npm test: поднимает Electron, секунды, не чистая логика.
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export { wait };

export function realUserDataDir() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA ?? '', 'oblako-browser');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'oblako-browser');
  return path.join(os.homedir(), '.config', 'oblako-browser');
}

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

export function killTree(pid) {
  if (pid == null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try { process.kill(pid, 'SIGKILL'); } catch { /* уже мёртв */ }
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

async function findTarget(port, pred, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const t = (await cdpGet(port, '/json/list')).find(pred);
      if (t?.webSocketDebuggerUrl) return t;
    } catch { /* CDP ещё не слушает */ }
    await wait(500);
  }
  return null;
}

export function connectCdp(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  const ready = new Promise((ok, fail) => {
    ws.addEventListener('open', ok);
    ws.addEventListener('error', () => fail(new Error('CDP: соединение не открылось')));
  });
  const send = (method, params = {}) => new Promise((ok) => {
    const my = ++id;
    pending.set(my, ok);
    ws.send(JSON.stringify({ id: my, method, params }));
  });
  const evaluate = async (expr, ms = 20000) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: ms });
    if (r.result?.exceptionDetails) {
      throw new Error(String(r.result.exceptionDetails?.exception?.description ?? 'ошибка в renderer').slice(0, 240));
    }
    return r.result?.result?.value;
  };
  return { send, ready, evaluate, close: () => ws.close() };
}

function startEcho(port) {
  /** @type {{ method: string, url: string, ip: string, ua: string, cookie: string, at: number }[]} */
  const hits = [];
  const page = `<!doctype html><meta charset="utf-8"><title>oblako-echo</title>
<pre id="out">…</pre>
<script>
fetch('/echo').then(r=>r.json()).then(j=>{document.getElementById('out').textContent=JSON.stringify(j,null,2)});
</script>`;
  const webrtcPage = `<!doctype html><meta charset="utf-8"><title>oblako-webrtc</title>
<pre id="out">gathering</pre>
<script>
(async () => {
  const collect = (iceServers, ms) => new Promise((ok) => {
    const pc = new RTCPeerConnection({ iceServers });
    const cands = [];
    pc.onicecandidate = (e) => { if (e.candidate?.candidate) cands.push(e.candidate.candidate); };
    pc.onicegatheringstatechange = () => { if (pc.iceGatheringState === 'complete') { pc.close(); ok(cands); } };
    pc.createDataChannel('x');
    pc.createOffer().then((o) => pc.setLocalDescription(o));
    setTimeout(() => { try { pc.close(); } catch {} ok(cands); }, ms);
  });
  // Без STUN — только host (LAN). STUN к Google не зовём: сам запрос уже светит IP чужому серверу.
  const host = await collect([], 2500);
  window.__ice = { host };
  document.getElementById('out').textContent = JSON.stringify(window.__ice, null, 2);
  document.title = 'ice-ready';
})();
</script>`;
  const server = http.createServer((req, res) => {
    const raw = req.url ?? '/';
    const u = new URL(raw, 'http://127.0.0.1');
    const pathname = u.pathname;
    const ip = req.socket.remoteAddress ?? '';
    const ua = String(req.headers['user-agent'] ?? '');
    const cookie = String(req.headers.cookie ?? '');
    hits.push({ method: req.method ?? 'GET', url: raw, ip, ua, cookie, at: Date.now() });
    if (hits.length > 120) hits.shift();

    const json = (obj, extra = {}) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...extra });
      res.end(JSON.stringify(obj));
    };
    const html = (body) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    };

    if (pathname === '/echo') {
      json({ ip, ua, url: raw, method: req.method, via: 'loopback-echo' });
      return;
    }
    if (pathname === '/show-cookie') {
      json({ cookie });
      return;
    }
    if (pathname === '/set-cookie') {
      const name = u.searchParams.get('name') || 'oblako_stand';
      const value = u.searchParams.get('value') || '1';
      json({ set: name }, { 'Set-Cookie': `${name}=${encodeURIComponent(value)}; Path=/` });
      return;
    }
    if (pathname === '/copy') {
      const text = u.searchParams.get('text') || 'copy-me';
      const safe = text.replace(/[<&]/g, (c) => (c === '<' ? '&lt;' : '&amp;'));
      html(`<!doctype html><meta charset="utf-8"><title>copying</title>
<textarea id="t">${safe}</textarea>
<script>
const t = document.getElementById('t');
t.focus(); t.select();
document.execCommand('copy');
document.title = 'copied';
</script>`);
      return;
    }
    if (pathname === '/webrtc') {
      html(webrtcPage);
      return;
    }
    html(page);
  });
  const ready = new Promise((ok) => server.listen(port, '127.0.0.1', ok));
  return {
    hits,
    ready,
    url: (p = '/') => `http://127.0.0.1:${port}${p}`,
    close: () => new Promise((ok) => server.close(ok)),
  };
}

function seedProfile(dir) {
  fs.mkdirSync(dir, { recursive: true });
  // Без этого первый запуск поднимет онбординг и createTab в хроме не дойдёт до человека.
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ importOffered: true }, null, 2), 'utf8');
}

function assertSafeProfile(dir) {
  const real = path.resolve(realUserDataDir());
  const stand = path.resolve(dir);
  const tmp = path.resolve(os.tmpdir());
  if (!stand.startsWith(tmp + path.sep) && stand !== tmp) {
    throw new Error(`профиль стенда обязан быть в os.tmpdir(): ${stand}`);
  }
  if (stand === real || stand.startsWith(real + path.sep) || real.startsWith(stand + path.sep)) {
    throw new Error(`профиль стенда совпал с боевым userData: ${stand}`);
  }
}

/**
 * Поднимает эхо + Electron на временном профиле. fn(ctx) — тело проверки.
 * Всегда снимает дерево процессов и (без keep) папку профиля.
 */
export async function withStand(fn, opts = {}) {
  const keep = opts.keep === true;
  const mainJs = path.join(ROOT, 'dist-electron', 'electron', 'main.js');
  const indexHtml = path.join(ROOT, 'dist', 'index.html');
  if (!fs.existsSync(mainJs) || !fs.existsSync(indexHtml)) {
    throw new Error('нет прод-сборки (dist + dist-electron). Соберите: npm run build');
  }
  if (!fs.existsSync(ELECTRON)) {
    throw new Error(`нет бинарника Electron: ${ELECTRON}`);
  }

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'oblako-stand-'));
  assertSafeProfile(profile);
  seedProfile(profile);

  const echoPort = await freePort();
  const echo = startEcho(echoPort);
  await echo.ready;

  // ⚠️ Порт CDP и дочерний процесс — ПЕРЕМЕННЫЕ, а не константы: ctx.restart() поднимает
  // приложение заново на том же профиле, и старый порт к этому моменту может быть ещё не отпущен
  // ядром. Каждый запуск берёт свободный порт заново.
  let cdpPort = 0;
  let inspectPort = 0;
  let child = null;
  let chrome = null;
  let main = null;
  const appLog = [];

  // ⚠️ Окно в MAIN-процесс: с ним видно то, чего из renderer не видно в принципе, — например,
  // что обработчик IPC действительно зарегистрирован (ipc-wiring-drive.mjs). По умолчанию
  // выключено: лишний отладочный порт нужен ровно одной проверке из семи.
  const wantMain = opts.main === true;

  async function launch() {
    cdpPort = await freePort();
    if (wantMain) inspectPort = await freePort();
    child = spawn(
      ELECTRON,
      [
        ...(wantMain ? [`--inspect=${inspectPort}`] : []),
        `--remote-debugging-port=${cdpPort}`,
        `--user-data-dir=${profile}`,
        ROOT,
      ],
      { env: { ...process.env, NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    child.stdout?.on('data', (d) => appLog.push(d.toString()));
    child.stderr?.on('data', (d) => appLog.push(d.toString()));

    const chromeT = await findTarget(cdpPort, (t) => t.url?.includes('index.html'));
    if (!chromeT) {
      const tail = appLog.join('').slice(-800);
      throw new Error(`слой хрома не поднялся за отведённое время.${tail ? `\nлог:\n${tail}` : ''}`);
    }
    chrome = connectCdp(chromeT);
    await chrome.ready;

    if (wantMain) {
      const mainT = await findTarget(inspectPort, (t) => t.type === 'node');
      if (!mainT) throw new Error('инспектор main-процесса не поднялся');
      main = connectCdp(mainT);
      await main.ready;
    }
    return chrome;
  }

  const stop = async () => {
    killTree(child?.pid);
    await echo.close();
    await wait(400);
    if (!keep) {
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* занято антивирусом — не трогаем боевой */ }
    }
  };

  try {
    await launch();
    const ctx = {
      profile,
      realUserData: realUserDataDir(),
      echo,
      echoUrl: echo.url,
      appLog,
      keep,
      get cdpPort() { return cdpPort; },
      get chrome() { return chrome; },
      /** CDP к MAIN-процессу. null, если стенд поднят без `{ main: true }`. */
      get main() { return main; },
      /**
       * Выражение в контексте main-процесса.
       * ⚠️ `require` там НЕ определён (контекст — внутренний bootstrap Electron,
       * `electron/js2c/browser_init`), поэтому единственный рабочий путь к модулям приложения
       * идёт через `process.mainModule.require`. Проверено разведкой на Electron 42.
       */
      evalMain: (expr) => {
        if (!main) throw new Error('стенд поднят без { main: true } — окна в main-процесс нет');
        return main.evaluate(expr);
      },
      findTarget: (pred, tries) => findTarget(cdpPort, pred, tries),
      /**
       * Перезапуск приложения НА ТОМ ЖЕ ПРОФИЛЕ — то, ради чего вообще существует проверка круга
       * сессии: снимок должен доехать до диска и подняться обратно.
       *
       * ⚠️ Дерево процессов снимается taskkill /F, то есть окно НЕ закрывается по-человечески и
       * `win.on('close')` не срабатывает. Значит, полагаться приходится на отложенный автосейв
       * (SessionManager, DEBOUNCE_MS = 1500). Пауза по умолчанию с запасом вдвое: без неё
       * проверка ловила бы не «сессия не восстановилась», а «сессия не успела сохраниться» —
       * самый обидный вид красного.
       */
      restart: async (settleMs = 3000) => {
        await wait(settleMs);
        killTree(child?.pid);
        // Порт CDP и single-instance lock отпускаются не мгновенно; без паузы новый запуск
        // видит замок занятым и молча выходит с нулём (разбор — в CLAUDE.md).
        await wait(1500);
        return launch();
      },
    };
    return await fn(ctx);
  } finally {
    await stop();
  }
}

async function selfCheck() {
  const KEEP = process.argv.includes('--keep');
  let passed = 0;
  let failed = 0;
  const check = (what, ok, detail = '') => {
    if (ok) passed++; else failed++;
    console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}${detail ? `\n         ${detail}` : ''}`);
  };

  console.log('\nСтенд изолированного профиля\n');
  const result = await withStand(async (ctx) => {
    check('профиль в os.tmpdir(), не в APPDATA', ctx.profile.startsWith(path.resolve(os.tmpdir())));
    check('профиль ≠ боевой userData', path.resolve(ctx.profile) !== path.resolve(ctx.realUserData));
    check('CDP видит слой хрома', true);

    const pageUrl = ctx.echoUrl('/page');
    await ctx.chrome.evaluate(
      `window.oblako.createTab(${JSON.stringify(pageUrl)}).then(function(){return 1;})`,
      25000,
    );

    let pageHit = false;
    let echoHit = null;
    for (let i = 0; i < 40; i++) {
      pageHit = ctx.echo.hits.some((h) => h.url.startsWith('/page') || h.url === '/');
      echoHit = ctx.echo.hits.find((h) => h.url.split('?')[0] === '/echo') ?? null;
      if (pageHit && echoHit) break;
      await wait(250);
    }
    check('гость открыл страницу эха', pageHit, pageHit ? '' : `хиты: ${JSON.stringify(ctx.echo.hits)}`);
    check(
      'fetch /echo пришёл с loopback',
      !!echoHit && (echoHit.ip === '127.0.0.1' || echoHit.ip === '::1' || echoHit.ip === '::ffff:127.0.0.1'),
      echoHit ? `ip=${echoHit.ip}` : 'хита /echo нет',
    );
    return ctx.profile;
  }, { keep: KEEP });

  if (!KEEP) {
    check('профиль стенда снят после прогона', !fs.existsSync(result));
  } else {
    console.log(`  keep  профиль оставлен: ${result}`);
  }

  console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
  process.exit(failed === 0 ? 0 : 1);
}

const invoked = process.argv[1] ? path.resolve(process.argv[1]) : '';
const self = path.resolve(fileURLToPath(import.meta.url));
if (invoked && path.normalize(invoked) === path.normalize(self)) {
  selfCheck().catch((e) => {
    console.error('\nСтенд упал:', e?.message ?? e);
    process.exit(1);
  });
}
