// Правая AI-панель — оверлей поверх контента (Заход 1: каркас/дизайн), рабочий чат с Qwen
// (Заход 2), беседа привязана к вкладке (Заход 3). Тот же приём, что и у поповера перевода
// (см. TranslatePopoverManager.ts): отдельная WebContentsView, добавленная в contentView
// ПОСЛЕДНЕЙ → native z-order (не CSS z-index), поверх уже добавленной вкладки. Bounds контентной
// вкладки НЕ трогаем — панель просто перекрывает правый край страницы, сайт под ней геометрически
// не меняется (как у Яндекса).
import { WebContentsView, ipcMain } from 'electron'
import type { BrowserWindow, IpcMainEvent, WebContents } from 'electron'
import path from 'node:path'
import TurndownService from 'turndown'
import { composeFactsCard, factsAreUseful, type PageFacts } from './pageFacts'
import { PAGE_TEXT_MAX_CHARS, buildExtractionScript } from './pageTextScript'
import { TRANSCRIPT_SCRIPT, composeTranscript, isVideoPage } from './videoTranscript'
import { setPanelViews, sendPanelStatuses } from './aipanel/panelStatus'
import {
  anyPanelOpen, chromeOf, existingPanel, panelBySender, panelFor,
  panelViews, tabsOf, type PanelInstance,
} from './aipanel/instances'
import { registerWebAppChannels } from './aipanel/webAppBridge'
import { sendCurrentContext, syncTabChat, registerTabChatIpc, wireTabChat } from './aipanel/tabChat'
import { getCurrencyRates } from './CurrencyRates'
import { getWeather } from './WeatherService'
import * as webApps from './WebAppManager'
import { IPC, type TabState } from '../shared/ipc'
import type { TabManager } from './TabManager'
import { contextFromSender } from './WindowRegistry'
import type { SettingsManager } from './SettingsManager'

// html→markdown ТОЛЬКО для ветки чата (см. extractPageText/buildFirstTurnPrompt ниже) —
// перевод (quick-translate) продолжает получать plain text, turndown его не касается.
const turndownService = new TurndownService()
// Медиа-узлы вырезаем целиком (не дефолтное <img>→![alt](src)) — иначе картинки из тела статьи
// утекают в промпт Qwen как markdown-синтаксис, модель их цитирует в ответе, а react-markdown в
// пузыре рендерит реальный <img> (текстовая модель картинок не генерит — они физически из
// извлечения). .remove() — штатный приём Turndown выкинуть узел целиком (замена на '', не на
// текстовое содержимое). 'a' НЕ трогаем — текстовые ссылки в статье остаются осмысленными для
// саммари, режем только чистый медиа-контент (img/picture — обёртка над img для responsive-разметки/
// svg — инлайн-векторная графика, тот же случай, что и img). Предикат, не массив тегов: 'svg' не
// входит в HTMLElementTagNameMap (Turndown.TagName — HTML-only), массив ['img','picture','svg'] не
// типизируется.
turndownService.remove((node) => ['img', 'picture', 'svg'].includes(node.nodeName.toLowerCase()))

// Заход 3: из поповера — в правый split-view-подобный док (тянется за левый край, см. App.tsx).
// Ширина больше не константа — мутабельная, персистится через SettingsManager (как hubMode).
let panelWidth = 360
const AI_PANEL_WIDTH_MIN = 300
const AI_PANEL_WIDTH_MAX = 640
function clampPanelWidth(w: number): number {
  return Math.max(AI_PANEL_WIDTH_MIN, Math.min(AI_PANEL_WIDTH_MAX, w))
}
// Держать в синхроне с TOOLBAR_HEIGHT в src/components/Toolbar.tsx — панель начинается СРАЗУ
// ПОД тулбаром (он же кастомный titlebar), не залезает в него. Иначе она перекрывает
// VPN/AI-кнопки и физически блокирует клики по ним: WebContentsView — прямоугольный
// hit-test слой поверх chromeView, у него нет «прозрачности для кликов» по CSS pointer-events
// внутри своей страницы — именно так ранее ломался повторный клик по AI-кнопке (панель сама
// перекрывала кнопку, которой её открыли).
const TOOLBAR_HEIGHT = 56

