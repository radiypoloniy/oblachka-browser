// Живая проверка круга сессии: открыть вкладки → закрыть окно → запустить снова → те же вкладки.
//
// ⚠️ В `npm test` НЕ входит и не должна: та гоняет чистую логику и статику за секунду, а здесь
// дважды поднимается настоящее приложение. Круг сессии на чистой логике проверяет
// scripts/session-roundtrip-check.mjs (shared/sessionTree.ts) — но он ничего не знает о том,
// доезжает ли снимок до диска и поднимает ли его TabManager на старте. Эта проверка про это.
//
// ⚠️ Профиль СВОЙ, во временной папке: боевые вкладки человека не открываются и не трогаются.
// Дерево процессов снимается taskkill /T — иначе Electron переживает kill и держит
// single-instance lock (разбор — в CLAUDE.md).
//
// Запуск: npm run session-restore-check
import { spawn, spawnSync } from 'node:child_process'
import http from 'node:http'; import net from 'node:net'; import os from 'node:os'
import path from 'node:path'; import fs from 'node:fs'; import { fileURLToPath } from 'node:url'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const kill = (pid) => pid && spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
const port = () => new Promise((ok, no) => { const s = net.createServer(); s.unref(); s.on('error', no); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) }) })
const get = (p, u) => new Promise((ok, no) => http.get({ hostname: '127.0.0.1', port: p, path: u }, (r) => { let b = ''; r.on('data', (c) => b += c); r.on('end', () => ok(JSON.parse(b))) }).on('error', no))
function cdp(url) {
  const ws = new WebSocket(url); let id = 0; const pend = new Map()
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } })
  const ready = new Promise((ok, no) => { ws.addEventListener('open', ok); ws.addEventListener('error', () => no(new Error('cdp'))) })
  const evaluate = (expr) => new Promise((ok) => { const my = ++id; pend.set(my, (m) => ok(m.result?.result?.value)); ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } })) })
  return { ready, evaluate, close: () => ws.close() }
}
async function run(profile, action) {
  const p = await port()
  const child = spawn(path.join(ROOT, 'node_modules/electron/dist/electron.exe'),
    [ROOT, `--remote-debugging-port=${p}`, `--user-data-dir=${profile}`],
    { env: { ...process.env, NODE_ENV: 'production' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let target = null
  for (let i = 0; i < 80 && !target; i++) { try { target = (await get(p, '/json/list')).find((x) => x.type === 'page' && String(x.url).includes('oblako-chrome')) } catch {} if (!target) await wait(500) }
  if (!target) { kill(child.pid); throw new Error('хром не поднялся') }
  const c = cdp(target.webSocketDebuggerUrl); await c.ready; await wait(2000)
  const out = await action(c)
  c.close(); await wait(300); kill(child.pid); await wait(1500)
  return out
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'oblako-restore-'))
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ importOffered: true }), 'utf8')
const URLS = ['https://example.com/', 'https://example.org/']
await run(profile, async (c) => { for (const u of URLS) await c.evaluate(`window.oblako.createTab(${JSON.stringify(u)})`); await wait(2500) })
const after = await run(profile, async (c) => c.evaluate('window.oblako.getAllTabs().then((t) => t.map((x) => x.url))'))
console.log('после перезапуска:', JSON.stringify(after))
const ok = URLS.every((u) => (after ?? []).some((x) => String(x).startsWith(u.replace(/\/$/, ''))))
try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
console.log(ok ? 'OK: вкладки восстановились' : 'FAIL: вкладки не восстановились')
process.exit(ok ? 0 : 1)
