import { protocol, app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

// Вызывается ДО app.whenReady() — Electron требует регистрацию схем до события ready.
export function registerSchemesAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'oblako-model',
      privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true },
    },
    {
      // Chrome-слой браузера (React-UI). Вместо file:// — чтобы выставить COOP/COEP
      // заголовки через protocol.handle и получить crossOriginIsolated=true → SAB → WASM-потоки.
      scheme: 'oblako-chrome',
      privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true },
    },
  ])
}

// ── oblako-model:// ────────────────────────────────────────────────────────────

// Приоритет: userData/models/ (пользовательские обновления) → resources/models/ (бандл).
function resolveModelsBase(): string {
  const userModels = path.join(app.getPath('userData'), 'models')
  if (fs.existsSync(userModels)) return userModels
  if (app.isPackaged) return path.join(process.resourcesPath, 'models')
  // dev / npm start: __dirname = dist-electron/electron/ → ../../resources/models
  return path.join(__dirname, '../../resources', 'models')
}

// Вызывается внутри app.whenReady().
export function registerModelProtocol(): void {
  const base = resolveModelsBase()

  protocol.handle('oblako-model', (request) => {
    const url = new URL(request.url)
    // pathname: /models/Xenova/all-MiniLM-L6-v2/tokenizer.json
    const relative = url.pathname.replace(/^\/models\//, '')
    const filePath = path.join(base, relative)

    // Защита от path traversal за пределы base.
    if (!filePath.startsWith(base + path.sep) && filePath !== base) {
      return new Response('Forbidden', { status: 403 })
    }
    if (!fs.existsSync(filePath)) {
      console.warn(`[AppProtocol] не найден: ${filePath}`)
      return new Response('Not Found', { status: 404 })
    }

    const data = fs.readFileSync(filePath)
    const contentType = path.extname(filePath).toLowerCase() === '.json'
      ? 'application/json'
      : 'application/octet-stream'

    return new Response(data, {
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        // CORP: явно разрешаем cross-origin доступ из oblako-chrome://.
        // При COEP:credentialless технически не обязателен, но семантически верно.
        'Cross-Origin-Resource-Policy': 'cross-origin',
      },
    })
  })

  console.log(`[AppProtocol] oblako-model:// → ${base}`)
}

// ── oblako-chrome:// ───────────────────────────────────────────────────────────

// MIME-типы для ассетов Vite-бандла.
// .wasm → application/wasm: КРИТИЧНО — без этого ORT не может stream-compile WASM
//   (упадёт с ошибкой «failed to compile WebAssembly» или откатится на медленный путь).
// .js  → text/javascript: нужен для <script type="module"> и Worker({ type: 'module' }).
// Запасные типы — для будущих ассетов (иконки, шрифты); сейчас dist/ содержит только 4 расширения.
const CHROME_MIME: Record<string, string> = {
  '.html':  'text/html; charset=utf-8',
  '.js':    'text/javascript',
  '.css':   'text/css',
  '.wasm':  'application/wasm',
  '.json':  'application/json',
  '.svg':   'image/svg+xml',
  '.png':   'image/png',
  '.ico':   'image/x-icon',
  '.ttf':   'font/ttf',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
}

function resolveDistDir(): string {
  // dev + npm start: __dirname = dist-electron/electron/ → ../../dist
  // packaged: путь внутри app.asar — Electron fs поддерживает asar-чтение.
  return path.join(__dirname, '../../dist')
}

// Вызывается внутри app.whenReady().
export function registerChromeProtocol(): void {
  const distDir = resolveDistDir()

  protocol.handle('oblako-chrome', (request) => {
    const url = new URL(request.url)
    // /index.html → 'index.html'; /assets/index-XXX.js → 'assets/index-XXX.js'
    const relPath = url.pathname.replace(/^\//, '') || 'index.html'
    const filePath = path.join(distDir, relPath)

    // Защита от path traversal за пределы distDir.
    if (!filePath.startsWith(distDir + path.sep) && filePath !== distDir) {
      return new Response('Forbidden', { status: 403 })
    }
    if (!fs.existsSync(filePath)) {
      console.warn(`[AppProtocol] chrome: не найден: ${filePath}`)
      return new Response('Not Found', { status: 404 })
    }

    const ext  = path.extname(filePath).toLowerCase()
    const mime = CHROME_MIME[ext] ?? 'application/octet-stream'
    const data = fs.readFileSync(filePath)

    return new Response(data, {
      headers: {
        'Content-Type': mime,
        // COOP+COEP на каждом ответе:
        //   COOP применяется только к document-навигации (на subresource игнорируется — не вредит).
        //   COEP:credentialless → cross-origin ресурсы грузятся без credentials, CORP не нужен.
        //   Итог: crossOriginIsolated=true → SAB=true → ORT задействует все потоки WASM.
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
    })
  })

  console.log(`[AppProtocol] oblako-chrome:// → ${distDir}`)
}
