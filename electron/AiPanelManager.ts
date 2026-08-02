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
import { PAGE_FACTS_SCRIPT, composeFactsCard, factsAreUseful, type PageFacts } from './pageFacts'
import { TRANSCRIPT_SCRIPT, composeTranscript, isVideoPage } from './videoTranscript'
import { runChatMessage, resolveDirection, buildPrompt } from './TranslationService'
import { runFactCheck } from './GeminiFactCheck'
import { searxngSearch, buildGroundingPrompt, appendSearxngSources } from './SearxngSearch'
import * as aiKeyStore from './AiKeyStore'
import * as searxngKeyStore from './SearxngKeyStore'
import * as skillsStore from './SkillsStore'
import { getCurrencyRates } from './CurrencyRates'
import { getWeather } from './WeatherService'
import * as webApps from './WebAppManager'
import { IPC } from '../shared/ipc'
import type { TabState } from '../shared/ipc'
import type { TabManager } from './TabManager'
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

let panelView: WebContentsView | null = null
let attachedWin: BrowserWindow | null = null
let resizeBoundWin: BrowserWindow | null = null
let isOpen = false
let ipcRegistered = false

// Аналог TabManager-ref ниже — тем же путём (main.ts::setSettingsManager после инстанцирования)
// прокидывается ссылка на единственный SettingsManager, чтобы персистить ширину дока при драге.
let settingsRef: SettingsManager | null = null
export function setSettingsManager(sm: SettingsManager): void {
  settingsRef = sm
  panelWidth = clampPanelWidth(sm.getAiPanelWidth())
}

// Единственный способ достать WebContents активной вкладки без нового кода в TabManager.ts —
// готовый (ранее private, теперь public) TabManager.getActiveWebContents(), см. main.ts::setTabManager.
// Используется ТОЛЬКО для чтения (executeJavaScript извлечения текста, Заход 4) — управление
// вкладками (closeTab/activate/OAuth-окна) этот модуль не трогает и трогать не должен.
let tabManagerRef: TabManager | null = null
export function setTabManager(tm: TabManager): void {
  tabManagerRef = tm
  // Форвард в WebAppManager (веб-приложения раздела «Приложения») — чтобы main.ts не пришлось
  // знать о ещё одном модуле: window.open из веб-слота уходит обычной вкладкой через тот же tm.
  webApps.setTabManager(tm)
}

