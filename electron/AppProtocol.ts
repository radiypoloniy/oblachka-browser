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

// Бандл (resources/models) — фолбэк, когда файла нет в userData. Раньше приоритет между
// userData и бандлом решался ОДИН раз на весь каталог models/ (fs.existsSync на сам каталог,
// не на конкретный файл) — из-за этого частичная докладка в userData (например, только
// userData/models/translation/ — см. BergamotWorkerEntry.ts, тот же класс бага) намертво
// переключала резолвер на userData для ВСЕХ моделей, включая те, что там не докладывали
// (onnx-community/embeddinggemma-…), хотя они были целы в resources/models/ — 404 при живых
// файлах. Теперь фолбэк per-request, на уровне конкретного запрошенного файла (см. ниже).
function resolveModelsBundledBase(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'models')
  // dev / npm start: __dirname = dist-electron/electron/ → ../../resources/models
  return path.join(__dirname, '../../resources', 'models')
}

// Вызывается внутри app.whenReady().
export function registerModelProtocol(): void {
  const userBase = path.join(app.getPath('userData'), 'models')
  const bundledBase = resolveModelsBundledBase()

  protocol.handle('oblako-model', (request) => {
    const url = new URL(request.url)
    // pathname: /models/Xenova/all-MiniLM-L6-v2/tokenizer.json
    const relative = url.pathname.replace(/^\/models\//, '')

    // userData сначала (пользовательские докладки/обновления), бандл — фолбэк. Проверяем
    // существование каждого КОНКРЕТНОГО файла, а не каталога models/ целиком — так докладка
    // одной модели в userData не экранирует остальные, которые остались только в бандле.
    let filePath: string | null = null
    let sawValidCandidate = false
    for (const base of [userBase, bundledBase]) {
      const p = path.join(base, relative)
      // Защита от path traversal за пределы этой конкретной base.
      if (!(p.startsWith(base + path.sep) || p === base)) continue
      sawValidCandidate = true
      if (fs.existsSync(p)) { filePath = p; break }
    }
    if (!sawValidCandidate) {
      return new Response('Forbidden', { status: 403 })
    }
    if (!filePath) {
      console.warn(`[AppProtocol] не найден: ${relative} (искали в ${userBase} и ${bundledBase})`)
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

  console.log(`[AppProtocol] oblako-model:// → ${userBase} (userData) → ${bundledBase} (бандл, фолбэк)`)
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