// ⚠️ Состояние панели — ПООКОННОЕ (см. aipanel/instances.ts): вью, флаг показа и привязка к
// resize принадлежат конкретному окну. Здесь остаётся только общее на приложение — однократная
// регистрация обработчиков IPC.
let ipcRegistered = false

// Аналог TabManager-ref ниже — тем же путём (main.ts::setSettingsManager после инстанцирования)
// прокидывается ссылка на единственный SettingsManager, чтобы персистить ширину дока при драге.
let settingsRef: SettingsManager | null = null
export function setSettingsManager(sm: SettingsManager): void {
  settingsRef = sm
  panelWidth = clampPanelWidth(sm.getAiPanelWidth())
}

// Используется ТОЛЬКО для чтения (executeJavaScript извлечения текста) — управление
// вкладками этот модуль не трогает.
export function setTabManager(tm: TabManager): void {
  wireTabChat({
    extractPageText,
    buildFirstTurnPrompt,
    pageWcOf: (tabId) => tm.getActiveWebContents(tabId),
  })
  // Фокус ушёл в сайт веб-слота — сообщаем панели, какой слот стал активным. Панель сама этого не
  // видит: сайт лежит поверх неё отдельной вью и её событий не порождает (см. WebAppManager).
  webApps.setOnWebAppFocus((win, appId) => {
    // ⚠️ Адресно, панели ТОГО ЖЕ окна: слоты пооконные, и рамку активного слота обязана
    // нарисовать та панель, в чьей дырке лежит сайт, а не все сразу.
    const view = existingPanel(win)?.view
    if (view && !view.webContents.isDestroyed()) {
      view.webContents.send('ai-panel:webapp-focused', appId)
    }
  })
}

// Заход 3: push'и состояния дока идут в chrome (React-хром), а не в win.webContents — это разные
// вещи. win — это ОС-окно, chrome (сайдбар/тулбар/App.tsx) — свой WebContentsView-слой поверх
// него (см. main.ts::chromeView), как и вкладки/AI-панель/поповеры — все они просто дети одного
// win.contentView, а не webContents самого win. win.webContents.send(...) уходит в НИЧЕМ не
// обслуживаемый дефолтный webContents окна — chrome его никогда не получит. Тот же приём, что
// main.ts уже использует для ADBLOCK_STATE_CHANGED/DOWNLOADS_CHANGED/SYNC_CHANGED и т.п.
// (chromeView?.webContents.send(...), не win.webContents.send(...)).
// Кто есть кто (панель окна, её слой хрома, её вкладки) — в aipanel/instances.ts.

// Прогрев модели по намерению поговорить (см. ai-panel:chat-intent ниже). Политику прогрева
// (режим загрузки, наличие модели, отсрочка) знает main — сюда приходит только готовый колбэк,
// тем же приёмом, что setGraphMenuBuilder у TabManager: панель не должна знать про ModelRegistry.
let onChatIntentCb: (() => void) | null = null
export function setOnChatIntent(cb: () => void): void {
  onChatIntentCb = cb
}

// Состояние локальной модели для плашки страницы («в памяти» / «готова» / «нет модели»).
//
// ⚠️ Провайдер приходит ИЗ MAIN, а не читается здесь: панель про ModelRegistry и TranslationService
// не знает и знать не должна — тот же приём, что у setOnChatIntent выше. Иначе панельный модуль
// потянул бы за собой реестр моделей ради одной подписи.
//
// ⚠️ «Готова» и «в памяти» — РАЗНЫЕ состояния, и склеивать их нельзя: дефолт назначен — модель
// ответит, но с паузой на загрузку; поднята в VRAM — ответит сразу. Это единственное объяснение,
// почему первый ответ думает полминуты, а следующий мгновенно, и до сих пор его не было нигде,
// кроме раздела настроек, куда во время разговора не ходят.
export interface PanelModelState {
  /** Имя модели по умолчанию; null — модели нет вовсе. */
  label: string | null
  /** Она же поднята в память прямо сейчас. */
  loaded: boolean
}
let modelStateProvider: (() => PanelModelState) | null = null
export function setModelStateProvider(cb: () => PanelModelState): void {
  modelStateProvider = cb
}

