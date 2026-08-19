// Компактный поповер AI-действий над выделением (перевод/выжимка/пересказ/объяснение) — отдельная
// WebContentsView поверх активной вкладки. Один и тот же поповер для всех действий — action влияет
// только на промпт внутри TranslationService.runAiAction, сама труба (координаты → Qwen → поповер →
// стриминг → закрытие) общая. WebContentsView.setBounds — один прямоугольник; «дырку» под
// произвольной точкой контента не сделать (тот же вывод, что и для чром-панели: FindBar доказывает
// это на всю ширину сверху). Поэтому — отдельный view, добавленный ПОСЛЕДНИМ (топ по z-order
// Electron), а не встройка в чром-слой и не reserve основного контента.
//
// Создаётся ЛЕНИВО: ничего не происходит, пока не вызван showTranslatePopover() (по клику пункта
// меню). Ничего не висит на старте браузера. TranslationService (сама логика AI-действий, промпты,
// ленивая загрузка GGUF) не трогается — только вызывается.
import { WebContentsView, ipcMain } from 'electron'
import type { BrowserWindow, WebContents } from 'electron'
import path from 'node:path'
import type { SelectionRect } from './TabManager'
import { runAiAction } from './TranslationService'
import type { AiAction } from '../shared/ipc'

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

  const result = {
    x: x - SHADOW_MARGIN,
    y: y - SHADOW_MARGIN,
    width: POPOVER_WIDTH + SHADOW_MARGIN * 2,
    height: height + SHADOW_MARGIN * 2,
  }
  console.log(`[popover] computeBounds: inputRect=${JSON.stringify(rect)} winSize=${winW}x${winH} -> ${JSON.stringify(result)}`)
  return result
}

// Вернуть исправленный текст в то самое поле (см. EDIT_FIELD_CAPTURE_SCRIPT в TabManager.ts —
// оно помечено атрибутом ещё в момент вызова меню).
//
// ⚠️ Вставляем через execCommand('insertText'), а не присваиванием value. Только он кладёт правку
// в СОБСТВЕННУЮ историю поля, то есть Ctrl+Z возвращает человеку его текст — а без этого правка
// модели была бы необратимой прямо посреди недописанного письма. Присваивание оставлено запасным
// путём, и там значение ставится через нативный сеттер прототипа: React не замечает прямого
// присваивания и уходит с пустым состоянием (тот же приём и та же причина, что в graphWebApps.ts).
function buildReplaceScript(text: string): string {
  const payload = JSON.stringify(text)
  return `(function(){
    var el = document.querySelector('[data-oblako-edit]');
    if (!el) return false;
    el.removeAttribute('data-oblako-edit');
    var text = ${payload};
    try {
      el.focus();
      var isField = ('value' in el);
      if (isField) { el.setSelectionRange(0, el.value.length); }
      else {
        var r = document.createRange(); r.selectNodeContents(el);
        var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      }
      if (document.execCommand('insertText', false, text)) return true;
      if (isField) {
        var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        setter.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      el.textContent = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    } catch (e) { return false; }
  })()`
}

// Метка на поле не должна пережить поповер: следующий вызов иначе мог бы вставить текст в поле,
// про которое человек уже забыл. Снимаем при любом закрытии, это дешёвый best-effort.
function clearEditMark(wc: WebContents | null): void {
  if (!wc || wc.isDestroyed()) return
  void wc.executeJavaScript(
    `(function(){var e=document.querySelector('[data-oblako-edit]');if(e)e.removeAttribute('data-oblako-edit');})()`,
  ).catch(() => { /* страница ушла — и не надо */ })
}