// Заход 3: push'и состояния дока идут в chrome (React-хром), а не в win.webContents — это разные
// вещи. win — это ОС-окно, chrome (сайдбар/тулбар/App.tsx) — свой WebContentsView-слой поверх
// него (см. main.ts::chromeView), как и вкладки/AI-панель/поповеры — все они просто дети одного
// win.contentView, а не webContents самого win. win.webContents.send(...) уходит в НИЧЕМ не
// обслуживаемый дефолтный webContents окна — chrome его никогда не получит. Тот же приём, что
// main.ts уже использует для ADBLOCK_STATE_CHANGED/DOWNLOADS_CHANGED/SYNC_CHANGED и т.п.
// (chromeView?.webContents.send(...), не win.webContents.send(...)).
let chromeViewRef: WebContentsView | null = null
export function setChromeView(view: WebContentsView): void {
  chromeViewRef = view
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
let activeTabFavicon: string | null = null

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
    ${PAGE_FACTS_SCRIPT}

    // Сначала факты — по НЕТРОНУТОМУ документу: чистка ниже могла бы задеть разметку,
    // из которой они читаются.
    var facts;
    try { facts = __oblakoCollectFacts(); } catch (e) { facts = null; }

    // Затем клон БЕЗ блоков отзывов. Это ключевая часть: на карточке товара отзывы длиннее
    // описания, и Readability уверенно выбирает именно их — не проваливаясь, поэтому прежний
    // фолбэк не срабатывал. Режем на клоне, живую страницу пользователя не трогаем.
    var removedChars = 0;
    var readabilityText = '';
    var articleHtml = '';
    try {
      // Помечаем находки атрибутом и клонируем СРАЗУ, без единого await между: так метки
      // переезжают на клон вместе с узлами. Раньше здесь был перенос по индексному пути от
      // корня — и он ломался: после первого же удаления индексы соседей съезжали, и остальные
      // пути вели не туда, из-за чего блок отзывов выживал целиком.
      //
      // ⚠️ Страховка от жадности ниже: если после чистки от страницы почти ничего не
      // осталось, значит эвристика зацепила само содержимое (бывает на нестандартной
      // вёрстке) — тогда честнее вернуть неочищенный текст, чем отдать модели огрызок.
      var marked = [];
      try {
        marked = __oblakoJunkNodes();
        for (var i = 0; i < marked.length; i++) marked[i].setAttribute('data-oblako-junk', '1');
      } catch (e) { marked = []; }

      var docClone = document.cloneNode(true);

      // Живую страницу возвращаем в исходный вид немедленно — она пользователя, не наша.
      for (var u = 0; u < marked.length; u++) {
        try { marked[u].removeAttribute('data-oblako-junk'); } catch (e) { /* узел исчез */ }
      }

      try {
        var junk = docClone.querySelectorAll('[data-oblako-junk]');
        for (var j = 0; j < junk.length; j++) {
          if (!junk[j].parentNode) continue; // уже уехал вместе с удалённым предком
          removedChars += (junk[j].textContent || '').length;
          junk[j].parentNode.removeChild(junk[j]);
        }
      } catch (e) { /* не вышло вычистить — Readability отработает по полному клону */ }

      var article = new Readability(docClone).parse();
      readabilityText = (article && article.textContent) ? article.textContent.trim() : '';
      articleHtml = (article && article.content) ? article.content : '';
    } catch (e) { readabilityText = ''; articleHtml = ''; }

    // ⚠️ Полный текст берём с ОЧИЩЕННОГО клона, а не с живой страницы. Иначе выходит две
    // беды разом: фолбэк возвращает отзывы, которые мы только что вырезали, и сравнение
    // «Readability дала слишком мало относительно всей страницы» становится нечестным —
    // очищенный результат меряется против неочищенного оригинала и всегда проигрывает.
    var fullText = '';
    try {
      var cloneBody = docClone.body;
      fullText = cloneBody ? (cloneBody.innerText || cloneBody.textContent || '') : '';
      fullText = fullText.replace(/[ \\t]+/g, " ").replace(/(\\r?\\n){3,}/g, "\\n\\n").trim();
    } catch (e) { fullText = ''; }
    // Клон не в дереве отрисовки — если текста не добыть, берём живую страницу как есть.
    var liveText = document.body ? (document.body.innerText || '') : '';
    if (!fullText) fullText = liveText;

    // Чистка сработала слишком жадно: осталась десятая часть или вовсе крохи. Значит
    // эвристика приняла содержимое за обвязку — откатываемся на неочищенный текст.
    var tooGreedy = liveText.length > 500
      && (fullText.length < 400 || fullText.length < liveText.length * 0.1);
    if (tooGreedy) {
      fullText = liveText;
      readabilityText = '';   // заставит пойти по ветке fallback ниже
      articleHtml = '';
    }

    if (facts) facts.removedReviewChars = removedChars;
    return {
      readabilityText: readabilityText, fullText: fullText,
      articleHtml: articleHtml, facts: facts
    };
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
export interface ExtractedPage {
  text: string
  markdown: string | null
}

// Экспортирована для HistoryIndexer.ts (заход на обогащение эмбеддинга истории контентом
// страницы) — тот же пайплайн Readability, без дублирования. Сама функция не менялась.
export async function extractPageText(wc: WebContents | null): Promise<ExtractedPage> {
  if (!wc || wc.isDestroyed()) return { text: '', markdown: null }
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
        return { text, markdown: null }
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
    tabId: activeTabId, url: activeTabUrl, title: activeTabTitle, favicon: activeTabFavicon, messages: ctx.messages,
  })
}

