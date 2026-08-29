import { useEffect, useState } from 'react'
import type { AppId } from './types'

/**
 * Открытые слоты раздела: какие приложения на экране (не больше двух), какой из них активен,
 * обмен местами и клавиатура.
 *
 * ⚠️ Активный слот нужен ровно тогда, когда открыты ОБА: они занимают всю площадь, и по виду не
 * отличить, в каком идёт работа. Живой случай: набираешь в конвертере — калькулятор рядом не
 * принимает ввод, но выглядит так же.
 *
 * ⚠️ Esc слушается в фазе ПЕРЕХВАТА и со stopPropagation: панель закрывает себя по Esc своим
 * обработчиком на document (см. aipanel.tsx), и без перехвата один Esc делал бы оба дела разом —
 * закрывал приложение и захлопывал панель.
 */
export function useOpenSlots({ requestedApp, onRequestHandled, consumeEscape }: {
  /** Просьба извне открыть приложение (клик по иконке в другом месте панели). */
  requestedApp?: AppId | null
  onRequestHandled?: () => void
  /**
   * Отдать Esc тому, что лежит ПОВЕРХ экрана — меню у иконки, лист настроек. Вернул true —
   * значит забрал себе, слот трогать не надо. ⚠️ Порядок «поверх» знает компонент, а не хук:
   * здесь он был бы зашитым списком чужих модалок.
   */
  consumeEscape: () => boolean
}) {
  const [openApps, setOpenApps] = useState<AppId[]>([])
  const openApp = (id: AppId) => {
    setOpenApps((prev) => (prev.includes(id) || prev.length >= 2 ? prev : [...prev, id]))
  }
  const closeApp = (id: AppId) => setOpenApps((prev) => prev.filter((a) => a !== id))

  // Внешний запрос: открыть приложение и сразу сообщить, что он обработан, — иначе повторный
  // клик по той же иконке не сработал бы (значение в родителе не поменялось бы).
  useEffect(() => {
    if (!requestedApp) return
    openApp(requestedApp)
    onRequestHandled?.()
    // openApp/onRequestHandled стабильны по смыслу вызова; следим только за самим запросом.
     
  }, [requestedApp])
  // Обмен верхнего/нижнего слота — ключи не меняются, React переставляет DOM без ремаунта,
  // состояние приложений (набранное в калькуляторе, таймер) переезжает вместе со слотом.
  const swapSlots = () => setOpenApps((prev) => (prev.length === 2 ? [prev[1], prev[0]] : prev))

  // ── Какой слот активен ──
  // ⚠️ Нужно ровно тогда, когда открыты ОБА: они занимают всю площадь, и по виду не отличить, в
  // каком сейчас идёт работа. Живой случай: набираешь в конвертере — калькулятор рядом не
  // принимает ввод, но выглядит так же. Кольцо на иконке этого не решало: сетка иконок при двух
  // открытых приложениях вообще не видна.
  const [activeApp, setActiveApp] = useState<AppId | null>(null)
  // Клик в САЙТ веб-слота панель не видит — про него сообщает main (см. WebAppManager.ts).
  useEffect(() => window.aiPanel.onWebAppFocused((id) => setActiveApp(id)), [])
  // Закрыли слот — активным становится оставшийся, иначе рамка осталась бы на пустом месте.
  useEffect(() => {
    if (openApps.length === 1) setActiveApp(openApps[0])
    else if (openApps.length === 0) setActiveApp(null)
    else if (activeApp === null || !openApps.includes(activeApp)) setActiveApp(openApps[0])
  }, [openApps, activeApp])

  // Esc закрывает СЛОТ, а не панель, пока открыто хоть одно приложение.
  // ⚠️ Слушатель в фазе ПЕРЕХВАТА и с stopPropagation: панель закрывает себя по Esc своим
  // обработчиком на document (см. aipanel.tsx), и без перехвата один Esc делал бы оба дела разом
  // — закрывал приложение и захлопывал панель. Закрывается ПОСЛЕДНИЙ открытый: он верхний в
  // стопке внимания, как последняя открытая вкладка при Ctrl+W.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Ctrl+Tab — переключить активное приложение с клавиатуры. Обычные стрелки для этого не
      // годятся: они уже ходят по сетке иконок, а внутри приложений живут поля ввода.
      if (e.key === 'Tab' && e.ctrlKey && openApps.length === 2) {
        e.preventDefault()
        e.stopPropagation()
        setActiveApp((cur) => (cur === openApps[0] ? openApps[1] : openApps[0]))
        return
      }
      if (e.key !== 'Escape') return
      // Сначала Esc предлагается тому, что лежит ПОВЕРХ экрана (меню у иконки, лист настроек):
      // забрал — слот не трогаем.
      if (consumeEscape()) { e.stopPropagation(); return }
      if (openApps.length === 0) return
      e.stopPropagation()
      // ⚠️ Закрывается АКТИВНОЕ приложение, а не последнее в списке. Прежнее «последнее» было
      // прямым багом: подсвечен конвертер, жмёшь Esc — закрывается калькулятор, потому что он
      // оказался нижним. Esc обязан относиться к тому же, к чему относится рамка.
      const target = activeApp && openApps.includes(activeApp) ? activeApp : openApps[openApps.length - 1]
      setOpenApps((prev) => prev.filter((x) => x !== target))
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [openApps, activeApp, consumeEscape])

  return { openApps, setOpenApps, activeApp, setActiveApp, openApp, closeApp, swapSlots }
}
