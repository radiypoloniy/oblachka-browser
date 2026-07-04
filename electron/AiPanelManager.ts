// Правая AI-панель — оверлей поверх контента (Заход 1: каркас/дизайн), рабочий чат с Qwen
// (Заход 2), беседа привязана к вкладке (Заход 3). Тот же приём, что и у поповера перевода
// (см. TranslatePopoverManager.ts): отдельная WebContentsView, добавленная в contentView
// ПОСЛЕДНЕЙ → native z-order (не CSS z-index), поверх уже добавленной вкладки. Bounds контентной
// вкладки НЕ трогаем — панель просто перекрывает правый край страницы, сайт под ней геометрически
// не меняется (как у Яндекса).
import { WebContentsView, ipcMain } from 'electron'
import type { BrowserWindow, IpcMainEvent, WebContents } from 'electron'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import TurndownService from 'turndown'
import { runChatMessage, resolveDirection, buildPrompt } from './TranslationService'
import type { TabState } from '../shared/ipc'
import type { TabManager } from './TabManager'

// html→markdown ТОЛЬКО для ветки чата (см. extractPageText/buildFirstTurnPrompt ниже) —
// перевод (quick-translate) продолжает получать plain text, turndown его не касается.
const turndownService = new TurndownService()

const PANEL_WIDTH = 360
// Держать в синхроне с TOOLBAR_HEIGHT в src/components/Toolbar.tsx — панель начинается СРАЗУ
// ПОД тулбаром (он же кастомный titlebar), не залезает в него. Иначе она перекрывает
// VPN/AI-кнопки и физически блокирует клики по ним: WebContentsView — прямоугольный
// hit-test слой поверх chromeView, у него нет «прозрачности для кликов» по CSS pointer-events
// внутри своей страницы — именно так ранее ломался повторный клик по AI-кнопке (панель сама
// перекрывала кнопку, которой её открыли).
const TOOLBAR_HEIGHT = 56
// Воздух вокруг «плавающего острова» на все стороны (отступ от тулбара/правого края/низа окна) —
// держать в синхроне с GUTTER в src/aipanel.tsx (тот инсетит видимую карточку внутри вьюпорта
// ровно на столько же паддингом). Тот же запас служит зоной под CSS box-shadow «парящей»
// карточки — WebContentsView обрезает всё, что рисуется за границей своего прямоугольника (тот
// же приём, что и SHADOW_MARGIN в TranslatePopoverManager.ts). Сверху жёстко: view.y не может
// быть меньше TOOLBAR_HEIGHT (см. комментарий выше) — справа/снизу больше и не нужно, тень
// физически не может выйти за пределы окна.
const GUTTER = 20

let panelView: WebContentsView | null = null
let attachedWin: BrowserWindow | null = null
let resizeBoundWin: BrowserWindow | null = null
let isOpen = false
let ipcRegistered = false

// Единственный способ достать WebContents активной вкладки без нового кода в TabManager.ts —
// готовый (ранее private, теперь public) TabManager.getActiveWebContents(), см. main.ts::setTabManager.
// Используется ТОЛЬКО для чтения (executeJavaScript извлечения текста, Заход 4) — управление
// вкладками (closeTab/activate/OAuth-окна) этот модуль не трогает и трогать не должен.
let tabManagerRef: TabManager | null = null
export function setTabManager(tm: TabManager): void {
  tabManagerRef = tm
}