// Пушит панели текущий статус ключа Gemini — кнопка фактчека показывается/прячется по нему
// (см. aipanel.tsx). Тот же источник истины (AiKeyStore.ts), что и секция настроек AI.
function sendKeyStatus(): void {
  if (!panelView) return
  panelView.webContents.send('ai-panel:key-status', aiKeyStore.getKeyStatus())
}

// Подписка на изменения статуса ключа (сохранили/удалили в настройках) — модуль загружается один
// раз за жизнь процесса (импорт в main.ts), повторной регистрации не будет.
aiKeyStore.onKeyStatusChanged(() => sendKeyStatus())

// Задел под web-grounding (SearXNG) — тот же приём, что sendKeyStatus/aiKeyStore.onKeyStatusChanged
// выше: пуш булева статуса, сам конфиг (endpoint/токен) сюда не попадает.
function sendSearxngStatus(): void {
  if (!panelView) return
  panelView.webContents.send('ai-panel:searxng-status', searxngKeyStore.getStatus())
}
searxngKeyStore.onStatusChanged(() => sendSearxngStatus())

// Коммит 1 (реестр скиллов) — prompt-кнопки панели (Объяснить/Саммари и позже пользовательские)
// теперь данные, не хардкод (см. QUICK_ACTIONS в aipanel.tsx до этого коммита). Перевести/Фактчек
// остаются спец-кнопками вне реестра — этот пуш их не касается.
function sendSkillsList(): void {
  if (!panelView) return
  panelView.webContents.send('ai-panel:skills-list', skillsStore.list())
}
skillsStore.onSkillsChanged(() => sendSkillsList())

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
  activeTabFavicon = active.faviconUrl ?? null

  // Переключение активной вкладки (или смена её URL) — если панель открыта, показываем актуальную
  // беседу немедленно, а не ждём следующего действия пользователя внутри панели.
  if (switched || urlChanged) sendCurrentContext()
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

function layoutPanel(): void {
  if (!panelView || !attachedWin) return
  panelView.setBounds(computeBounds(attachedWin))
}

// Единственное место, где меняется isOpen — гарантирует, что chrome (App.tsx) узнаёт о
// закрытии/открытии НЕЗАВИСИМО от того, что его вызвало (крестик/Escape внутри панели,
// тоггл в тулбаре, будущие пути). Раньше isOpen менялся напрямую в двух местах — крестик/Escape
// не долетали до chrome (свой ad-hoc ai-panel:close, не трогает окно), из-за чего резерв
// ширины в App.tsx оставался висеть после закрытия панели не через тулбар.
function setOpenState(open: boolean): void {
  isOpen = open
  chromeViewRef?.webContents.send(IPC.AI_PANEL_STATE_CHANGED, open)
}

function closePanel(win: BrowserWindow): void {
  webApps.setPanelVisible(win, false) // веб-слоты прячутся вместе с панелью (но живут в памяти)
  if (panelView) win.contentView.removeChildView(panelView)
  setOpenState(false)
}

// Живой ресайз — драг разделителя в App.tsx шлёт сюда каждый тик (ad-hoc ai-panel:resize,
// см. ensureIpcRegistered). Клампит, применяет bounds немедленно, персистит через
// SettingsManager (та же частота записи, что и у остальных простых настроек — редко и вручную,
// без дебаунса, см. комментарий в SettingsManager.ts).
export function resizeAiPanel(win: BrowserWindow, widthPx: number): void {
  panelWidth = clampPanelWidth(widthPx)
  if (panelView && attachedWin === win) panelView.setBounds(computeBounds(win))
  settingsRef?.setAiPanelWidth(panelWidth)
}

