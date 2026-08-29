import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { loadSplit, saveSplit, SPLIT_MAX, SPLIT_MIN } from './storage'

/**
 * Доля верхнего слота и жест её изменения разделителем.
 *
 * ⚠️ `resizing` наружу отдаётся не для красоты: пока тянут разделитель, веб-слоты обязаны
 * ПРЯТАТЬСЯ. Их WebContentsView лежит ПОВЕРХ панели, и как только указатель заходит на сайт,
 * панель перестаёт получать pointermove — тот же закон, из-за которого зоны дропа вкладок
 * считает main, а не рендерер. Спрятанная вью отдаёт указатель панели, и разделитель доезжает
 * до конца; сайт возвращается на отпускании.
 */
export function useSlotSplit(): {
  slotsRef: RefObject<HTMLDivElement>
  splitRatio: number
  resizing: boolean
  startResize: (e: ReactPointerEvent) => void
} {
  const slotsRef = useRef<HTMLDivElement>(null)
  const [splitRatio, setSplitRatio] = useState<number>(loadSplit)
  const ratioRef = useRef(splitRatio)
  // ⚠️ Пока тянут разделитель, веб-слоты ПРЯЧУТСЯ. Не косметика: их WebContentsView лежит ПОВЕРХ
  // панели, и как только указатель заходит на сайт, панель перестаёт получать pointermove — тот
  // же закон, из-за которого зоны дропа вкладок считает main, а не рендерер. Спрятанная вью
  // отдаёт указатель панели, и разделитель доезжает до конца; сайт возвращается на отпускании.
  const [resizing, setResizing] = useState(false)

  const startResize = (e: React.PointerEvent) => {
    const box = slotsRef.current?.getBoundingClientRect()
    if (!box || box.height <= 0) return
    e.preventDefault()
    setResizing(true)
    const move = (ev: PointerEvent) => {
      const r = Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, (ev.clientY - box.top) / box.height))
      ratioRef.current = r
      setSplitRatio(r)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setResizing(false)
      saveSplit(ratioRef.current)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return { slotsRef, splitRatio, resizing, startResize }
}
