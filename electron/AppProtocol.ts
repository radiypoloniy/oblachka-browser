import { protocol, app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

// Вызывается ДО app.whenReady() — Electron требует регистрацию схем до события ready.
export function registerSchemesAsPrivileged(): void {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'oblako-model',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  }])
}

// Приоритет: userData/models/ (пользовательские обновления) → resources/models/ (бандл).
function resolveModelsBase(): string {
  const userModels = path.join(app.getPath('userData'), 'models')
  if (fs.existsSync(userModels)) return userModels

  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'models')
  }
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
      },
    })
  })

  console.log(`[AppProtocol] oblako-model:// → ${base}`)
}
