// Мост панели к веб-слотам: четыре канала, которыми раздел «Приложения» просит показать чужой
// сайт в «дырке» своего слота (сами вью держит WebAppManager.ts).
//
// ⚠️ ВЫНЕСЕНО ИЗ AiPanelManager.ts по той же причине, что и panelStatus.ts: файл стоит на
// храповике структуры, и обработчикам там места нет. Заодно видно, что это одна вещь — перевод
// координат из вьюпорта панели в координаты окна плюс адресация «какое окно спросило».
//
// ⚠️ Геометрию модуль НЕ знает: угол панели приходит колбэком из AiPanelManager (только он
// знает ширину дока и высоту тулбара). Здесь остаётся сложение и проверка типов аргументов.
import { ipcMain } from 'electron'
import type { IpcMainEvent } from 'electron'
import * as webApps from '../WebAppManager'
import { panelBySender } from './instances'

/** Левый верхний угол вьюпорта панели в координатах окна. */
export interface PanelOrigin { x: number; y: number }

export function registerWebAppChannels(originOf: (win: Electron.BrowserWindow) => PanelOrigin): void {
  ipcMain.on('ai-panel:webapp-open', (event: IpcMainEvent, appId: unknown, url: unknown) => {
    const win = panelBySender(event.sender)?.win
    if (win && typeof appId === 'string' && typeof url === 'string') {
      webApps.openWebApp(win, appId, url)
    }
  })

  // Панель шлёт прямоугольник «дырки» В СВОЁМ вьюпорте — переводим его в координаты окна.
  ipcMain.on('ai-panel:webapp-bounds', (event: IpcMainEvent, appId: unknown, rect: unknown) => {
    const win = panelBySender(event.sender)?.win
    if (!win || typeof appId !== 'string') return
    const r = rect as { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | null
    if (!r || typeof r.x !== 'number' || typeof r.y !== 'number'
      || typeof r.width !== 'number' || typeof r.height !== 'number') return
    const origin = originOf(win)
    webApps.setWebAppBounds(win, appId, {
      x: Math.round(origin.x + r.x),
      y: Math.round(origin.y + r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
    })
  })

  ipcMain.on('ai-panel:webapp-focus', (event: IpcMainEvent, appId: unknown) => {
    const win = panelBySender(event.sender)?.win
    if (win && typeof appId === 'string') webApps.focusWebApp(win, appId)
  })

  ipcMain.on('ai-panel:webapp-close', (event: IpcMainEvent, appId: unknown) => {
    const win = panelBySender(event.sender)?.win
    if (win && typeof appId === 'string') webApps.closeWebApp(win, appId)
  })
}
