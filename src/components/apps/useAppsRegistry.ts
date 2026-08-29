import { useState } from 'react'
import { APPS } from '../aiApps'
import {
  customToDef, loadAppsOrder, loadCustomApps, loadHiddenApps,
  orderApps, saveAppsOrder, saveCustomApps, saveHiddenApps, type CustomWebApp,
} from './storage'
import type { AppDef } from './types'

/**
 * Что стоит на домашнем экране: встроенные приложения плюс свои веб-приложения, их порядок и
 * спрятанные. Каждое изменение сразу ложится в localStorage — экран обязан пережить перезапуск.
 *
 * ⚠️ Спрятанное убирается только С ЭКРАНА: открытый слот с ним продолжает работать, пока его не
 * закроют. Иначе «скрыть» на глазах убивало бы наполовину введённое в приложении.
 */
export function useAppsRegistry({ newAppName, newAppUrl, onAdded, closeApp }: {
  newAppName: string
  newAppUrl: string
  /** Форму добавления чистит компонент — она его состояние. */
  onAdded: () => void
  /** ⚠️ Удаляемое веб-приложение может быть ОТКРЫТО в слоте: слот надо закрыть, иначе его вью
   *  в main переживёт само приложение. Слоты — дело useOpenSlots, поэтому колбэком. */
  closeApp: (id: string) => void
}) {
  const [customApps, setCustomApps] = useState<CustomWebApp[]>(loadCustomApps)
  const [appsOrder, setAppsOrder] = useState<string[]>(loadAppsOrder)
  const [hiddenApps, setHiddenApps] = useState<string[]>(loadHiddenApps)
  const everyApp: AppDef[] = orderApps([...APPS, ...customApps.map(customToDef)], appsOrder)
  // ⚠️ Спрятанное убирается только с ЭКРАНА: открытый слот с ним продолжает работать, пока его не
  // закроют. Иначе «скрыть» на глазах убивало бы наполовину введённое в приложении.
  const allApps: AppDef[] = everyApp.filter((a) => !hiddenApps.includes(a.id))
  // ⚠️ Отдельного списка спрятанных больше нет: во вкладке «Приложения» они стоят в общем списке
  // с выключенным тумблером. Прежний блок «Скрытые с экрана» появлялся и исчезал сам, и был
  // единственной дверью назад — при том что прячут приложение совсем в другом месте.

  const hideApp = (id: string) => {
    const next = [...hiddenApps, id]
    setHiddenApps(next)
    saveHiddenApps(next)
  }
  const unhideApp = (id: string) => {
    const next = hiddenApps.filter((x) => x !== id)
    setHiddenApps(next)
    saveHiddenApps(next)
  }
  const reorderApps = (ids: string[]) => {
    setAppsOrder(ids)
    saveAppsOrder(ids)
  }


  const addCustomApp = () => {
    const rawUrl = newAppUrl.trim()
    if (!rawUrl) return
    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`
    let name = newAppName.trim()
    if (!name) {
      try { name = new URL(url).hostname.replace(/^www\./, '') } catch { name = rawUrl }
    }
    const next = [...customApps, { id: `web:custom-${Date.now()}`, name, url }]
    setCustomApps(next)
    saveCustomApps(next)
    onAdded()
  }
  const removeCustomApp = (id: string) => {
    closeApp(id) // если открыт в слоте — слот закрывается (и view в main умирает с ним)
    const next = customApps.filter((c) => c.id !== id)
    setCustomApps(next)
    saveCustomApps(next)
  }


  return {
    customApps, appsOrder, hiddenApps, everyApp, allApps,
    hideApp, unhideApp, reorderApps, addCustomApp, removeCustomApp,
  }
}