// Человек кликнул В САМУ ПАНЕЛЬ — поповеры тулбара пора закрыть.
//
// ⚠️ Нужен отдельный сигнал, потому что «клик мимо» слушает слой хрома, а панель — отдельная
// нативная вью: её клики до хрома не доходят ВООБЩЕ. Ровно та же причина, по которой клик по
// странице закрывает поповеры не сам, а через onContentFocus в TabManager (см. main.ts). Без
// этого поповер оставался висеть над панелью, и привычное «щёлкнуть мимо» просто не работало.
//
// ⚠️ Слушаем `focus` вью, а не blur кого-то другого: focus ДРУГОГО webContents — это настоящий
// OS-фокус от клика, а blur в этом проекте запрещён как механика закрытия (Electron шлёт
// focus→blur парой после addChildView, см. FindBarManager).
let onPanelFocusCb: (() => void) | null = null
export function setOnPanelFocus(cb: () => void): void {
  onPanelFocusCb = cb
}

// ── Извлечение текста страницы ───────────────────────────────────────────────
//
// Обязательный порог для фолбэка — АБСОЛЮТНЫЙ (не хватает символов) — не менялся с прошлого захода.
const READABILITY_MIN_CHARS = 200
// ОТНОСИТЕЛЬНЫЙ порог (этот заход): форумы вроде Reddit — Readability формально находит «статью»
// (например, один комментарий + счётчик голосов), абсолютный порог проходит, но это ничтожная доля
// от реального объёма страницы — огрызок вместо содержимого. Если readability-текст короче этой
// доли от полного innerText — тоже считаем, что не справилась. Обе константы — единственное место
// порогов, легко подкрутить.
const READABILITY_MIN_RATIO = 0.15



// Результат извлечения: text — как раньше (readability либо fallback-innerText, обрезан по
// лимиту), markdown — ТОЛЬКО для ветки чата (см. вызовы ниже), null если Readability не удалась
// (fallback) или article.content пуст — тогда чат берёт text как есть, markdown не форсируем.
//
// ⚠️ ok отличает НЕУДАЧУ от честно пустой страницы, и это различие несущее. Пустой text даёт и
// то и другое, а поступать с ними надо по-разному: пустую страницу можно запомнить и больше не
// трогать, а неудачу — обязательно повторить. Без этого признака одна осечка (страница ещё не
// загрузилась, вкладка спала, скрипт упал) запоминалась НАВСЕГДА: pageText переставал быть null,
// повторное извлечение больше не запускалось, и модель до конца жизни этой страницы отвечала
// без неё. Живой симптом: «ИИ отвечает, но страницы будто не видит», сам собой проходило после
// перехода на другой адрес — там контекст сбрасывается целиком.
export interface ExtractedPage {
  /** false — извлечь не удалось (нет живой страницы или скрипт упал). Такой результат не кэшируем. */
  ok: boolean
  text: string
  markdown: string | null
}

