// Замер GPU/VRAM: упакованный Oblako.exe vs electron.exe из репозитория.
// Свой --user-data-dir в %TEMP%, боевой профиль не открывается.
//   node scripts/llama-gpu-diag.mjs           — оба, если есть win-unpacked
//   node scripts/llama-gpu-diag.mjs --packaged
//   node scripts/llama-gpu-diag.mjs --unpackaged
import { spawn, spawnSync } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function killTree(pid) {
  if (pid == null) return
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = addr && typeof addr === 'object' ? addr.port : 0
      srv.close(() => (port ? resolve(port) : reject(new Error('нет порта'))))
    })
  })
}

function cdpGet(port, p) {
  return new Promise((ok, fail) => {
    http.get({ hostname: '127.0.0.1', port, path: p }, (r) => {
      let b = ''
      r.on('data', (c) => (b += c))
      r.on('end', () => { try { ok(JSON.parse(b)) } catch { ok(b) } })
    }).on('error', fail)
  })
}

function interesting(line) {
  return /\[gen\]|\[inference\]|gpu|vram|vulkan|cuda|инференс|backend/i.test(line)
}

function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  })
  const ready = new Promise((ok, fail) => {
    ws.addEventListener('open', ok)
    ws.addEventListener('error', () => fail(new Error('CDP: нет соединения')))
  })
  const send = (method, params = {}) => new Promise((ok) => {
    const my = ++id
    pending.set(my, ok)
    ws.send(JSON.stringify({ id: my, method, params }))
  })
  const evaluate = async (expr, ms = 90000) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: ms })
    if (r.result?.exceptionDetails) {
      throw new Error(String(r.result.exceptionDetails?.exception?.description ?? 'renderer').slice(0, 400))
    }
    return r.result?.result?.value
  }
  return { send, ready, evaluate, close: () => ws.close() }
}

async function findChrome(port) {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await cdpGet(port, '/json/list')
      const t = list.find((x) =>
        x.type === 'page'
        && (String(x.url).includes('index.html') || String(x.url).includes('oblako-chrome')))
      if (t?.webSocketDebuggerUrl) return t
    } catch { /* CDP ещё нет */ }
    await wait(500)
  }
  return null
}

async function runOnce(label, exe, extraArgs) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'oblako-ai-diag-'))
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ importOffered: true }, null, 2), 'utf8')
  const cdpPort = await freePort()
  const args = [`--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, ...extraArgs]
  console.log(`\n======== ${label} ========`)
  console.log('exe:', exe)

  const child = spawn(exe, args, {
    env: { ...process.env, NODE_ENV: 'production', ELECTRON_ENABLE_LOGGING: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const appLog = []
  const onChunk = (d) => {
    const s = d.toString()
    appLog.push(s)
    for (const line of s.split(/\r?\n/)) {
      if (line && interesting(line)) console.log('LOG', line.slice(0, 400))
    }
  }
  child.stdout?.on('data', onChunk)
  child.stderr?.on('data', onChunk)

  let result = { label, ok: false }
  try {
    const target = await findChrome(cdpPort)
    if (!target) {
      result.error = 'хром не поднялся'
      return result
    }
    const cdp = connectCdp(target.webSocketDebuggerUrl)
    await cdp.ready
    await wait(1500)
    const hw = await cdp.evaluate('window.oblako.getHardwareSnapshot()', 90000)
    const visible = await cdp.evaluate(
      `window.oblako.getModelCatalog().then((c) => c.filter((e) => e.visibleByDefault).map((e) => e.model.id))`,
      20000,
    )
    result = { label, ok: true, hardware: hw, visible }
    console.log('hardware:', JSON.stringify(hw))
    console.log('visible:', visible)
    cdp.close()
  } catch (e) {
    result.error = String(e?.message ?? e)
    console.log('ERROR', result.error)
  } finally {
    killTree(child.pid)
    await wait(400)
    try { fs.rmSync(profile, { recursive: true, force: true }) } catch { /* антивирус */ }
  }
  return result
}

const wantPackaged = !process.argv.includes('--unpackaged')
const wantUnpackaged = !process.argv.includes('--packaged')
const packaged = path.join(ROOT, 'release', 'win-unpacked', 'Oblako.exe')
const electron = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const out = []
if (wantPackaged) {
  if (!fs.existsSync(packaged)) console.log('нет', packaged)
  else out.push(await runOnce('PACKAGED', packaged, []))
}
if (wantUnpackaged) {
  out.push(await runOnce('UNPACKAGED', electron, [ROOT]))
}
console.log('\n======== SUMMARY ========')
console.log(JSON.stringify(out.map((r) => ({
  label: r.label, ok: r.ok, error: r.error,
  gpu: r.hardware?.gpuBackend,
  vramTotal: r.hardware?.vramTotalBytes,
  visible: r.visible,
})), null, 2))
const bad = out.filter((r) => !r.ok || r.hardware?.gpuBackend === 'false' || r.hardware?.vramTotalBytes === 0)
process.exit(bad.length === 0 ? 0 : 1)