// ── Контекст чата по вкладке (Заход 3) ───────────────────────────────────────────────────────
// Один движок (см. runChatMessage/ensureLoaded в TranslationService.ts), много контекстов: тут
// только РАЗДЕЛЕНИЕ истории по вкладкам, а не отдельная модель на вкладку. Эфемерно, только в
// памяти процесса main — без персистентности на диск (как и просили), обнуляется при рестарте
// браузера вместе со всем модулем.
interface ChatMessage { role: 'user' | 'assistant'; text: string }
interface TabChatContext {
  messages: ChatMessage[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  history: any[]  // ChatHistoryItem[] для Qwen (session.setChatHistory в runChatMessage)
  url: string     // последний известный URL вкладки — детектор «сменилась страница»
  // Заход 4: null = ещё не извлекали (извлечём лениво на первое сообщение); '' = извлекли, но
  // пусто/не удалось — тоже НЕ извлекаем повторно, отличать от null через строгую проверку.
  pageText: string | null
  // Markdown-версия ТОГО ЖЕ извлечения (этот заход) — используется только чатом
  // (buildFirstTurnPrompt), quick-translate её не читает. null = либо ещё не извлекали
  // (см. pageText), либо Readability не удалась/html не было — тогда чат берёт pageText как есть.
  pageMarkdown: string | null
}

const tabContexts = new Map<string, TabChatContext>()
let activeTabId: string | null = null
let activeTabUrl = ''
let activeTabTitle = ''

function getOrCreateContext(id: string, url: string): TabChatContext {
  let ctx = tabContexts.get(id)
  if (!ctx) {
    ctx = { messages: [], history: [], url, pageText: null, pageMarkdown: null }
    tabContexts.set(id, ctx)
  }
  return ctx
}

// ── Извлечение текста страницы в контекст чата (Заход 4, Readability — этот заход) ──────────
// Переиспользует ТОТ ЖЕ мост, что и SELECTION_RECT_SCRIPT для поповера перевода (TabManager.ts) —
// executeJavaScript(script, true) на WebContents вкладки. Умный путь: Mozilla Readability (та же
// библиотека, что режим чтения в Firefox) — вычленяет заголовок+тело статьи, отбрасывая
// меню/футер/рекламу/сайдбары. НЕ переписываем эвристику вручную — читаем готовый Readability.js
// с диска и инжектим его ИСХОДНИК прямо в страницу (та же труба executeJavaScript, не отдельный
// jsdom-парсинг в main), выполняем на document.cloneNode(true) — так рекомендует сам README
// библиотеки: parse() мутирует DOM, клон не даёт сломать реальную страницу пользователя.
let readabilitySource: string | null = null
function getReadabilitySource(): string {
  if (readabilitySource === null) {
    readabilitySource = readFileSync(require.resolve('@mozilla/readability/Readability.js'), 'utf-8')
  }
  return readabilitySource
}

// Обязательный порог для фолбэка — АБСОЛЮТНЫЙ (не хватает символов) — не менялся с прошлого захода.
const READABILITY_MIN_CHARS = 200
// ОТНОСИТЕЛЬНЫЙ порог (этот заход): форумы вроде Reddit — Readability формально находит «статью»
// (например, один комментарий + счётчик голосов), абсолютный порог проходит, но это ничтожная доля
// от реального объёма страницы — огрызок вместо содержимого. Если readability-текст короче этой
// доли от полного innerText — тоже считаем, что не справилась. Обе константы — единственное место
// порогов, легко подкрутить.
const READABILITY_MIN_RATIO = 0.15

// Инжектируемый скрипт всегда считает ОБА варианта (readability + весь innerText) — решение, какой
// использовать, и оба порога живут в extractPageText (main), а не зашиты в саму строку скрипта:
// подкручивать READABILITY_MIN_CHARS/RATIO не нужно трогать генерацию скрипта.
// articleHtml (этот заход) — article.content, HTML статьи, который parse() и так вычисляет, но
// раньше просто выбрасывался. readabilityText/fullText — поля прежние, не тронуты.
function buildExtractionScript(): string {
  return `(function(){
    ${getReadabilitySource()}
    var readabilityText = '';
    var articleHtml = '';
    try {
      var docClone = document.cloneNode(true);
      var article = new Readability(docClone).parse();
      readabilityText = (article && article.textContent) ? article.textContent.trim() : '';
      articleHtml = (article && article.content) ? article.content : '';
    } catch (e) { readabilityText = ''; articleHtml = ''; }
    var fullText = document.body ? document.body.innerText : '';
    return { readabilityText: readabilityText, fullText: fullText, articleHtml: articleHtml };
  })()`
}

// Единственное место лимита — легко менять. Длинная страница (тысячи слов) иначе переполнит
// контекст Qwen вместе с историей беседы; обрезаем «в лоб» (начало текста), без суммаризации —
// та тоже в бэклог. Умный контент (Readability) обычно уже заметно короче — мусора меньше, но
// лимит всё равно нужен: длинная статья сама по себе может быть длиннее лимита.
// 28000 симв. ≈ 8-10k токенов — измерено (см. историю задач: ctxdiag-замер), n_ctx сейчас
// 43,520 токенов, свободного VRAM под УВЕЛИЧЕНИЕ n_ctx нет (0.09ГБ), но сам n_ctx уже выделен
// и почти не используется (~2-3%) — расти в рамках уже оплаченного бюджета не стоит VRAM,
// только удлиняет prefill. Оставлен запас на историю чата + системный промпт + ответ модели
// (n_ctx=43520 - text budget здесь ~8-10k ток. = десятки тысяч токенов на диалог).
const PAGE_TEXT_MAX_CHARS = 28000

// Результат извлечения: text — как раньше (readability либо fallback-innerText, обрезан по
// лимиту), markdown — ТОЛЬКО для ветки чата (см. вызовы ниже), null если Readability не удалась
// (fallback) или article.content пуст — тогда чат берёт text как есть, markdown не форсируем.
interface ExtractedPage {
  text: string
  markdown: string | null
}

async function extractPageText(wc: WebContents | null): Promise<ExtractedPage> {
  if (!wc || wc.isDestroyed()) return { text: '', markdown: null }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await wc.executeJavaScript(buildExtractionScript(), true)
    const readabilityText: string = typeof result?.readabilityText === 'string' ? result.readabilityText : ''
    const fullText: string = typeof result?.fullText === 'string' ? result.fullText : ''
    const articleHtml: string = typeof result?.articleHtml === 'string' ? result.articleHtml : ''

    // «Не справилась»: коротко в абсолютных цифрах (пусто/почти пусто) ИЛИ подозрительно мало
    // относительно всего текста страницы (Reddit-кейс — формально не пусто, но огрызок).
    const tooShortAbsolute = readabilityText.length < READABILITY_MIN_CHARS
    const tooShortRelative = fullText.length > 0 && readabilityText.length < fullText.length * READABILITY_MIN_RATIO
    const readabilityFailed = tooShortAbsolute || tooShortRelative

    const text = (readabilityFailed ? fullText : readabilityText).slice(0, PAGE_TEXT_MAX_CHARS)

    // Markdown — только когда Readability реально удалась И html статьи есть. Обрезаем ПОСЛЕ
    // конвертации (markdown чуть длиннее plain text за счёт разметки — лимит должен быть на
    // итоговой строке, не до turndown).
    let markdown: string | null = null
    if (!readabilityFailed && articleHtml) {
      try {
        markdown = turndownService.turndown(articleHtml).trim().slice(0, PAGE_TEXT_MAX_CHARS)
      } catch (e) {
        console.error('[ai-panel] html→markdown упало:', e)
        markdown = null
      }
    }

    if (readabilityFailed) {
      console.log(`[ai-panel] извлечение: fallback (readability слишком мало: ${readabilityText.length} из ${fullText.length}) ${text.length} симв.`)
    } else {
      console.log(`[ai-panel] извлечение: readability ${text.length} симв.` + (markdown ? `, markdown ${markdown.length} симв.` : ', markdown недоступен'))
    }
    return { text, markdown }
  } catch (e) {
    console.error('[ai-panel] извлечение текста страницы упало:', e)
    return { text: '', markdown: null }
  }
}

