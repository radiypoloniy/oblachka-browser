import { useEffect, useState } from 'react'
import { loadWallpaper, saveWallpaper } from '../components/aiApps'
import { subscribeMeshes } from '../newtab/gradients'

// То, что одинаково у обеих панелей — полной (чат + приложения) и облегчённой (только
// приложения, лёгкое окно): обои острова и закрытие по Escape.

/**
 * Обои экрана приложений: выбор, сохранение и перерисовка на всё, что меняет картинку.
 *
 * ⚠️ Стейт живёт ЗДЕСЬ, а не внутри AppsMode: обоями красится ВЕСЬ остров панели, включая фон за
 * шапкой (см. PanelShell), а не только область под сеткой иконок.
 *
 * ⚠️ rev — форс-перерисовка, когда id НЕ меняется, а картинка под ним меняется: повторная
 * загрузка своего фото при уже выбранном 'custom' (setState тем же значением React бы съел, и
 * wallpaperBackground не перечитал бы обновлённый кэш), живой градиент и смена темы.
 */
export function useWallpaper(): { wallpaper: string; selectWallpaper: (id: string) => void } {
  const [wallpaper, setWallpaper] = useState<string>(loadWallpaper)
  const [, setRev] = useState(0)
  const selectWallpaper = (id: string) => {
    setWallpaper(id)
    setRev((r) => r + 1)
    saveWallpaper(id)
  }
  useEffect(() => subscribeMeshes(() => setRev((r) => r + 1)), [])
  useEffect(() => {
    const el = document.documentElement
    const obs = new MutationObserver(() => setRev((r) => r + 1))
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return { wallpaper, selectWallpaper }
}

/**
 * Escape закрывает панель.
 *
 * ⚠️ Обычный обработчик на document, БЕЗ перехвата: открытое приложение и меню у иконки
 * забирают Escape себе раньше (см. useOpenSlots) — иначе один Escape делал бы два дела разом.
 */
export function useEscapeClose(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') window.aiPanel.close() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
}
