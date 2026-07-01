// Компактный поповер перевода у выделения — отдельная WebContentsView поверх активной вкладки.
// WebContentsView.setBounds — один прямоугольник; «дырку» под произвольной точкой контента не
// сделать (тот же вывод, что и для чром-панели: FindBar доказывает это на всю ширину сверху).
// Поэтому — отдельный view, добавленный ПОСЛЕДНИМ (топ по z-order Electron), а не встройка
// в чром-слой и не reserve основного контента.
//
// Создаётся ЛЕНИВО: ничего не происходит, пока не вызван showTranslatePopover() (по клику
// «Перевести»). Ничего не висит на старте браузера. TranslationService (сама логика перевода,
// промпт, стоп-настройка, ленивая загрузка GGUF) не трогается — только вызывается.
import { WebContentsView, ipcMain } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'
import path from 'node:path'
import type { SelectionRect } from './TabManager'
import { translate } from './TranslationService'

const POPOVER_WIDTH = 340
const INITIAL_HEIGHT = 90 // высота на время «Перевожу…»
const GAP = 8             // зазор от выделения
const MARGIN = 8          // минимальный отступ от края окна
// Прозрачный запас вокруг карточки под CSS box-shadow — WebContentsView обрезает всё, что рисуется
// за границей своего прямоугольника, поэтому «парящей» тени нужно физическое место, куда вытечь.
// Должен с запасом покрывать реальный охват тени (offset + blur карточки в translatepopover.tsx,
// сейчас 10+28=38px по нижнему краю) — иначе едва заметный, но видимый обрез хвоста тени даёт
// то же ощущение «прямоугольника-подложки», от которого и уходили. Держать в синхроне с
// SHADOW_MARGIN в src/translatepopover.tsx (тот же паддинг инсетит карточку обратно на столько же —
// сама карточка визуально остаётся в исходной точке анкоринга).
const SHADOW_MARGIN = 40

let popoverView: WebContentsView | null = null
let attachedWin: BrowserWindow | null = null
let currentRect: SelectionRect | null = null
let scrollWc: WebContents | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let onScrollConsoleMessage: ((event: any) => void) | null = null
let ipcRegistered = false

// Позиция: под выделением по умолчанию; флип вверх, если не помещается снизу; флип влево
// (выравнивание по правому краю выделения), если не помещается справа. Итог клампится в окно.
// Решения флипа/кламп считаются на «логических» (без отступа под тень) ширине/высоте карточки —
// это тот же расчёт, что уже проверен руками. SHADOW_MARGIN добавляется отдельным шагом в самом
// конце: итоговый прямоугольник просто на него больше со всех сторон, под CSS-тень.
function computeBounds(win: BrowserWindow, rect: SelectionRect, height: number) {
  const { width: winW, height: winH } = win.getContentBounds()

  let x = rect.x
  if (x + POPOVER_WIDTH > winW - MARGIN) x = rect.x + rect.width - POPOVER_WIDTH
  x = Math.min(Math.max(MARGIN, x), Math.max(MARGIN, winW - POPOVER_WIDTH - MARGIN))

  let y = rect.y + rect.height + GAP
  if (y + height > winH - MARGIN) y = rect.y - GAP - height
  y = Math.min(Math.max(MARGIN, y), Math.max(MARGIN, winH - height - MARGIN))

  return {
    x: x - SHADOW_MARGIN,
    y: y - SHADOW_MARGIN,
    width: POPOVER_WIDTH + SHADOW_MARGIN * 2,
    height: height + SHADOW_MARGIN * 2,
  }
}

function cleanup(): void {
  if (!popoverView) return
  if (attachedWin) {
    try { attachedWin.contentView.removeChildView(popoverView) } catch { /* окно могло уже закрыться */ }
  }
  popoverView.webContents.close()
  popoverView = null
  if (scrollWc && onScrollConsoleMessage) {
    scrollWc.off('console-message', onScrollConsoleMessage)
  }
  scrollWc = null
  onScrollConsoleMessage = null
  attachedWin = null
  currentRect = null
}