// Подмешивает текст страницы ТОЛЬКО в первый ход беседы — дальше он остаётся в ctx.history
// (session.getChatHistory() уже включает этот развёрнутый текст первого user-хода), повторные
// вопросы шлют голый userText без повторного дублирования контекста.
function buildFirstTurnPrompt(pageText: string, pageTitle: string, userText: string): string {
  if (!pageText) return userText // извлечь не удалось / пустая страница (напр. хаб) — просто вопрос
  return `The user has a web page open titled "${pageTitle}". Here is its visible text content:\n\n` +
    `"""\n${pageText}\n"""\n\n` +
    `Using that page content as context where relevant, answer the user's message below.\n\n${userText}`
}

// Пушит панели (если открыта и загружена) беседу текущей активной вкладки — чипс страницы +
// накопленные сообщения. Вызывается и при переключении вкладки, и при (пере)открытии панели.
function sendCurrentContext(): void {
  if (!panelView || !activeTabId) return
  const ctx = getOrCreateContext(activeTabId, activeTabUrl)
  panelView.webContents.send('ai-panel:context', {
    tabId: activeTabId, url: activeTabUrl, title: activeTabTitle, messages: ctx.messages,
  })
}

// Единственная точка входа из main.ts — вызывается из УЖЕ существующего onChange (тот, что шлёт
// SYNC_CHANGED в чром), TabManager.ts НЕ трогаем и новых колбэков туда не добавляем. onChange и
// так стреляет на переключение вкладки, навигацию и закрытие — этого достаточно, чтобы вывести
// все три события чисто из снапшота, без новых hook'ов в TabManager.
export function onTabsSynced(tabsSnapshot: TabState[]): void {
  // Закрытые вкладки — их нет в свежем снапшоте: удаляем контекст вместе с ними.
  const liveIds = new Set(tabsSnapshot.map((t) => t.id))
  for (const id of tabContexts.keys()) {
    if (!liveIds.has(id)) tabContexts.delete(id)
  }

  const active = tabsSnapshot.find((t) => t.isActive)
  if (!active) return

  const ctx = getOrCreateContext(active.id, active.url)

  // Смена URL ВНУТРИ уже известной вкладки (не первое появление — при создании контекста url уже
  // совпадает, см. getOrCreateContext) → другая страница, другой разговор. Сброс истории для Qwen
  // И ленты сообщений. Флаг — потому что ниже activeTabUrl тоже перезатирается на active.url, и
  // сравнивать с ним после этой строчки было бы уже не с чем (оба всегда совпадут).
  let urlChanged = false
  if (ctx.url !== active.url) {
    ctx.url = active.url
    ctx.messages = []
    ctx.history = []
    ctx.pageText = null // другая страница — извлечём заново при следующем вопросе (лениво)
    ctx.pageMarkdown = null
    urlChanged = true
  }

  const switched = active.id !== activeTabId
  activeTabId = active.id
  activeTabUrl = active.url
  activeTabTitle = active.title

  // Переключение активной вкладки (или смена её URL) — если панель открыта, показываем актуальную
  // беседу немедленно, а не ждём следующего действия пользователя внутри панели.
  if (switched || urlChanged) sendCurrentContext()
}