// Экспортирована для HistoryIndexer.ts (заход на обогащение эмбеддинга истории контентом
// страницы) — тот же пайплайн Readability, без дублирования. Сама функция не менялась.
export async function extractPageText(wc: WebContents | null): Promise<ExtractedPage> {
  if (!wc || wc.isDestroyed()) {
    // Живой страницы нет: вкладка спит, ещё грузится, это хаб или псевдо-вкладка. Не «пусто», а
    // «пока неоткуда взять» — вызывающий обязан попробовать снова на следующем вопросе.
    console.warn('[ai-panel] извлечение пропущено: у активной вкладки нет живой страницы')
    return { ok: false, text: '', markdown: null }
  }
  try {
    // Страница ролика: содержание лежит в субтитрах, а Readability возьмёт описание и
    // комментарии. Пробуем расшифровку ПЕРВОЙ; не вышло — идём обычным путём, потому что
    // субтитров у ролика может не быть вовсе.
    if (isVideoPage(wc.getURL())) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = await wc.executeJavaScript(TRANSCRIPT_SCRIPT, true)
      if (res?.ok && Array.isArray(res.lines) && res.lines.length) {
        const text = composeTranscript({
          title: String(res.title ?? ''),
          channel: String(res.channel ?? ''),
          lines: res.lines as { t: string; text: string }[],
        }).slice(0, PAGE_TEXT_MAX_CHARS)
        console.log(`[ai-panel] извлечение: расшифровка видео, ${res.lines.length} строк, ${text.length} симв.`)
        return { ok: true, text, markdown: null }
      }
      console.log(`[ai-panel] расшифровка недоступна (${res?.reason ?? 'нет ответа'}) — обычное извлечение`)
    }

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

    // Карточка фактов идёт ПЕРЕД прозой: лимит режет хвост, и факты обязаны быть в начале,
    // иначе их срежет первыми — ровно та проблема, из-за которой в модель уезжали отзывы.
    const facts: PageFacts | null = result?.facts ?? null
    const card = facts && factsAreUseful(facts) ? composeFactsCard(facts) : ''
    const prose = readabilityFailed ? fullText : readabilityText
    const text = (card ? `${card}

${prose}` : prose).slice(0, PAGE_TEXT_MAX_CHARS)

    // Markdown — только когда Readability реально удалась И html статьи есть. Обрезаем ПОСЛЕ
    // конвертации (markdown чуть длиннее plain text за счёт разметки — лимит должен быть на
    // итоговой строке, не до turndown).
    let markdown: string | null = null
    if (!readabilityFailed && articleHtml) {
      try {
        const body = turndownService.turndown(articleHtml).trim()
        markdown = (card ? `${card}

${body}` : body).slice(0, PAGE_TEXT_MAX_CHARS)
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
    if (facts && card) {
      console.log(`[ai-panel] факты: ${facts.kind ?? 'без типа'}, характеристик ${facts.specs.length}, отзывов вырезано ${facts.removedReviewChars} симв.`)
    }
    return { ok: true, text, markdown }
  } catch (e) {
    console.error('[ai-panel] извлечение текста страницы упало:', e)
    return { ok: false, text: '', markdown: null }
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

// Пушит панели беседу активной вкладки — реализация в aipanel/tabChat.ts.

// Статусы приложения (ключ фактчека, веб-поиск, скиллы, подключения) панели получают из
// aipanel/panelStatus.ts — там же лежат и подписки на их изменение. Адресаты — ВСЕ живые панели:
// это состояние приложения, а не окна.
setPanelViews(panelViews)

// Единственная точка входа из main.ts — вызывается из УЖЕ существующего onChange (тот, что шлёт
// SYNC_CHANGED в чром), TabManager.ts НЕ трогаем и новых колбэков туда не добавляем. onChange и
// так стреляет на переключение вкладки, навигацию и закрытие — этого достаточно, чтобы вывести
// все три события чисто из снапшота, без новых hook'ов в TabManager.
export function onTabsSynced(tabsSnapshot: TabState[]): void {
  syncTabChat(tabsSnapshot)
}

// Заход 3: док пристыкован (flush) к правому краю окна — ширина ровно равна тому, что chrome
// зарезервировал под него в App.tsx (никакого лишнего зазора вокруг, как было у поповера).
// Внутренний «остров» (скруглённые углы, тень) рисует сама aipanel.tsx своим паддингом
// (GUTTER там же) — bounds самой WebContentsView этого не касаются.
function computeBounds(win: BrowserWindow) {
  const { width, height } = win.getContentBounds()
  return {
    x: width - panelWidth,
    y: TOOLBAR_HEIGHT,
    width: panelWidth,
    height: height - TOOLBAR_HEIGHT,
  }
}

function layoutPanel(st: PanelInstance): void {
  if (!st.view || st.win.isDestroyed()) return
  st.view.setBounds(computeBounds(st.win))
}

// Единственное место, где меняется isOpen — гарантирует, что chrome (App.tsx) узнаёт о
// закрытии/открытии НЕЗАВИСИМО от того, что его вызвало (крестик/Escape внутри панели,
// тоггл в тулбаре, будущие пути). Раньше isOpen менялся напрямую в двух местах — крестик/Escape
// не долетали до chrome (свой ad-hoc ai-panel:close, не трогает окно), из-за чего резерв
// ширины в App.tsx оставался висеть после закрытия панели не через тулбар.
function setOpenState(st: PanelInstance, open: boolean): void {
  st.open = open
  chromeOf(st.win)?.send(IPC.AI_PANEL_STATE_CHANGED, open)
}

function closePanel(st: PanelInstance): void {
  webApps.setPanelVisible(st.win, false) // веб-слоты прячутся вместе с панелью (но живут в памяти)
  if (st.view) st.win.contentView.removeChildView(st.view)
  setOpenState(st, false)
  // Панель забирала фокус при открытии (см. toggleAiPanel) — отдаём его обратно странице, иначе
  // после закрытия им не владеет никто и клавиатура молчит уже на самой странице. Тот же возврат
  // делает FindBar при закрытии.
  tabsOf(st.win)?.focusActiveView()
}

// Живой ресайз — драг разделителя в App.tsx шлёт сюда каждый тик (ad-hoc ai-panel:resize,
// см. ensureIpcRegistered). Клампит, применяет bounds немедленно, персистит через
// SettingsManager (та же частота записи, что и у остальных простых настроек — редко и вручную,
// без дебаунса, см. комментарий в SettingsManager.ts).
export function resizeAiPanel(win: BrowserWindow, widthPx: number): void {
  panelWidth = clampPanelWidth(widthPx)
  const st = existingPanel(win)
  if (st?.open && st.view) st.view.setBounds(computeBounds(win))
  settingsRef?.setAiPanelWidth(panelWidth)
}

// Открыта ли панель хоть в каком-нибудь окне. Нужно политике выгрузки модели (ModelIdleWatcher):
// пока человек в диалоге, пауза между вопросами не значит, что диалог кончился, — а выгрузка
// стоила бы ему тридцати секунд ожидания на следующем сообщении.
export function isAiPanelOpen(): boolean {
  return anyPanelOpen()
}

// Read-only геометрия для координации с FindBarManager.ts (чтобы FindBar не центрировался под
// открытым доком). Сообщает, сколько px справа окна он реально занимает прямо сейчас (0 — если
// закрыт или для другого окна).
export function getAiPanelReservedWidth(win: BrowserWindow): number {
  return existingPanel(win)?.open ? panelWidth : 0
}

// Регистрируется один раз, лениво — на первое открытие панели, не на старте.
function ensureIpcRegistered(): void {
  if (ipcRegistered) return
  ipcRegistered = true
  // Крестик в шапке панели — свой маленький канал (как у поповера перевода), не shared/ipc.ts:
  // это внутренняя механика панели, а не контракт хром-обвязки.
  ipcMain.on('ai-panel:close', (event: IpcMainEvent) => {
    const st = panelBySender(event.sender)
    if (st) closePanel(st)
  })

  // Человек встал в поле ввода чата. ⚠️ Прогрев модели повешен ИМЕННО СЮДА, а не на открытие
  // панели: замерено, что загрузка Qwen блокирует main ~900 мс всплесками (284–433 мс подряд),
  // и человек, открывший панель ради приложений или конвертера, платил эту секунду ни за что —
  // ровно на ней и спотыкался переход «чат → приложения» сразу после запуска браузера.
  ipcMain.on('ai-panel:chat-intent', () => {
    onChatIntentCb?.()
  })

  // ⚠️ Драг разделителя приходит из СЛОЯ ХРОМА (App.tsx), а не из самой панели, — окно ищется
  // не по panelBySender, а обычным путём реестра. BrowserWindow.fromWebContents тут не годится:
  // хром — дочерняя вью, для неё Electron возвращает null (см. WindowRegistry.contextFromSender).
  ipcMain.on('ai-panel:resize', (event: IpcMainEvent, widthPx: number) => {
    const win = contextFromSender(event.sender)?.win
    if (win) resizeAiPanel(win, widthPx)
  })

  // Чат / перевод / фактчек — aipanel/tabChat.ts: ответ пишется во вкладку, с которой спросили.
  registerTabChatIpc()

  // Клик по глобусу, когда SearXNG не настроен — вкладка настроек, панель не закрывается.
  ipcMain.on('ai-panel:open-settings', (event: IpcMainEvent, section?: string) => {
    const st = panelBySender(event.sender)
    if (st) tabsOf(st.win)?.createSpecialTab('settings', section)
  })

  // Курсы валют для конвертера раздела «Приложения» (aiApps.tsx) — invoke/handle, не пуш:
  // данные нужны только по заходу пользователя в категорию «Валюты», рассылать их каждому
  // открытию панели незачем. Сам fetch и кэш — CurrencyRates.ts, здесь только труба.
  // Состояние модели для плашки. Pull, а не push: подпись нужна ровно тогда, когда панель
  // открыта и рисует плашку, а событий «модель поднялась» в проекте нет (getLoadedModelId чисто
  // pull — см. ModelsSection.tsx).
  ipcMain.handle('ai-panel:model-state', (): PanelModelState => (
    modelStateProvider ? modelStateProvider() : { label: null, loaded: false }
  ))
  ipcMain.handle('ai-panel:currency-rates', () => getCurrencyRates())

  // Погода для виджета «Приложений» — та же схема, что курсы выше (fetch/кэш в WeatherService.ts).
  ipcMain.handle('ai-panel:weather', (_event, city: unknown) => getWeather(typeof city === 'string' ? city : ''))

  // Веб-приложения раздела «Приложения» — четыре канала в aipanel/webAppBridge.ts. Отсюда
  // туда уходит ТОЛЬКО геометрия: угол панели в координатах окна знает этот модуль (ширина дока
  // и высота тулбара), а сами слоты — WebAppManager.
  registerWebAppChannels((win) => ({
    x: win.getContentBounds().width - panelWidth,
    y: TOOLBAR_HEIGHT,
  }))
}

// Создаётся лениво на первый вызов (клик по кнопке AI ЛИБО фоновый прогрев — см. prewarmPanel
// ниже, main.ts вызывает его заранее после показа окна). Идемпотентна — повторный вызов (в
// т.ч. из toggleAiPanel на реальном клике после прогрева) просто возвращает уже готовый view.
function ensurePanelView(st: PanelInstance): WebContentsView {
  if (st.view) return st.view
  ensureIpcRegistered()
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-aipanel.js'),
      contextIsolation: true,
      sandbox: false, // preload использует ipcRenderer
    },
  })
  // Прозрачный фон вида — страница сама красит себя в токен темы (см. aipanel.tsx), без
  // риска мигнуть белым мимо текущей темы (светлой/тёмной) до применения CSS.
  view.setBackgroundColor('#00000000')
  // Первый показ беседы активной вкладки — только после did-finish-load: раньше renderer ещё не
  // навесил обработчик onContext, сообщение потерялось бы. Статус ключа — тем же приёмом.
  view.webContents.once('did-finish-load', () => { sendCurrentContext(); sendPanelStatuses() })

  // Клик в панель = «мимо поповера тулбара», см. setOnPanelFocus выше.
  view.webContents.on('focus', () => { onPanelFocusCb?.() })

  // Ссылки из ответа модели — обычные <a href> (react-markdown их не оборачивает, см. задачу):
  // без перехвата клик навигирует ЭТУ ЖЕ webContents на внешний сайт, затирая aipanel.html —
  // UI панели (крестик/поле ввода) исчезает вместе с разметкой, закрыть панель после этого нечем.
  // У панели нет собственной навигации, поэтому ЛЮБАЯ внешняя http(s)-ссылка должна уйти в
  // обычную вкладку Oblako, а не остаться внутри панели. Свою же загрузку (oblako-chrome://...
  // aipanel.html) пропускаем — иначе сломаем первичную загрузку/возможный релоад панели.
  // Отдельно и независимо от TabManager.wirePageEvents/isOAuthPopup (OAuth-поток обычных вкладок
  // тут не участвует — вью панели никогда не проходит через wirePageEvents).
  view.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('oblako-chrome://')) return // легитимная (пере)загрузка самой панели
    if (/^https?:\/\//i.test(url)) {
      e.preventDefault()
      tabsOf(st.win)?.createTab(url)
    }
  })
  // Страховка на случай target=_blank/window.open в тексте ответа (не обычная навигация, а
  // запрос нового окна) — тот же исход: новая вкладка Oblako, Chromium своё окно не создаёт.
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) tabsOf(st.win)?.createTab(url)
    return { action: 'deny' }
  })

  // .catch — loadURL асинхронный, без обработчика упавший промис ушёл бы в unhandledRejection
  // молча (раньше это было не критично: единственный вызывающий, клик пользователя, всё равно
  // увидел бы пустую панель и мог попробовать снова). Теперь ensurePanelView зовётся ЕЩЁ и из
  // фонового прогрева (prewarmPanel, без пользователя на экране) — там сбой обязан хотя бы
  // залогироваться, иначе первый клик по AI тихо откатится к прежнему ленивому пути без объяснения.
  // ⚠️ Документ ОДИН на оба вида, разводит их параметр адреса: renderer по нему решает, собирать
  // ли дерево с чатом (см. src/aipanel.tsx::APPS_ONLY). Второй html-вход и второй бандл были бы
  // второй копией одного и того же острова — расходиться они начали бы на первой же правке.
  const url = 'oblako-chrome://localhost/aipanel.html' + (st.kind === 'apps' ? '?kind=apps' : '')
  view.webContents.loadURL(url)
    .catch((e) => console.error('[ai-panel] loadURL упал:', e))
  st.view = view
  return view
}