// Регистрируется один раз, лениво — на первый показ поповера, не на старте.
function ensureIpcRegistered(): void {
  if (ipcRegistered) return
  ipcRegistered = true

  // Рост под контент (репорт из preload поповера) — пересчитываем bounds с тем же якорем.
  ipcMain.on('translate-popover:height', (_e, px: number) => {
    if (!popoverView || !attachedWin || !currentRect) return
    popoverView.setBounds(computeBounds(attachedWin, currentRect, Math.max(INITIAL_HEIGHT, px)))
  })

  // Крестик / Esc внутри поповера — надёжные пути закрытия.
  ipcMain.on('translate-popover:close', () => cleanup())
}

export function showTranslatePopover(win: BrowserWindow, text: string, rect: SelectionRect, tabWc: WebContents): void {
  ensureIpcRegistered()
  cleanup() // на случай, если предыдущий поповер ещё не закрыт (повторный клик «Перевести»)

  popoverView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-translatepopover.js'),
      contextIsolation: true,
      sandbox: false, // preload использует ipcRenderer
    },
  })
  // По умолчанию у View непрозрачный фон — без этого вокруг карточки был бы виден серый
  // прямоугольник на весь прямоугольник WebContentsView. Страница (html/body) тоже прозрачная
  // (см. translatepopover.html) — вместе это даёт «плавающую» карточку без подложки.
  popoverView.setBackgroundColor('#00000000')
  attachedWin = win
  currentRect = rect

  popoverView.setBounds(computeBounds(win, rect, INITIAL_HEIGHT))
  // Добавляется ПОСЛЕДНИМ → Electron стекует детей в порядке добавления, этот — на самом верху,
  // поверх уже добавленной вкладки. Native z-order, не CSS z-index.
  win.contentView.addChildView(popoverView)

  const wc = popoverView.webContents

  // ВАЖНО (диагностировано логами, не гадание): closing по blur НЕ используется. У свежедобавленной
  // WebContentsView Electron сам шлёт focus→blur парой ~в первые полсотни мс после addChildView —
  // ДО did-finish-load, то есть до нашего explicit wc.focus(). В момент этого blur ни tabWc, ни
  // win.webContents фокус не получают (win.isFocused()=true, оба webContents.isFocused()=false) —
  // значит это внутренняя гонка инициализации рендер-виджета, а не реальный уход фокуса пользователем.
  // Поэтому реальный уход фокуса от этого не отличить, и blur как триггер закрытия не работает.
  // Закрытие — только явные действия: крестик/Esc (ipc), повторный клик «Перевести» (re-show выше),
  // скролл страницы (best-effort ниже).
  wc.once('did-finish-load', () => {
    wc.send('translate-popover:open', text)
    wc.focus()
  })
  wc.loadURL('oblako-chrome://localhost/translatepopover.html')

  // Best-effort: скролл страницы закрывает поповер. НЕ единственный триггер — console-message
  // в проекте признан ненадёжным (см. заметку по прошлой фиче), поэтому это поверх Esc/крестика,
  // а не вместо них: если сигнал не дойдёт, попер всё равно закроется другим путём.
  scrollWc = tabWc
  const SCROLL_SIGNAL = '__oblako_translate_scroll_close__'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onScrollConsoleMessage = (event: any) => {
    if (event.message === SCROLL_SIGNAL) cleanup()
  }
  tabWc.on('console-message', onScrollConsoleMessage)
  tabWc.executeJavaScript(
    `window.addEventListener('scroll', function(){ console.log('${SCROLL_SIGNAL}') }, { once: true, capture: true });`,
    true,
  ).catch(() => { /* best-effort — если скрипт не выполнился, Esc/крестик всё равно работают */ })

  // Сама логика перевода — TranslationService не меняется, только вызывается.
  void translate(text, 'auto').then((outcome) => {
    if (popoverView && popoverView.webContents === wc) wc.send('translate-popover:result', outcome)
  })
}