// Read-only геометрия для координации с FindBarManager.ts (чтобы FindBar не центрировался под
// открытым доком). Сообщает, сколько px справа окна он реально занимает прямо сейчас (0 — если
// закрыт или для другого окна).
export function getAiPanelReservedWidth(win: BrowserWindow): number {
  return (isOpen && attachedWin === win) ? panelWidth : 0
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

  // Драг разделителя дока (chrome, App.tsx) — приложение одно-оконное (см. остальные
  // module-level синглтоны этого файла), поэтому применяем к attachedWin напрямую, как и
  // layoutPanel/closePanel выше, без BrowserWindow.fromWebContents.
  ipcMain.on('ai-panel:resize', (_event: IpcMainEvent, widthPx: number) => {
    if (attachedWin) resizeAiPanel(attachedWin, widthPx)
  })

  // Чат — та же труба, что у поповера: runChatMessage стримит чанки по мере генерации, затем
  // финальный исход. Привязка к вкладке: history/messages читаются и пишутся в контекст ТОЙ
  // вкладки, что была активна в момент отправки (tabId зафиксирован здесь, до await) — если
  // пользователь успеет переключиться на другую вкладку, пока Qwen ещё генерирует, ответ всё
  // равно уйдёт в правильный (фоновый) контекст, а в панель — только если она всё ещё показывает
  // именно эту вкладку к моменту прихода чанка/результата (иначе получился бы чужой текст поверх
  // чужого разговора).
  ipcMain.on('ai-panel:chat-send', (event: IpcMainEvent, text: string, webGrounding: boolean) => {
    const wc = event.sender
    const tabId = activeTabId
    if (!tabId) return
    const title = activeTabTitle
    const ctx = getOrCreateContext(tabId, activeTabUrl)
    ctx.messages.push({ role: 'user', text })

    // Web-grounding (SearXNG, заход 3 задела) — ОТДЕЛЬНАЯ ветка перед обычным путём Qwen ниже,
    // целиком независимая: не трогает needsExtraction/pageText/buildFirstTurnPrompt — риск
    // сломать обычный чат роутингом сводится к этому одному if с ранним return, сам обычный путь
    // не модифицирован ни строкой. Промпт строится ТОЛЬКО из результатов поиска + вопрос —
    // контекст страницы сюда не подмешивается, это отдельный режим ответа, не расширение обычного.
    // ctx.history ОБНОВЛЯЕТСЯ (в отличие от фактчека) — это реальная генерация локального Qwen,
    // не сторонняя модель, последующие сообщения в этом же разговоре видят её как обычный ход.
    if (webGrounding) {
      void (async () => {
        const search = await searxngSearch(text)
        if (!search.ok) {
          if (panelView && panelView.webContents === wc && activeTabId === tabId) {
            wc.send('ai-panel:chat-result', { ok: false, error: search.error })
          }
          return
        }
        const promptText = buildGroundingPrompt(text, search.results)
        const outcome = await runChatMessage(promptText, ctx.history, (chunkText) => {
          if (panelView && panelView.webContents === wc && activeTabId === tabId) {
            wc.send('ai-panel:chat-chunk', chunkText)
          }
        })
        if (outcome.ok) {
          const withSources = appendSearxngSources(outcome.out, search.results)
          ctx.messages.push({ role: 'assistant', text: withSources })
          ctx.history = outcome.history
          if (panelView && panelView.webContents === wc && activeTabId === tabId) {
            wc.send('ai-panel:chat-result', { ...outcome, out: withSources })
          }
        } else if (panelView && panelView.webContents === wc && activeTabId === tabId) {
          wc.send('ai-panel:chat-result', outcome)
        }
      })()
      return
    }

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

  // Кнопка «Фактчек» (заход D) — Gemini API с Search Grounding (см. GeminiFactCheck.ts), не
  // локальный Qwen. Плашка приватности уже показана и подтверждена на стороне renderer
  // (aipanel.tsx::showFactCheckConfirm) ДО отправки этого сигнала — здесь только сам вызов.
  ipcMain.on('ai-panel:fact-check', (event: IpcMainEvent) => {
    const wc = event.sender
    const tabId = activeTabId
    if (!tabId) return
    const title = activeTabTitle
    const url = activeTabUrl
    const ctx = getOrCreateContext(tabId, url)
    ctx.messages.push({ role: 'user', text: 'Фактчек' })

    const needsExtraction = ctx.pageText === null
    const pageWc = needsExtraction ? (tabManagerRef?.getActiveWebContents() ?? null) : null

    void (async () => {
      if (needsExtraction) {
        const extracted = await extractPageText(pageWc)
        ctx.pageText = extracted.text
        ctx.pageMarkdown = extracted.markdown
        console.log(`[ai-panel] текст страницы извлечён: ${ctx.pageText.length} симв. (для фактчека)`)
      }
      const outcome = await runFactCheck(ctx.pageText ?? '', title, url)

      // Ответ Gemini НЕ идёт в ctx.history (та — контекст ЛОКАЛЬНОГО Qwen для продолжения
      // беседы, см. runChatMessage/LlamaChatSession) — фактчек не часть того же диалога/модели,
      // только видимая лента ctx.messages.
      if (outcome.ok) {
        ctx.messages.push({ role: 'assistant', text: outcome.out })
      }
      if (panelView && panelView.webContents === wc && activeTabId === tabId) {
        wc.send('ai-panel:chat-result', outcome)
      }
    })()
  })

  // Задел под web-grounding (SearXNG) — клик по глобусу, когда SearXNG не настроен, ведёт сюда:
  // открываем вкладку настроек в чроме (тот же путь, что кнопка «Настройки» в сайдбаре —
  // TabManager.createSpecialTab), а не молча включаем пустой режим. Сама AI-панель не закрывается —
  // это отдельный, независимый от неё контент вкладки.
  // section (опционально) — начальный раздел Settings, см. TabManager.createSpecialTab. Кнопка "+"
  // в ряду действий панели зовёт этот же канал с 'ai'; вызов без аргумента (глобус выше) остаётся
  // как раньше — открывает Settings на дефолтном разделе.
  ipcMain.on('ai-panel:open-settings', (_event: IpcMainEvent, section?: string) => {
    tabManagerRef?.createSpecialTab('settings', section)
  })

  // Курсы валют для конвертера раздела «Приложения» (aiApps.tsx) — invoke/handle, не пуш:
  // данные нужны только по заходу пользователя в категорию «Валюты», рассылать их каждому
  // открытию панели незачем. Сам fetch и кэш — CurrencyRates.ts, здесь только труба.
  ipcMain.handle('ai-panel:currency-rates', () => getCurrencyRates())

  // Погода для виджета «Приложений» — та же схема, что курсы выше (fetch/кэш в WeatherService.ts).
  ipcMain.handle('ai-panel:weather', (_event, city: unknown) => getWeather(typeof city === 'string' ? city : ''))

  // Веб-приложения (заход 3): чужой сайт в слоте — отдельная WebContentsView (WebAppManager.ts).
  // Панель шлёт прямоугольник «дырки» В СВОЁМ вьюпорте; в координаты окна он переводится
  // ЗДЕСЬ — только этот модуль знает ширину дока (panelWidth) и высоту тулбара, WebAppManager
  // про геометрию панели не знает намеренно.
  ipcMain.on('ai-panel:webapp-open', (_event: IpcMainEvent, appId: unknown, url: unknown) => {
    if (attachedWin && typeof appId === 'string' && typeof url === 'string') {
      webApps.openWebApp(attachedWin, appId, url)
    }
  })
  ipcMain.on('ai-panel:webapp-bounds', (_event: IpcMainEvent, appId: unknown, rect: unknown) => {
    if (!attachedWin || typeof appId !== 'string') return
    const r = rect as { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | null
    if (!r || typeof r.x !== 'number' || typeof r.y !== 'number'
      || typeof r.width !== 'number' || typeof r.height !== 'number') return
    const { width } = attachedWin.getContentBounds()
    webApps.setWebAppBounds(attachedWin, appId, {
      x: Math.round(width - panelWidth + r.x),
      y: Math.round(TOOLBAR_HEIGHT + r.y),
      width: Math.round(r.width),
      height: Math.round(r.height),
    })
  })
  ipcMain.on('ai-panel:webapp-close', (_event: IpcMainEvent, appId: unknown) => {
    if (attachedWin && typeof appId === 'string') webApps.closeWebApp(attachedWin, appId)
  })
}

// Создаётся лениво на первый вызов (клик по кнопке AI ЛИБО фоновый прогрев — см. prewarmPanel
// ниже, main.ts вызывает его заранее после показа окна). Идемпотентна — повторный вызов (в
// т.ч. из toggleAiPanel на реальном клике после прогрева) просто возвращает уже готовый view.
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
  // навесил обработчик onContext, сообщение потерялось бы. Статус ключа — тем же приёмом.
  panelView.webContents.once('did-finish-load', () => { sendCurrentContext(); sendKeyStatus(); sendSearxngStatus(); sendSkillsList() })

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

  // .catch — loadURL асинхронный, без обработчика упавший промис ушёл бы в unhandledRejection
  // молча (раньше это было не критично: единственный вызывающий, клик пользователя, всё равно
  // увидел бы пустую панель и мог попробовать снова). Теперь ensurePanelView зовётся ЕЩЁ и из
  // фонового прогрева (prewarmPanel, без пользователя на экране) — там сбой обязан хотя бы
  // залогироваться, иначе первый клик по AI тихо откатится к прежнему ленивому пути без объяснения.
  panelView.webContents.loadURL('oblako-chrome://localhost/aipanel.html')
    .catch((e) => console.error('[ai-panel] loadURL упал:', e))
  return panelView
}

// Фоновый прогрев — вызывается ЗАРАНЕЕ (main.ts, после показа окна, с задержкой), ДО первого
// клика по кнопке AI. Только создание WebContentsView + запуск loadURL — НЕ показывает панель
// (никакого setBounds/addChildView/setOpenState, это исключительно дело toggleAiPanel). Пуши
// did-finish-load (sendCurrentContext/sendKeyStatus/...) уйдут в ещё не показанную панель — это
// безвредно (она просто копит состояние в невидимом renderer'е), а toggleAiPanel при реальном
// открытии всё равно шлёт их заново (см. ветку alreadyLoaded ниже) — устаревший на момент
// прогрева контекст никогда не остаётся показанным пользователю.
// Не бросает наружу — тот же приём, что warmupBergamot/warmupTranslation в main.ts: сбой прогрева
// не должен ронять старт браузера, в худшем случае первый клик по AI останется таким же ленивым,
// как до этого коммита.
export function prewarmPanel(): void {
  try {
    ensurePanelView()
  } catch (e) {
    console.error('[ai-panel] прогрев упал:', e)
  }
}

// Тоггл по клику кнопки AI в тулбаре — возвращает новое состояние (true = открыта).
// Открыть панель на конкретном приложении — вход с иконки рабочего стола новой вкладки.
// ⚠️ Панель может быть закрыта, только что созданной или уже открытой: во всех трёх случаях
// сообщение шлём ПОСЛЕ того, как вью существует, иначе первый клик по иконке уходил бы в никуда.
export function openAiPanelApp(win: BrowserWindow, appId: string): void {
  if (!isOpen) toggleAiPanel(win)
  const view = ensurePanelView()
  const send = (): void => {
    if (!view.webContents.isDestroyed()) view.webContents.send('ai-panel:open-app', appId)
  }
  if (view.webContents.isLoading()) view.webContents.once('did-finish-load', send)
  else send()
}

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
  // Веб-слоты — ПОСЛЕ панели: их view должны лечь поверх неё (в дырки), см. WebAppManager.
  webApps.setPanelVisible(win, true)
  setOpenState(true)
  // При повторном открытии (view уже когда-то загрузился) did-finish-load больше не сработает —
  // шлём текущий контекст явно, чтобы панель не показывала последнюю беседу «протухшей» вкладки.
  if (alreadyLoaded) { sendCurrentContext(); sendKeyStatus(); sendSearxngStatus(); sendSkillsList() }
  return true
}