// Фоновый прогрев — вызывается ЗАРАНЕЕ (main.ts, после показа окна, с задержкой), ДО первого
// клика по кнопке AI. Только создание WebContentsView + запуск loadURL — НЕ показывает панель
// (никакого setBounds/addChildView/setOpenState, это исключительно дело toggleAiPanel). Пуши
// did-finish-load (sendCurrentContext/sendPanelStatuses) уйдут в ещё не показанную панель — это
// безвредно (она просто копит состояние в невидимом renderer'е), а toggleAiPanel при реальном
// открытии всё равно шлёт их заново (см. ветку alreadyLoaded ниже) — устаревший на момент
// прогрева контекст никогда не остаётся показанным пользователю.
// Не бросает наружу — тот же приём, что warmupTranslation в main.ts: сбой прогрева
// не должен ронять старт браузера, в худшем случае первый клик по AI останется таким же ленивым,
// как до этого коммита.
export function prewarmPanel(win: BrowserWindow): void {
  try {
    ensurePanelView(panelFor(win))
  } catch (e) {
    console.error('[ai-panel] прогрев упал:', e)
  }
}

// Тоггл по клику кнопки AI в тулбаре — возвращает новое состояние (true = открыта).
// Открыть панель на конкретном приложении — вход с иконки рабочего стола новой вкладки.
// ⚠️ Панель может быть закрыта, только что созданной или уже открытой: во всех трёх случаях
// сообщение шлём ПОСЛЕ того, как вью существует, иначе первый клик по иконке уходил бы в никуда.
export function openAiPanelApp(win: BrowserWindow, appId: string): void {
  const st = panelFor(win)
  if (!st.open) toggleAiPanel(win)
  const view = ensurePanelView(st)
  const send = (): void => {
    if (!view.webContents.isDestroyed()) view.webContents.send('ai-panel:open-app', appId)
  }
  if (view.webContents.isLoading()) view.webContents.once('did-finish-load', send)
  else send()
}