function computeBounds(win: BrowserWindow) {
  const { width, height } = win.getContentBounds()
  return {
    x: width - PANEL_WIDTH - GUTTER * 2,
    y: TOOLBAR_HEIGHT,
    width: PANEL_WIDTH + GUTTER * 2,
    height: height - TOOLBAR_HEIGHT,
  }
}

function layoutPanel(): void {
  if (!panelView || !attachedWin) return
  panelView.setBounds(computeBounds(attachedWin))
}

function closePanel(win: BrowserWindow): void {
  if (panelView) win.contentView.removeChildView(panelView)
  isOpen = false
}

// Read-only геометрия для координации с FindBarManager.ts (чтобы FindBar не центрировался под
// открытой AI-панелью — она не двигает bounds контентной вкладки, поэтому FindBar иначе не узнал
// бы, что справа занято). Ничего не меняет в самой панели, только сообщает, сколько px справа
// окна она реально занимает прямо сейчас (0 — если закрыта или для другого окна).
export function getAiPanelReservedWidth(win: BrowserWindow): number {
  return (isOpen && attachedWin === win) ? PANEL_WIDTH + GUTTER * 2 : 0
}

// Регистрируется один раз, лениво — на первое открытие панели, не на старте.
function ensureIpcRegistered(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  // Крестик в шапке панели — свой маленький канал (как у поповера перевода), не shared/ipc.ts:
  // это внутренняя механика панели, а не контракт хром-обвязки.
  ipcMain.on('ai-panel:close', () => {
    if (attachedWin) closePanel(attachedWin)
  })

  // Чат — та же труба, что у поповера: runChatMessage стримит чанки по мере генерации, затем
  // финальный исход. Привязка к вкладке: history/messages читаются и пишутся в контекст ТОЙ
  // вкладки, что была активна в момент отправки (tabId зафиксирован здесь, до await) — если
  // пользователь успеет переключиться на другую вкладку, пока Qwen ещё генерирует, ответ всё
  // равно уйдёт в правильный (фоновый) контекст, а в панель — только если она всё ещё показывает
  // именно эту вкладку к моменту прихода чанка/результата (иначе получился бы чужой текст поверх
  // чужого разговора).
  ipcMain.on('ai-panel:chat-send', (event: IpcMainEvent, text: string) => {
    const wc = event.sender
    const tabId = activeTabId
    if (!tabId) return
    const title = activeTabTitle
    const ctx = getOrCreateContext(tabId, activeTabUrl)
    ctx.messages.push({ role: 'user', text })

    // Извлечение по требованию (Заход 4) — только на первое сообщение ЭТОЙ страницы (pageText
    // ещё null). WebContents страницы захватываем СЕЙЧАС, синхронно, до await: activeTabId точно
    // ещё равен tabId в этот момент, а после await пользователь мог уже переключиться на другую
    // вкладку — getActiveWebContents() тогда вернул бы чужую страницу.
    const needsExtraction = ctx.pageText === null
    const pageWc = needsExtraction ? (tabManagerRef?.getActiveWebContents() ?? null) : null

    void (async () => {
      let promptText = text
      if (needsExtraction) {
        const extracted = await extractPageText(pageWc)
        ctx.pageText = extracted.text
        ctx.pageMarkdown = extracted.markdown
        // Чат получает markdown, когда Readability реально удалась и html был; иначе — тот же
        // plain text, что и раньше (fallback/форумы — markdown не форсируем).
        promptText = buildFirstTurnPrompt(extracted.markdown ?? extracted.text, title, text)
        console.log(`[ai-panel] текст страницы извлечён: ${extracted.text.length} симв. (лимит ${PAGE_TEXT_MAX_CHARS})`)
      }

      const outcome = await runChatMessage(promptText, ctx.history, (chunkText) => {
        if (panelView && panelView.webContents === wc && activeTabId === tabId) {
          wc.send('ai-panel:chat-chunk', chunkText)
        }
      })

      if (outcome.ok) {
        ctx.messages.push({ role: 'assistant', text: outcome.out })
        ctx.history = outcome.history
      }
      if (panelView && panelView.webContents === wc && activeTabId === tabId) {
        wc.send('ai-panel:chat-result', outcome)
      }
    })()
  })

  // Кнопка-подсказка «Перевести» — двунаправленный перевод СТРАНИЦЫ тем же определением
  // языка/направления и тем же шаблоном промпта, что и перевод выделения (resolveDirection/
  // buildPrompt из TranslationService.ts — не новая логика, см. задачу). Отдельный канал (не
  // ai-panel:chat-send с заготовленным текстом): направление известно только ПОСЛЕ извлечения
  // текста и детекции языка, точный src/tgt-промпт строится здесь же, в main — в отличие от
  // Объяснить/Саммари, где текст кнопки одновременно и видимое сообщение, и весь промпт.
  ipcMain.on('ai-panel:quick-translate', (event: IpcMainEvent) => {
    const wc = event.sender
    const tabId = activeTabId
    if (!tabId) return
    const ctx = getOrCreateContext(tabId, activeTabUrl)
    ctx.messages.push({ role: 'user', text: 'Перевести' })

    const needsExtraction = ctx.pageText === null
    const pageWc = needsExtraction ? (tabManagerRef?.getActiveWebContents() ?? null) : null

    void (async () => {
      if (needsExtraction) {
        const extracted = await extractPageText(pageWc)
        ctx.pageText = extracted.text
        ctx.pageMarkdown = extracted.markdown
        console.log(`[ai-panel] текст страницы извлечён: ${ctx.pageText.length} симв. (лимит ${PAGE_TEXT_MAX_CHARS})`)
      }
      // Перевод остаётся на plain text — markdown (ctx.pageMarkdown) сюда намеренно не идёт.
      const pageText = ctx.pageText ?? ''
      // Пустая страница (хаб / извлечение не удалось) — buildPrompt тут неуместен (нечего
      // переводить), просто просим модель ответить без текста-заглушки.
      let promptText = 'Переведи содержимое этой страницы.'
      if (pageText) {
        const { src, tgt } = await resolveDirection('auto', pageText)
        promptText = buildPrompt(src, tgt, pageText)
      }

      const outcome = await runChatMessage(promptText, ctx.history, (chunkText) => {
        if (panelView && panelView.webContents === wc && activeTabId === tabId) {
          wc.send('ai-panel:chat-chunk', chunkText)
        }
      })

      if (outcome.ok) {
        ctx.messages.push({ role: 'assistant', text: outcome.out })
        ctx.history = outcome.history
      }
      if (panelView && panelView.webContents === wc && activeTabId === tabId) {
        wc.send('ai-panel:chat-result', outcome)
      }
    })()
  })
}