function cleanup(): void {
  if (!popoverView) return
  clearEditMark(scrollWc)
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

// Безусловное закрытие — активная вкладка сменилась (см. TabManager.activate/focusSplitPanel),
// поповер анкорен к прежней и позиционно больше не имеет смысла, независимо от того, какая
// вкладка стала активной.
export function closeTranslatePopoverOnTabSwitch(): void {
  cleanup()
}

// Закрытие только если закрывшаяся вкладка — та самая, на которой поповер висит (сравнение по
// ссылке на WebContents, тот же приём, что и для scrollWc/console-message выше). Закрытие ЧУЖОЙ
// фоновой вкладки не должно гасить открытый поповер.
export function closeTranslatePopoverForClosedTab(wc: WebContents): void {
  if (scrollWc === wc) cleanup()
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

  // «Заменить» — вернуть правку в поле и закрыться. ⚠️ Вкладку берём ту же, на которой поповер
  // и висит (scrollWc): за время генерации человек мог кликнуть куда угодно, и искать «активную»
  // вкладку к моменту ответа — верный способ вставить текст в чужую страницу.
  ipcMain.on('translate-popover:replace', (_e, replacement: string) => {
    const wc = scrollWc
    if (!wc || wc.isDestroyed() || typeof replacement !== 'string' || !replacement) { cleanup(); return }
    // userGesture=true: без него Chromium отклоняет команды редактирования из скрипта.
    void wc.executeJavaScript(buildReplaceScript(replacement), true)
      .catch((e: unknown) => console.warn('[popover] вставка в поле не удалась:', e))
    scrollWc = null // метку уже снял сам скрипт — cleanup'у чистить нечего
    cleanup()
  })
}

export function showTranslatePopover(win: BrowserWindow, action: AiAction, text: string, rect: SelectionRect, tabWc: WebContents, canReplace = false, targetLang?: string): void {
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
    // targetLang доезжает до карточки, чтобы подпись была «Перевожу на английский…», а не общее
    // «Перевожу…»: человек сам выбрал язык и ждёт подтверждения, что услышали именно его.
    wc.send('translate-popover:open', { text, action, canReplace, targetLang })
    wc.focus()
  })
  wc.loadURL('oblako-chrome://localhost/translatepopover.html')

  // Best-effort: скролл страницы / клик вне выделения / смена выделения на странице закрывают
  // поповер. НЕ единственные триггеры — console-message в проекте признан ненадёжным (см. заметку
  // по прошлой фиче), поэтому это поверх Esc/крестика, а не вместо них: если сигнал не дойдёт,
  // попер всё равно закроется другим путём. Слушатели живут на странице ВКЛАДКИ (tabWc), не
  // поповера — клик/скролл ВНУТРИ самого поповера (крестик, скролл результата) физически не может
  // попасть сюда, это отдельный DOM/процесс.
  scrollWc = tabWc
  const SCROLL_SIGNAL = '__oblako_translate_scroll_close__'
  const OUTSIDE_SIGNAL = '__oblako_translate_outside_close__'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onScrollConsoleMessage = (event: any) => {
    if (event.message === SCROLL_SIGNAL || event.message === OUTSIDE_SIGNAL) cleanup()
  }
  tabWc.on('console-message', onScrollConsoleMessage)
  tabWc.executeJavaScript(
    `(function(){
      window.addEventListener('scroll', function(){ console.log('${SCROLL_SIGNAL}') }, { once: true, capture: true });
      // Отложенная регистрация — тем самым клик/выделение, которым сам поповер и был вызван
      // (ПКМ → «Перевести»), уже в прошлом и не может породить ложное самозакрытие сразу после
      // показа (тот же класс гонки, что раньше был с blur, только здесь — реальные события мыши,
      // а не внутренний шум Electron, так что достаточно небольшой задержки, а не отказа от идеи).
      setTimeout(function(){
        window.addEventListener('mousedown', function(){ console.log('${OUTSIDE_SIGNAL}') }, { once: true, capture: true });
        document.addEventListener('selectionchange', function(){ console.log('${OUTSIDE_SIGNAL}') }, { once: true });
      }, 250);
    })();`,
    true,
  ).catch(() => { /* best-effort — если скрипт не выполнился, Esc/крестик всё равно работают */ })

  // Единая точка входа для ЛЮБОГО AI-действия (перевод/выжимка/пересказ/объяснение) — только
  // action меняет промпт внутри TranslationService, сама труба одна. onChunk — токен-стриминг на
  // уровне генерации (не дожидаясь всего результата и не дожидаясь целого сегмента), чтобы текст
  // «печатался» в поповере по мере генерации для ЛЮБОГО действия, включая осмысляющие
  // (explain/simplify/summarize), у которых раньше не было промежуточной подачи вовсе. И там, и в
  // финальном .then — проверка, что popoverView всё ещё тот же (не закрыт/не пересоздан повторным
  // действием).
  void runAiAction(action, text, (chunkText) => {
    if (popoverView && popoverView.webContents === wc) wc.send('translate-popover:chunk', chunkText)
  }, targetLang).then((outcome) => {
    if (popoverView && popoverView.webContents === wc) wc.send('translate-popover:result', outcome)
  })
}