export function toggleAiPanel(win: BrowserWindow): boolean {
  const st = panelFor(win)
  // ⚠️ Слушатель resize вешается ОДИН раз на окно и двигает панель ИМЕННО ЭТОГО окна: раньше он
  // переезжал вместе с единственной панелью, и окно, из которого она ушла, продолжало её двигать.
  if (!st.resizeBound) {
    win.on('resize', () => layoutPanel(st))
    st.resizeBound = true
  }

  if (st.open) {
    closePanel(st)
    return false
  }

  const alreadyLoaded = st.view !== null // false только на самый первый показ панели этого окна
  const view = ensurePanelView(st)
  view.setBounds(computeBounds(win))
  win.contentView.addChildView(view) // последней → поверх вкладки, а не под ней
  // Веб-слоты — ПОСЛЕ панели: их view должны лечь поверх неё (в дырки), см. WebAppManager.
  webApps.setPanelVisible(win, true)
  setOpenState(st, true)
  // При повторном открытии (view уже когда-то загрузился) did-finish-load больше не сработает —
  // шлём текущий контекст явно, чтобы панель не показывала последнюю беседу «протухшей» вкладки.
  if (alreadyLoaded) { sendCurrentContext(); sendPanelStatuses() }
  // ⚠️ Явный фокус на вью панели — обязателен, и это тот же закон, что у запуска приложения и у
  // FindBar: добавление вью в окно НЕ делает её владельцем фокуса, им продолжает владеть страница.
  // Живой случай: открыл панель кнопкой, нажал Esc — ничего, потому что Esc уходил странице, а не
  // панели; сначала приходилось кликнуть внутрь. Клавиатура обязана работать сразу после открытия.
  view.webContents.focus()
  return true
}