// Создаётся лениво на первое открытие — ничего не висит на старте браузера (тот же принцип,
// что и у поповера перевода).
function ensurePanelView(): WebContentsView {
  if (panelView) return panelView
  ensureIpcRegistered()
  panelView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-aipanel.js'),
      contextIsolation: true,
      sandbox: false, // preload использует ipcRenderer
    },
  })
  // Прозрачный фон вида — страница сама красит себя в токен темы (см. aipanel.tsx), без
  // риска мигнуть белым мимо текущей темы (светлой/тёмной) до применения CSS.
  panelView.setBackgroundColor('#00000000')
  // Первый показ беседы активной вкладки — только после did-finish-load: раньше renderer ещё не
  // навесил обработчик onContext, сообщение потерялось бы.
  panelView.webContents.once('did-finish-load', () => sendCurrentContext())

  // Ссылки из ответа модели — обычные <a href> (react-markdown их не оборачивает, см. задачу):
  // без перехвата клик навигирует ЭТУ ЖЕ webContents на внешний сайт, затирая aipanel.html —
  // UI панели (крестик/поле ввода) исчезает вместе с разметкой, закрыть панель после этого нечем.
  // У панели нет собственной навигации, поэтому ЛЮБАЯ внешняя http(s)-ссылка должна уйти в
  // обычную вкладку Oblako, а не остаться внутри панели. Свою же загрузку (oblako-chrome://...
  // aipanel.html) пропускаем — иначе сломаем первичную загрузку/возможный релоад панели.
  // Отдельно и независимо от TabManager.wirePageEvents/isOAuthPopup (OAuth-поток обычных вкладок
  // тут не участвует — panelView никогда не проходит через wirePageEvents).
  panelView.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('oblako-chrome://')) return // легитимная (пере)загрузка самой панели
    if (/^https?:\/\//i.test(url)) {
      e.preventDefault()
      tabManagerRef?.createTab(url)
    }
  })
  // Страховка на случай target=_blank/window.open в тексте ответа (не обычная навигация, а
  // запрос нового окна) — тот же исход: новая вкладка Oblako, Chromium своё окно не создаёт.
  panelView.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) tabManagerRef?.createTab(url)
    return { action: 'deny' }
  })

  panelView.webContents.loadURL('oblako-chrome://localhost/aipanel.html')
  return panelView
}

// Тоггл по клику кнопки AI в тулбаре — возвращает новое состояние (true = открыта).
export function toggleAiPanel(win: BrowserWindow): boolean {
  attachedWin = win
  if (resizeBoundWin !== win) {
    win.on('resize', layoutPanel)
    resizeBoundWin = win
  }

  if (isOpen) {
    closePanel(win)
    return false
  }

  const alreadyLoaded = panelView !== null // false только на самый первый показ панели вообще
  const view = ensurePanelView()
  view.setBounds(computeBounds(win))
  win.contentView.addChildView(view) // последней → поверх вкладки, а не под ней
  isOpen = true
  // При повторном открытии (view уже когда-то загрузился) did-finish-load больше не сработает —
  // шлём текущий контекст явно, чтобы панель не показывала последнюю беседу «протухшей» вкладки.
  if (alreadyLoaded) sendCurrentContext()
  return true
}
