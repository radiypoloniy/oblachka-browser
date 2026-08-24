// Правая AI-панель — чат с локальным Qwen (Заход 2), беседа привязана к вкладке (Заход 3).
// Дизайн (остров/тень/скругления/отступы/закрытие) не трогается — только контент внутри.
// Позиция/размер/открытие-закрытие по-прежнему в main (AiPanelManager.ts), эта страница просто
// рисует чипс страницы + ленту + поле ввода на весь свой вьюпорт.
// Беседы эфемерные, per-вкладка, БЕЗ персистентности — авторитетное хранилище (messages+history
// для Qwen) живёт в main (AiPanelManager.ts::tabContexts), эта страница только отображает то, что
// приходит через onContext при переключении/навигации/(пере)открытии панели. Свой собственный
// messages-стейт здесь — витрина: пополняется оптимистично при отправке и полностью ЗАМЕНЯЕТСЯ
// целиком при каждом onContext (переключили вкладку → другая лента, не дописывание к старой).
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import { Sparkles, X, Send, Globe, Loader2, LayoutGrid, Plus, ChevronDown } from 'lucide-react';
import './styles/global.css';
import { markdownComponents } from './components/aiMarkdown';
import { AppsMode, loadWallpaper, saveWallpaper, wallpaperBackground } from './components/aiApps';
import { subscribeMeshes } from './newtab/gradients';
import type { CurrencyRatesResult, WeatherResult } from './components/aiApps';
import { SHELL_MARGIN } from '../shared/layout';
import { installOverlayReveal } from './overlayReveal';
import { CAPS, DISPLAY_ROW, RADIUS, TEXT } from './styles/system';

// Код причины отказа (см. electron/TranslationService.ts::ModelError, shared/ipc.ts::ModelErrorCode)
// — зеркалим локально, тот же приём, что и у ChatOutcome ниже.
type ModelErrorCode = 'NO_MODEL_INSTALLED' | 'MODEL_FILE_MISSING' | 'LOAD_FAILED'

// Форма ChatOutcome из electron/TranslationService.ts — не через shared/ipc.ts (ad-hoc канал,
// как и у поповера, см. preload-aipanel.ts), поэтому просто зеркалим форму локально.
type ChatOutcome =
  | { ok: true; out: string; ms: number; tokPerSec: number; loadMs: number | null }
  | { ok: false; error: string; errorCode?: ModelErrorCode }

interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

// Запас высоты у схлопнутого ряда подсказок: обрезка идёт по нижнему краю первой строки, и без
// запаса она срезала бы --shadow-chip у самих чипов. Меньше зазора между строками (6) — иначе в
// щель заглядывала бы вторая строка.
// Цветные пятна карточек скиллов. ⚠️ Тот же набор и тот же порядок, что в настройках
// (SkillsSection.tsx): карточка одного и того же скилла обязана выглядеть одинаково там, где её
// настраивают, и там, где её нажимают.
const SKILL_STAIN = [
  'var(--tile-orange)', 'var(--tile-teal)', 'var(--tile-brown)',
  'var(--tile-slate)', 'var(--tile-green)', 'var(--tile-blue)', 'var(--tile-red)',
] as const

const COLLAPSED_SLACK = 4

// Форма Skill из electron/SkillsStore.ts — зеркалим локально, тот же приём, что у ChatOutcome
// выше (ad-hoc канал, не через shared/ipc.ts).
interface SkillItem {
  id: string
  label: string
  prompt: string
  icon?: string
  builtin?: boolean
  visible: boolean
}

// Форма пуша ai-panel:context из AiPanelManager.ts::sendCurrentContext.
interface TabContext {
  tabId: string
  url: string
  title: string
  favicon?: string | null
  messages: ChatMessage[]
}

declare global {
  interface Window {
    aiPanel: {
      close: () => void
      // Фокус в поле ввода чата = намерение поговорить с моделью. Именно по нему main греет
      // Qwen — не по открытию панели (в ней ещё приложения и виджеты), см. AiPanelManager.ts.
      chatIntent: () => void
      // Слот с сайтом стал активным — попросить main отдать фокус его вью.
      webappFocus: (appId: string) => void
      // Фокус ушёл в сайт веб-слота — по этому признаку раздел «Приложения» рисует рамку
      // активного слота (сам он такой клик не видит, см. WebAppManager.ts).
      onWebAppFocused: (cb: (appId: string) => void) => () => void
      // Иконка приложения на рабочем столе новой вкладки открывает панель сразу на нём.
      onOpenApp: (cb: (appId: string) => void) => () => void
      // webGrounding — тоггл-глобус: true → main отвечает через SearXNG-ветку (см. AiPanelManager.ts).
      sendChat: (text: string, webGrounding: boolean) => void
      quickTranslate: () => void
      onChatChunk: (cb: (text: string) => void) => () => void
      onChatResult: (cb: (outcome: ChatOutcome) => void) => () => void
      onContext: (cb: (ctx: TabContext) => void) => () => void
      // Заход D — кнопка фактчека: показывается только когда ключ Gemini подключён.
      onKeyStatus: (cb: (connected: boolean) => void) => () => void
      factCheck: () => void
      // Коммит 1 (реестр скиллов) — prompt-кнопки панели (Объяснить/Саммари, позже пользовательские)
      // приходят из main (SkillsStore.ts), а не хардкожены здесь.
      onSkillsList: (cb: (skills: SkillItem[]) => void) => () => void
      // Задел под web-grounding (SearXNG) — тоггл-глобус в поле ввода.
      onSearxngStatus: (cb: (configured: boolean) => void) => () => void
      // section — необязательный начальный раздел Settings (напр. 'ai' у кнопки "+" в ряду
      // действий); без аргумента — дефолтный раздел, как у клика по глобусу (handleGlobeClick).
      openSettings: (section?: string) => void
      // Курсы валют (конвертер) и погода (виджет) «Приложений» — формы ответов зеркалятся
      // в aiApps.tsx (ad-hoc каналы, как остальные ai-panel:*).
      modelState: () => Promise<{ label: string | null; loaded: boolean }>
      currencyRates: () => Promise<CurrencyRatesResult>
      weather: (city: string) => Promise<WeatherResult>
      // Веб-приложения (заход 3) — open/bounds/close веб-слотов, см. WebAppManager.ts.
      webappOpen: (appId: string, url: string) => void
      webappBounds: (appId: string, rect: { x: number; y: number; width: number; height: number }) => void
      webappClose: (appId: string) => void
    }
  }
}

// Воздух вокруг карточки — bounds самой WebContentsView его не выделяют (см.
// AiPanelManager.ts::computeBounds — flush), это чистый CSS-padding внутри вью, и заодно зона
// под CSS box-shadow — WebContentsView обрезает всё, что рисуется за границей.
//
// Все 4 стороны сведены к SHELL_MARGIN не для единообразия ради единообразия, а из geometry:
// AI-view занимает ровно диапазон [TOOLBAR_HEIGHT..низ окна] (computeBounds), и этот же диапазон
// по высоте занимает aiPanelContainerRef в App.tsx (flex-строка сразу под тулбаром высотой
// TOOLBAR_HEIGHT, без своего margin) — тот самый ряд, где живёт contentRef/split-остров.
// Единственное, что внутри этого совпадающего диапазона отступает верх/низ contentRef от его
// границ — это marginTop/marginBottom: var(--gutter-shell) на самом contentRef (App.tsx). Чтобы
// верх/низ AI-карточки легли на одну линию с верхом/низом split-острова, паддинг карточки должен
// быть НЕ произвольным (было 14/26 с оптической подгонкой под старый попап-дизайн), а тем же
// SHELL_MARGIN — старые 14/26 расходились со split-островом на +2px сверху и +14px снизу.

// Кнопки-подсказки над полем ввода (как у Яндекса) — Коммит 1 (реестр скиллов): prompt-кнопки
// (Объяснить/Саммари, позже пользовательские) больше не хардкод здесь, а приходят из main
// (SkillsStore.ts) через onSkillsList, см. skills-стейт ниже. Клик = отправка сообщения в чат
// текущей вкладки, как обычное — тот же существующий стриминг/per-вкладочный контекст/извлечение
// текста страницы (заход 4). Результат уходит в ПАНЕЛЬ — эти кнопки не трогают текст самой страницы.
// «Перевести» остаётся отдельной спец-кнопкой ВНЕ реестра: направление (src/tgt) неизвестно ДО
// извлечения текста и детекции языка страницы (двунаправленно, как перевод выделения — см.
// AiPanelManager.ts::resolveDirection/buildPrompt), поэтому у неё нет готового prompt — только
// сигнал quickTranslate() в main.

// Человекочитаемая карточка вместо сырого String(e) — NO_MODEL_INSTALLED/MODEL_FILE_MISSING
// ведут в Настройки (showModelButton), LOAD_FAILED и всё прочее без errorCode — просто внятная
// подводка над текстом ошибки от бэкенда (он уже человекочитаем, см. TranslationService.ts).
function describeChatError(error: string, code: ModelErrorCode | null): { heading: string; detail: string; showModelButton: boolean } {
  if (code === 'NO_MODEL_INSTALLED') {
    return {
      heading: 'Локальная модель не установлена',
      detail: 'AI считает прямо на этом устройстве, без облака — модель нужно скачать один раз, дальше всё работает офлайн.',
      showModelButton: true,
    }
  }
  if (code === 'MODEL_FILE_MISSING') {
    return {
      heading: 'Файл модели не найден',
      detail: 'Похоже, файл модели переместили или удалили с диска. Выберите модель заново.',
      showModelButton: true,
    }
  }
  return { heading: 'Не удалось получить ответ', detail: error, showModelButton: false }
}

function AiPanel() {
  const [tabId, setTabId] = useState<string | null>(null)
  const [pageTitle, setPageTitle] = useState('')
  const [pageUrl, setPageUrl] = useState('')
  const [modelState, setModelState] = useState<{ label: string | null; loaded: boolean } | null>(null)
  const [pageFavicon, setPageFavicon] = useState<string | null>(null)
  const [faviconError, setFaviconError] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  // Копится по мере генерации (тот же токен-стриминг, что у поповера/AI-действий) — показывается
  // как «печатающееся» сообщение ассистента, пока не придёт финальный result.
  const [streamedText, setStreamedText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<ModelErrorCode | null>(null)
  // Заход D — кнопка фактчека видна только когда ключ Gemini подключён (см. AiKeyStore.ts,
  // пуш через AiPanelManager.ts::sendKeyStatus). factChecking — отдельный флаг ТОЛЬКО для
  // текстовой/визуальной подписи «печатающегося» сообщения (см. рендер ленты ниже): вызов Gemini
  // с Search Grounding идёт заметно дольше локальной модели и без частичного стриминга, обычное
  // «…» выглядело бы как зависание — явный текст снижает риск повторного клика.
  // Коммит 1 (реестр скиллов) — prompt-кнопки (Объяснить/Саммари, позже пользовательские) из
  // main (SkillsStore.ts), см. onSkillsList ниже. Перевести/Фактчек в этот стейт не входят —
  // они остаются спец-кнопками (см. комментарий выше про «Перевести»).
  const [skills, setSkills] = useState<SkillItem[]>([])
  const [factCheckAvailable, setFactCheckAvailable] = useState(false)
  const [factChecking, setFactChecking] = useState(false)
  // Плашка приватности перед вызовом (см. sendFactCheck ниже) — обязательна каждый раз, без «запомнить».
  const [showFactCheckConfirm, setShowFactCheckConfirm] = useState(false)
  // Задел под web-grounding (SearXNG) — тоггл-глобус в поле ввода. webGroundingActive: чисто
  // локальный UI-стейт (не персистится, не переживает переключение вкладки/перезапуск панели —
  // тот же принцип, что mode ниже). searxngConfigured — пуш из AiPanelManager.ts::sendSearxngStatus,
  // тот же источник, что читает секция настроек. showWebGroundingConfirm — плашка согласия,
  // обязательна перед КАЖДЫМ включением, тот же приём, что у фактчека, но свой флаг: это разные
  // независимые действия, не должны гаситься/путаться друг с другом.
  const [webGroundingActive, setWebGroundingActive] = useState(false)
  const [searxngConfigured, setSearxngConfigured] = useState(false)
  const [showWebGroundingConfirm, setShowWebGroundingConfirm] = useState(false)
  // Заход 3 задела (сквозной grounding) — фаза «идёт поиск в SearXNG», ДО первого чанка от Qwen:
  // main сначала ждёт searxngSearch(), генерация стартует только после (см. AiPanelManager.ts).
  // Без этого флага та же дыра, что чинил factChecking — пустой streamedText молча висел бы,
  // читаясь как зависание. Гасится первым чанком (unsubChunk) — тем же сигналом «генерация началась».
  const [webSearching, setWebSearching] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  // Заход 3 — переключатель AI/Приложения (см. дизайн-систему): локальный, не персистится.
  // «Приложения» (aiApps.tsx) в режиме чата НЕ размонтируются, а прячутся display:none (см.
  // рендер ниже) — иначе переключение в чат убивало бы их состояние (идущий таймер и т.п.).
  const [mode, setMode] = useState<'chat' | 'apps'>('chat')
  // Приложение, которое просили открыть снаружи (иконка на рабочем столе). Считается один раз:
  // AppsMode сбрасывает его через onRequestHandled, иначе повторный клик по той же иконке уже
  // ничего бы не делал — значение не менялось бы.
  const [requestedApp, setRequestedApp] = useState<string | null>(null)
  useEffect(() => window.aiPanel.onOpenApp((appId) => {
    setMode('apps')
    setRequestedApp(appId)
  }), [])
  // Обои «Приложений» — стейт здесь, а не в AppsMode: обоями красится ВЕСЬ остров панели
  // (включая фон за шапкой, см. стиль острова ниже), не только область под сеткой.
  const [wallpaper, setWallpaper] = useState<string>(loadWallpaper)
  // rev — форс-перерисовка острова, когда id НЕ меняется, а картинка под ним — да: повторная
  // загрузка своего фото при уже выбранном 'custom' (setState тем же 'custom' React бы съел,
  // и wallpaperBackground не перечитал бы обновлённый кэш).
  const [, setWallpaperRev] = useState(0)
  const selectWallpaper = (id: string) => {
    setWallpaper(id)
    setWallpaperRev((r) => r + 1)
    saveWallpaper(id)
  }
  useEffect(() => subscribeMeshes(() => setWallpaperRev((r) => r + 1)), [])
  useEffect(() => {
    const el = document.documentElement
    const obs = new MutationObserver(() => setWallpaperRev((r) => r + 1))
    obs.observe(el, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') window.aiPanel.close(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    // Переключение вкладки / смена её URL / (пере)открытие панели — main присылает АВТОРИТЕТНУЮ
    // ленту этой вкладки целиком. Любая незавершённая генерация «протухшей» вкладки визуально
    // гасится (sending/streamedText/error сбрасываются) — она никуда не делась в main, просто эта
    // страница её больше не показывает, пока пользователь не вернётся на ту вкладку.
    const unsubContext = window.aiPanel.onContext((ctx) => {
      setTabId(ctx.tabId)
      setPageTitle(ctx.title)
      setPageUrl(ctx.url)
      setPageFavicon(ctx.favicon ?? null)
      setMessages(ctx.messages)
      setStreamedText('')
      setSending(false)
      setFactChecking(false)
      setWebSearching(false)
      setError(null)
      setErrorCode(null)
      // Модель могла подняться в память между показами панели — push-события на это в проекте
      // нет (см. ai-panel:model-state), поэтому перечитываем на каждый новый контекст.
      void window.aiPanel.modelState().then(setModelState)
    })
    const unsubChunk = window.aiPanel.onChatChunk((chunkText) => {
      setWebSearching(false)
      setStreamedText((prev) => prev + chunkText)
    })
    void window.aiPanel.modelState().then(setModelState)
    const unsubResult = window.aiPanel.onChatResult((outcome) => {
      setSending(false)
      setFactChecking(false)
      setWebSearching(false)
      setStreamedText('')
      if (outcome.ok) {
        setMessages((prev) => [...prev, { role: 'assistant', text: outcome.out }])
        setError(null)
        setErrorCode(null)
      } else {
        setError(outcome.error)
        setErrorCode(outcome.errorCode ?? null)
      }
      // Ответ пришёл — значит модель точно поднялась. Чип обязан перестать обещать ожидание.
      void window.aiPanel.modelState().then(setModelState)
    })
    const unsubKeyStatus = window.aiPanel.onKeyStatus((connected) => {
      setFactCheckAvailable(connected)
    })
    const unsubSkillsList = window.aiPanel.onSkillsList((list) => {
      setSkills(list)
    })
    const unsubSearxngStatus = window.aiPanel.onSearxngStatus((configured) => {
      setSearxngConfigured(configured)
    })
    return () => { unsubContext(); unsubChunk(); unsubResult(); unsubKeyStatus(); unsubSkillsList(); unsubSearxngStatus() }
  }, [])

  // Смена favicon (переключение вкладки/навигация) — сбрасываем прошлую ошибку загрузки,
  // иначе новая иконка не покажется, если старая когда-то не загрузилась.
  useEffect(() => { setFaviconError(false) }, [pageFavicon])

  // Автоскролл вниз при новом тексте — свои сообщения, ответы AI, стриминг по ходу генерации.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, streamedText])

  // Общая точка отправки — и текстовое поле, и кнопки-подсказки шлют через неё «как будто
  // пользователь сам написал»: один и тот же путь (оптимистичное сообщение в ленте → sendChat).
  const sendText = (text: string) => {
    if (!text || sending || !tabId) return
    setMessages((prev) => [...prev, { role: 'user', text }])
    setInput('')
    setStreamedText('')
    setError(null)
    setSending(true)
    setWebSearching(webGroundingActive)
    window.aiPanel.sendChat(text, webGroundingActive)
  }

  const handleSend = () => sendText(input.trim())

  // «Перевести» — не sendText: промпт (с определённым src/tgt) собирается в main, после извлечения
  // текста страницы и детекции языка. Здесь только оптимистичная метка в ленте + сигнал main.
  const sendQuickTranslate = () => {
    if (sending || !tabId) return
    setMessages((prev) => [...prev, { role: 'user', text: 'Перевести' }])
    setStreamedText('')
    setError(null)
    setSending(true)
    window.aiPanel.quickTranslate()
  }

  // Заход D — фактчек уходит в облако (Google Gemini), а не к локальной модели: плашка
  // приватности обязательна перед КАЖДЫМ вызовом (см. showFactCheckConfirm выше) — реальная
  // отправка происходит только по явному подтверждению.
  const sendFactCheck = () => {
    if (sending || !tabId) return
    setShowFactCheckConfirm(false)
    setMessages((prev) => [...prev, { role: 'user', text: 'Фактчек' }])
    setStreamedText('')
    setError(null)
    setSending(true)
    setFactChecking(true)
    window.aiPanel.factCheck()
  }

  // Задел под web-grounding (SearXNG) — глобус в поле ввода. Три исхода клика:
  // 1) не настроено (см. searxngConfigured выше) → в настройки, ничего не включаем;
  // 2) выключен → плашка согласия (обязательна каждый раз, «запомнить» нет — тот же принцип,
  //    что у фактчека, только текст честный про свою инфраструктуру, не «облако»);
  // 3) включён → выключаем молча, без плашки (симметрично не требуется: гасить проще, чем зажигать).
  const handleGlobeClick = () => {
    if (!searxngConfigured) { window.aiPanel.openSettings(); return }
    if (webGroundingActive) { setWebGroundingActive(false); return }
    setShowWebGroundingConfirm(true)
  }
  const confirmWebGrounding = () => {
    setShowWebGroundingConfirm(false)
    setWebGroundingActive(true)
  }

  // Домен текущей страницы для плашки. ⚠️ Заголовки страниц врут чаще адресов («Главная» есть на
  // сотне сайтов), поэтому под именем стоит хост, а не второй кусок заголовка.
  const pageHost = (() => {
    try { return new URL(pageUrl).hostname.replace(/^www\./, '') } catch { return '' }
  })()

  const handleDetachFromPage = () => {
    // TODO: механика отвязки панели от активной вкладки — реализуем отдельно.
    // Пока только визуальный элемент; кнопка намеренно ничего не делает.
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // ── Ряд кнопок-подсказок ──────────────────────────────────────────────────────────────────
  // Беседа началась — ряд схлопывается до ОДНОЙ строки, чтобы не отъедать высоту у ленты. Но
  // схлопывается именно ВИЗУАЛЬНО: перенос по строкам остаётся, лишние строки просто обрезаны, и
  // кнопка-шеврон разворачивает их все разом.
  // ⚠️ Прокрутки вбок здесь БЫТЬ НЕ ДОЛЖНО, хотя напрашивается. Скиллов у человека может быть и
  // десять: горизонтальная полоса тогда даёт доступ к трём, а остальные прячет за жестом, которого
  // в узкой панели не видно. Плюс `overflow-x: auto` в одиночку не работает как задумано — по CSS
  // вторая ось перестаёт быть `visible` и тоже становится `auto`, ряд превращается в скроллер по
  // ДВУМ осям, а вертикальное колесо Chromium переводит в горизонтальную прокрутку только для
  // строго горизонтальных. Живой симптом: «кнопки не прокручиваются вообще».
  const chipsCompact = messages.length > 0
  // Пока идёт генерация, подсказка не должна запускать второй запрос поверх первого; вне вкладки
  // действовать не над чем. Оба случая гасят кнопку одинаково — она видна, но не нажимается.
  const chipsBusy = !tabId || sending

  // Высота ОДНОЙ строки чипов и признак «строк больше одной». И то и другое меряется, а не
  // задаётся числом: высота чипа зависит от --fs-xs и от наличия иконки, а сколько их влезает в
  // строку — от ширины панели, которую человек тянет мышью.
  const chipsElRef = useRef<HTMLDivElement | null>(null)
  const chipsRoRef = useRef<ResizeObserver | null>(null)
  const [chipRowH, setChipRowH] = useState(0)
  const [chipsFullH, setChipsFullH] = useState(0)
  const [chipsOverflow, setChipsOverflow] = useState(false)
  const [chipsExpanded, setChipsExpanded] = useState(false)

  const measureChips = useCallback(() => {
    const el = chipsElRef.current
    if (!el) return
    const first = el.firstElementChild as HTMLElement | null
    const last = el.lastElementChild as HTMLElement | null
    if (!first || !last) return
    // ⚠️ «Строк больше одной» считается по РАСКЛАДКЕ ДЕТЕЙ, а не по scrollHeight ряда. Схлопнутый
    // ряд зажат max-height и обрезан overflow:hidden, и что при этом считать высотой его
    // содержимого — вопрос тонкий; offsetTop детей от обрезки не зависит вовсе, чипы стоят там же,
    // просто не видны. Перенос заполняет строки по порядку, поэтому последний чип всегда в
    // последней строке — сравнения первого с последним достаточно.
    const rowH = first.offsetHeight
    const fullH = last.offsetTop - first.offsetTop + last.offsetHeight
    const multiRow = last.offsetTop > first.offsetTop
    if (rowH) setChipRowH((prev) => (prev === rowH ? prev : rowH))
    setChipsFullH((prev) => (prev === fullH ? prev : fullH))
    setChipsOverflow((prev) => (prev === multiRow ? prev : multiRow))
  }, [])

  // ⚠️ Ref-КОЛБЭК, а не useRef, и наблюдатель живёт в нём же — иначе фактчек ломает весь ряд.
  // Плашка подтверждения фактчека стоит в ТОЙ ЖЕ позиции тернарника, что и ряд подсказок, а React
  // при совпадении типа узла переиспользует его, а не создаёт новый. Прежняя версия захватывала
  // элемент в замыкание эффекта, и ResizeObserver оставался висеть на этом общем узле: смена
  // размера «ряд → плашка» будила его, и он мерил ПЛАШКУ — за высоту строки принималась высота
  // абзаца про приватность. Мусорные числа жили дальше, потому что после возврата ряда ни одна
  // зависимость эффекта не менялась (беседа уже начата — chipsCompact и так true). Живой симптом:
  // после фактчека шеврон пропадал и возвращался только при переходе на другую страницу, где
  // onContext сбрасывает ленту и тем самым дёргает пересчёт.
  const attachChips = useCallback((el: HTMLDivElement | null) => {
    chipsRoRef.current?.disconnect()
    chipsRoRef.current = null
    chipsElRef.current = el
    if (!el) return // ряд сейчас не показан (его место занято плашкой) — мерить нечего
    // Ширину панели тянут мышью, и от неё зависит, сколько чипов влезло в строку.
    const ro = new ResizeObserver(measureChips)
    ro.observe(el)
    chipsRoRef.current = ro
    measureChips()
  }, [measureChips])

  // Содержимое ряда меняется и без ресайза: пришли скиллы, подключили ключ Gemini, развернули
  // список, началась беседа. setState внутри срабатывает только на изменение — цикла нет.
  useLayoutEffect(measureChips, [measureChips, skills, factCheckAvailable, chipsCompact, chipsExpanded])

  // "+" — вход в Settings сразу на разделе AI (редактор скиллов появится там отдельным коммитом).
  // Не зависит от tabId (настройки — не действие над страницей), поэтому всегда активна.
  // ⚠️ Рисуется в ДВУХ разных местах разметки, поэтому собран здесь: в схлопнутом ряду — в
  // несдвигаемом правом хвосте (иначе уехал бы за обрез), в развёрнутом — последним элементом
  // общего потока (иначе висел бы в конце ПЕРВОЙ строки, хотя относится ко всему списку).
  // Синяя заливка (не outline-чип, как соседи) — та же пара, что у Send/«Продолжить» ниже (filled
  // accent), но другим токеном фона: попросили точный #007AFF, такого токена нет НИГДЕ в теме
  // (проверено src/styles/tokens/colors.css и весь src/styles — есть только --blue-500=#2280C5=
  // --accent, другой хекс, дизайн-система из другого синего). TODO(цвет): имя-заглушка --system с
  // фоллбэком на --accent — подставить реальный токен синей заливки под #007AFF, когда он появится.
  const settingsChip = (
    <button
      onClick={() => window.aiPanel.openSettings('ai')}
      title="Настроить AI"
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0,
        padding: '6px 10px',
        borderRadius: 'var(--radius-chip)',
        border: 'none',
        background: 'var(--system, var(--accent))',
        color: 'var(--text-on-accent)',
        cursor: 'pointer',
      }}
    >
      <Plus size={13} />
    </button>
  )

  return (
    <div className="ai-panel-root" style={{
      // Верх/низ = SHELL_MARGIN — совпадает с верхом/низом split-острова (см. комментарий выше).
      paddingTop: SHELL_MARGIN,
      paddingBottom: SHELL_MARGIN,
      // Слева — 0: зазор до split-контента теперь целиком у DOM-хэндла в App.tsx (ISLAND_GAP),
      // карточка вплотную к левому краю своей вью. Справа — SHELL_MARGIN: тот же отступ, что у
      // сайдбара от края окна (симметрия «остров — край окна»).
      paddingLeft: 0,
      paddingRight: SHELL_MARGIN,
      boxSizing: 'border-box', width: '100%', height: '100vh',
    }}>
      <div style={{
        width: '100%', height: '100%', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: 'var(--surface-solid)',
        // Режим «Приложения»: весь остров целиком заливается обоями (фикс-холст с кропом при
        // ресайзе — см. wallpaperBackground), шапка с переключателем просто парит поверх.
        ...(mode === 'apps' ? wallpaperBackground(wallpaper) : null),
        // var(--radius-island) — заметно круглее var(--radius-card): остров, а не карточка.
        borderRadius: 'var(--radius-island)',
        // НЕ var(--shadow-overlay) — тот рассчитан на щедрый симметричный SHADOW_MARGIN=40
        // (suggestdropdown.tsx/translatepopover.tsx), а тут padding теперь 0/12/12/12
        // (см. paddingLeft/Top/Right/Bottom выше — заход про зазоры и SHELL_MARGIN ужал его).
        // shadow-overlay при offset:10/blur:28 требует до 38px запаса на сторону — с 12px
        // (и 0 слева) она обрезалась WebContentsView в жёсткий угловатый блок вместо мягкой
        // тени. Своя маленькая асимметричная тень, подогнанная под фактический паддинг:
        // offsetX:5/blur:5 — 0 слева (карточка и так вплотную к хэндлу, там нечему растворяться)
        // и 10 справа (запас 2px); offsetY:2/blur:5 — 3 сверху и 7 снизу (запас 9/5px).
        boxShadow: '5px 2px 5px rgba(40,30,80,0.20)',
        fontFamily: 'var(--font-sans)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: 'var(--pad-island)',
          paddingBottom: 0,
          flexShrink: 0,
        }}>
          <ModeToggle mode={mode} onChange={setMode} />
          <div style={{ flex: 1 }} />
          <button
            onClick={() => window.aiPanel.close()}
            title="Закрыть (Esc)"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 30, height: 30, flexShrink: 0,
              background: 'var(--surface-sunken)', border: 'none', borderRadius: '50%',
              color: 'var(--text-muted)', cursor: 'pointer', padding: 0,
            }}
          >
            <X size={15} strokeWidth={2} />
          </button>
        </div>

        {/* Индикатор текущей страницы — парящий островок. Смена URL внутри вкладки обновит и его,
            и ленту (сброшенную на новый разговор) одним и тем же onContext. Крестик = отвязать
            панель от страницы (механика позже, см. handleDetachFromPage). */}
        {/* ⚠️ Чат ПРЯЧЕТСЯ, а не размонтируется. Раньше здесь стоял условный рендер, и режимы
            вели себя несимметрично: приложения переживали переключение (display:none), а чат
            каждый раз собирался заново — вся лента сообщений, разметка markdown, эффекты. Отсюда
            и «тяжело воспринимается»: возврат в чат стоил полной пересборки, да ещё и сбрасывал
            прокрутку ленты на место, где её оставил React, а не человек.
            Обёртка повторяет геометрию блока приложений (flex:1, minHeight:0, колонка) — трое
            прежних соседей раскладываются внутри неё ровно так же, как раскладывались снаружи. */}
        <div className={mode === 'chat' ? 'oblako-mode-in' : undefined} style={{
          flex: 1, minHeight: 0,
          display: mode === 'chat' ? 'flex' : 'none', flexDirection: 'column',
        }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          margin: `10px var(--pad-island) 0`,
          padding: '7px 8px 7px 12px',
          background: 'var(--surface-solid)',
          border: '1px solid var(--glass-edge)',
          boxShadow: 'var(--shadow-card)',
          borderRadius: 'var(--radius-card)',
          flexShrink: 0,
          minWidth: 0,
        }}>
          {pageFavicon && !faviconError ? (
            <img
              src={pageFavicon}
              alt=""
              width={16}
              height={16}
              onError={() => setFaviconError(true)}
              style={{ flexShrink: 0, borderRadius: RADIUS.tight, objectFit: 'contain' }}
            />
          ) : (
            <Globe size={16} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
          )}
          {/* ⚠️ ЗАГОЛОВОК ДИСПЛЕЙНОЙ, ПОД НИМ ДОМЕН. Это герой панели: вопрос «он вообще про эту
              вкладку или про предыдущую?» возникает раньше любого другого и задаётся заново после
              каждого переключения. Домен нужен отдельной строкой потому, что заголовки страниц
              врут чаще адресов — «Главная» встречается на сотне сайтов. */}
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{
              display: 'block', ...DISPLAY_ROW,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {pageTitle || 'Новая вкладка'}
            </span>
            {pageHost && (
              <span style={{
                display: 'block', ...TEXT.caption, color: 'var(--text-muted)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>
                {pageHost}
              </span>
            )}
          </span>
          {/* ⚠️ Состояние модели — ЧИПОМ В ПЛАШКЕ, а не отдельной строкой и не героем. Вопрос
              «он про эту вкладку?» человек задаёт каждый раз, а «что за модель и почему долго» —
              один раз; поэтому страница крупно, модель мелко, но в том же ряду: одна строка
              отвечает на оба вопроса и панель не теряет высоту у ленты. */}
          {modelState && (
            <span
              title={modelState.label
                ? (modelState.loaded
                  ? `${modelState.label} — в памяти, отвечает сразу`
                  : `${modelState.label} — поднимется в память при первом запросе`)
                : 'Локальная модель не установлена'}
              style={{
                ...CAPS, flex: 'none', whiteSpace: 'nowrap',
                padding: '4px 8px', borderRadius: RADIUS.pill,
                background: modelState.loaded ? 'var(--surface-sunken)' : 'var(--selected)',
                color: 'var(--text-muted)',
              }}
            >
              {!modelState.label ? 'нет модели' : modelState.loaded ? 'в памяти' : 'поднимаю'}
            </span>
          )}
          <button
            onClick={handleDetachFromPage}
            title="Отвязать панель от страницы"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 22, height: 22, flexShrink: 0,
              background: 'transparent', border: 'none', borderRadius: '50%',
              color: 'var(--text-faint)', cursor: 'pointer', padding: 0,
            }}
          >
            <X size={13} strokeWidth={2} />
          </button>
        </div>

        {/* Лента сообщений — minHeight:0 обязателен, иначе flex-контейнер не даёт себе схлопнуться
            под overflowY:auto и скролл не работает (стандартная ловушка flex+scroll). */}
        <div ref={listRef} style={{
          flex: 1, minHeight: 0, overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 10,
          padding: `10px var(--pad-island) var(--pad-island)`,
        }}>
          {/* ⚠️ Подсказки пустого состояния здесь БОЛЬШЕ НЕТ. Она висела вверху пустой ленты, а
              карточки скиллов прижаты к полю ввода внизу — между ними зияла дыра во весь экран,
              и это читалось как поломка, а не как «пока пусто». Теперь она стоит подписью НАД
              карточками, то есть там же, где ответ на вопрос «а что я могу спросить». */}

          {messages.map((m, i) => (
            // Ответ модели — БЕЗ подложки и во всю ширину: так он выглядит в любом чат-боте,
            // и так его удобнее читать. Пузырь остаётся только у реплики пользователя —
            // он короткий и его роль в том, чтобы отделиться от ответа (ср. Hub.tsx).
            <div key={i} style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'stretch',
              maxWidth: m.role === 'user' ? '82%' : '100%',
              padding: m.role === 'user' ? '8px 12px' : '2px 0',
              borderRadius: m.role === 'user' ? 14 : 0,
              background: m.role === 'user' ? 'var(--accent)' : 'transparent',
              color: m.role === 'user' ? 'var(--text-on-accent)' : 'var(--text-strong)',
              overflowWrap: 'anywhere',
            }}>
              {m.role === 'assistant' ? (
                <ReactMarkdown components={markdownComponents}>{m.text}</ReactMarkdown>
              ) : (
                <span style={{
                  fontSize: 'var(--fs-md)', lineHeight: 'var(--lh-body)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {m.text}
                </span>
              )}
            </div>
          ))}

          {/* «Печатающееся» сообщение ассистента — тот же markdown-рендер до и после финализации
              (react-markdown нормально переживает промежуточный незакрытый синтаксис), что и
              в поповере. */}
          {sending && (
            // ⚠️ Ровно та же геометрия, что у ГОТОВОГО ответа выше: без подложки, во всю ширину,
            // те же отступы. Раньше здесь был серый пузырь на 82% ширины, и в момент завершения
            // генерации ответ прыгал — менял ширину, отступы, скругление и фон разом. Читалось
            // так, будто подложка «спадает» с готового ответа. Правило простое: печатающийся
            // ответ и завершённый — это один и тот же ответ, отличаться им нечем.
            <div style={{
              alignSelf: 'stretch', maxWidth: '100%',
              padding: '2px 0', borderRadius: 0,
              background: 'transparent', color: 'var(--text-strong)',
              overflowWrap: 'anywhere',
            }}>
              {streamedText.length > 0 ? (
                <ReactMarkdown components={markdownComponents}>{streamedText}</ReactMarkdown>
              ) : factChecking ? (
                // Явный индикатор, отличный от «мгновенного» «…» локальных кнопок — Gemini с
                // Search Grounding занимает заметно дольше и не стримит частями, «…» тут читался
                // бы как зависание и мог спровоцировать повторный клик.
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontSize: 'var(--fs-sm)', color: 'var(--text-faint)',
                }}>
                  <Loader2 size={13} style={{ animation: 'oblako-spin 1s linear infinite' }} />
                  Анализирую источники…
                </span>
              ) : webSearching ? (
                // Та же дыра, что чинит factChecking выше: до первого чанка от Qwen main ещё ждёт
                // ответа от SearXNG — без явного текста «…» читался бы как зависание.
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  fontSize: 'var(--fs-sm)', color: 'var(--text-faint)',
                }}>
                  <Loader2 size={13} style={{ animation: 'oblako-spin 1s linear infinite' }} />
                  Ищу в интернете…
                </span>
              ) : (
                <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>…</span>
              )}
            </div>
          )}

          {error && (() => {
            const { heading, detail, showModelButton } = describeChatError(error, errorCode)
            return (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 8,
                padding: '10px 12px',
                borderRadius: 'var(--radius-chip)',
                background: 'color-mix(in srgb, var(--danger-500) 10%, var(--surface-solid))',
                border: '1px solid color-mix(in srgb, var(--danger-500) 30%, transparent)',
              }}>
                <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
                  {heading}
                </div>
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', lineHeight: 'var(--lh-body)' }}>
                  {detail}
                </div>
                {showModelButton && (
                  <button
                    onClick={() => window.aiPanel.openSettings('ai')}
                    style={{
                      alignSelf: 'flex-start',
                      padding: '5px 12px', borderRadius: 'var(--radius-chip)', border: 'none',
                      background: 'var(--accent)', color: 'var(--on-accent)',
                      fontSize: 'var(--fs-xs)', fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    Выбрать модель
                  </button>
                )}
              </div>
            )
          })()}
        </div>

        {/* Кнопки-подсказки над полем ввода.
            ⚠️ Раньше ряд жил под условием `messages.length === 0 && !sending` — то есть скилл был
            буквально ОДНОРАЗОВЫЙ: попросил саммари, и попросить второй раз уже нечем, кнопки
            исчезли вместе с первым же ответом. Теперь ряд не исчезает никогда, а в начатой беседе
            переходит в компактный вид (chipsCompact выше). Плашка приватности фактчека занимает
            то же место — она по-прежнему взаимоисключающа с рядом (см. showFactCheckConfirm). */}
        {(
          // ⚠️ ТРИ ветки, и у каждой свой key. React переиспользует узел того же типа в той же
          // позиции, а к узлу ряда привязан ResizeObserver замера строки — именно так однажды
          // и вышло, что он мерил плашку фактчека вместо ряда (разбор у attachChips). Разные key
          // заставляют React честно размонтировать предыдущую ветку: ref-колбэк получает null,
          // наблюдатель отцепляется, мусорных чисел не остаётся.
          showFactCheckConfirm ? (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 8,
              margin: `0 var(--pad-island) 8px`,
              padding: '12px 14px',
              borderRadius: 'var(--radius-card)',
              background: 'var(--surface-solid)',
              border: '1px solid var(--glass-edge)',
              boxShadow: 'var(--shadow-card)',
              flexShrink: 0,
            }}>
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-body)', lineHeight: 'var(--lh-body)', overflowWrap: 'anywhere' }}>
                Текст страницы и запрос уйдут в облако (Google Gemini) для проверки по реальным
                источникам в интернете.
              </span>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setShowFactCheckConfirm(false)}
                  style={{
                    padding: '5px 12px', borderRadius: 'var(--radius-chip)', border: 'none',
                    background: 'transparent', color: 'var(--text-muted)',
                    fontSize: 'var(--fs-xs)', fontWeight: 500, cursor: 'pointer',
                  }}
                >
                  Отмена
                </button>
                <button
                  onClick={sendFactCheck}
                  style={{
                    padding: '5px 12px', borderRadius: 'var(--radius-chip)', border: 'none',
                    background: 'var(--accent)', color: 'var(--on-accent)',
                    fontSize: 'var(--fs-xs)', fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Продолжить
                </button>
              </div>
            </div>
          ) : !chipsCompact ? (
            // ПУСТАЯ БЕСЕДА — карточки, а не чипы.
            //
            // ⚠️ Скилл в настройках и скилл в панели до этого выглядели как две разные вещи: там
            // карточка со значком и куском промпта, здесь чип кеглем 11. Место под ними свободно
            // ровно один раз — пока разговор не начат, — и это единственный момент, когда человек
            // выбирает, ЧТО спросить, а не спрашивает дальше.
            //
            // ⚠️ Чернилами карточки тут НЕ залиты, в отличие от настроек, и это не забывчивость:
            // там заливка означает «скилл включён», а в панель попадают только включённые — то
            // есть означать ей нечего. Четыре чёрных прямоугольника поверх чужой страницы были бы
            // весом без смысла.
            <div key="skill-cards" style={{
              padding: `0 var(--pad-island)`, marginBottom: 8, flexShrink: 0,
              display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              <span className="ai-empty-hint" style={{ ...CAPS, display: 'block' }}>
                {modelState && !modelState.label
                  ? 'модели нет — скачайте её в настройках'
                  : modelState && !modelState.loaded
                    ? 'что сделать со страницей · первый ответ дольше, модель поднимается'
                    : 'что сделать со страницей'}
              </span>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              {[
                { id: 'translate', icon: '🌐', label: 'Перевести', hint: 'Страницу на русский', onPress: sendQuickTranslate },
                ...(factCheckAvailable
                  ? [{ id: 'factcheck', icon: '🔍', label: 'Фактчек', hint: 'Проверить по источникам в сети', onPress: () => setShowFactCheckConfirm(true) }]
                  : []),
                ...skills.filter((skill) => skill.visible).map((skill) => ({
                  id: skill.id,
                  icon: skill.icon || '✳',
                  label: skill.label,
                  hint: skill.prompt.length > 64 ? `${skill.prompt.slice(0, 64)}…` : skill.prompt,
                  onPress: () => sendText(skill.prompt),
                })),
              ].map((card, i) => (
                <button
                  key={card.id}
                  onClick={card.onPress}
                  disabled={chipsBusy}
                  style={{
                    position: 'relative', overflow: 'hidden',
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4,
                    minHeight: 92, padding: '10px 11px', textAlign: 'left',
                    borderRadius: 'var(--radius-card)', border: 'none',
                    background: 'var(--text-strong)', color: 'var(--app-bg)',
                    boxShadow: 'var(--shadow-chip)',
                    cursor: chipsBusy ? 'default' : 'pointer',
                    opacity: chipsBusy ? 0.5 : 1,
                    font: 'inherit',
                    transition: 'transform var(--dur-fast) var(--ease-out)',
                  }}
                  onMouseEnter={(e) => { if (!chipsBusy) e.currentTarget.style.transform = 'translateY(-2px)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; }}
                >
                  {/* Цветное пятно — то же, что у карточки скилла в настройках: оно и отличает
                      кнопки друг от друга. Без него девять чернильных прямоугольников подряд
                      сливаются в один чёрный блок. */}
                  <span aria-hidden style={{
                    position: 'absolute', width: 120, height: 96, right: -30, top: -34,
                    borderRadius: '50%', pointerEvents: 'none',
                    background: `radial-gradient(circle at 40% 40%, ${SKILL_STAIN[i % SKILL_STAIN.length]}, transparent 68%)`,
                    opacity: 0.55,
                  }} />
                  <span style={{ position: 'relative', fontSize: 20, lineHeight: 1 }}>{card.icon}</span>
                  <span style={{ ...DISPLAY_ROW, position: 'relative', display: 'block', color: 'var(--app-bg)' }}>
                    {card.label}
                  </span>
                  <span style={{
                    ...TEXT.caption, position: 'relative',
                    color: 'color-mix(in srgb, var(--app-bg) 66%, transparent)',
                    display: '-webkit-box',
                    WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
                  }}>{card.hint}</span>
                </button>
              ))}
              {/* «Настроить AI» — последней ячейкой, а не значком в углу: в сетке у него есть своё
                  место, и он не спорит с карточками за верхний правый угол. */}
              <button
                onClick={() => window.aiPanel.openSettings('ai')}
                title="Настроить скиллы"
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 4,
                  minHeight: 92, padding: '10px 11px', textAlign: 'left',
                  borderRadius: 'var(--radius-card)',
                  border: '1px dashed var(--divider-strong)',
                  background: 'transparent', cursor: 'pointer', font: 'inherit',
                }}
              >
                <Plus size={20} style={{ color: 'var(--text-faint)' }} />
                <span style={{ ...DISPLAY_ROW, display: 'block', color: 'var(--text-strong)' }}>Свой скилл</span>
                <span style={{ ...TEXT.caption, color: 'var(--text-muted)' }}>
                  Кнопка со своим промптом
                </span>
              </button>
              </div>
            </div>
          ) : (
            // Внешняя строка: слева переносящаяся область чипов, справа НЕСДВИГАЕМЫЙ хвост
            // (шеврон + настройки). Хвост вынесен из потока чипов намеренно — попав в перенос, он
            // уезжал бы во вторую строку и в схлопнутом виде становился недоступен, а это
            // единственные две кнопки, которые обязаны быть под рукой всегда.
            <div key="chips-row" style={{
              display: 'flex', alignItems: 'flex-start', gap: 6,
              padding: `0 var(--pad-island)`,
              marginBottom: 8,
              flexShrink: 0,
            }}>
            <div
              ref={attachChips}
              style={{
                flex: '1 1 auto', minWidth: 0,
                display: 'flex', flexWrap: 'wrap', gap: 6,
                // Схлопнуто — ровно одна строка; развёрнуто — измеренная полная высота (не
                // `undefined`: к нему max-height не анимируется, ряд бы прыгал); пустая беседа —
                // без ограничения вовсе. Пока высота не измерена, ограничения тоже нет: лучше
                // кадр полной высоты, чем кадр со срезанными наполовину кнопками.
                maxHeight: !chipsCompact ? undefined
                  : chipsExpanded ? (chipsFullH ? chipsFullH + COLLAPSED_SLACK : undefined)
                    : (chipRowH ? chipRowH + COLLAPSED_SLACK : undefined),
                overflow: chipsCompact ? 'hidden' : 'visible',
                transition: 'max-height var(--dur-base) var(--ease-standard)',
              }}
            >
              {/* Перевести — спец-кнопка вне реестра скиллов (см. комментарий выше), всегда первая. */}
              <button
                onClick={sendQuickTranslate}
                disabled={chipsBusy}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  // Без этого flex ужимал бы чипы по ширине вместо переноса на новую строку, а
                  // длинная подпись скилла ломалась бы посреди слова.
                  flexShrink: 0, whiteSpace: 'nowrap',
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-chip)',
                  // Белая парящая кнопка — тот же принцип, что у поля ввода ниже (surface-solid +
                  // glass-edge), просто мельче и с --shadow-chip вместо --shadow-card (для
                  // чипа-кнопки уместнее лёгкая тень, не островная). Раньше сидела на
                  // --surface-sunken (серая в покое внутри уже белой панели) без hover вообще.
                  border: '1px solid var(--glass-edge)',
                  background: 'var(--surface-solid)',
                  boxShadow: 'var(--shadow-chip)',
                  color: 'var(--text-body)',
                  fontSize: 'var(--fs-xs)', fontWeight: 500,
                  cursor: chipsBusy ? 'default' : 'pointer',
                  opacity: chipsBusy ? 0.5 : 1,
                }}
                onMouseEnter={(e) => { if (!chipsBusy) e.currentTarget.style.background = 'var(--surface-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-solid)'; }}
              >
                <span>🌐</span> Перевести
              </button>
              {/* Заход D — видна ТОЛЬКО когда ключ Gemini подключён (см. onKeyStatus выше), не
                  disabled-серая: без ключа кнопки нет вообще. Тот же нейтральный стиль, что у
                  остальных подсказок — она такое же одно из равных действий, не отдельная
                  система/облако-роль (заход 3, новая дизайн-система убрала эту роль у violet).
                  ⚠️ Стоит СРАЗУ за «Перевести», до пользовательских скиллов, и это не косметика:
                  обе спец-кнопки заданы нами, а список скиллов человек наполняет сам и он может
                  быть длинным. В хвосте фактчек уезжал за обрез первой строки и выглядел как
                  пропавший — живая жалоба «а что с фактчеком, почему он исчезает». */}
              {factCheckAvailable && (
                <button
                  onClick={() => setShowFactCheckConfirm(true)}
                  disabled={chipsBusy}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    flexShrink: 0, whiteSpace: 'nowrap',
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-chip)',
                    border: '1px solid var(--glass-edge)',
                    background: 'var(--surface-solid)',
                    boxShadow: 'var(--shadow-chip)',
                    color: 'var(--text-body)',
                    fontSize: 'var(--fs-xs)', fontWeight: 500,
                    cursor: chipsBusy ? 'default' : 'pointer',
                    opacity: chipsBusy ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) => { if (!chipsBusy) e.currentTarget.style.background = 'var(--surface-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-solid)'; }}
                >
                  <span>🔍</span> Фактчек
                </button>
              )}
              {/* Коммит 1 (реестр скиллов) — Объяснить/Саммари и позже пользовательские, из
                  onSkillsList (SkillsStore.ts), тот же стиль кнопки, что и Перевести выше.
                  Заход «видимость»: панель получает ПОЛНЫЙ список (включая скрытые) — фильтр
                  на рендере, не на источнике (Settings показывает и скрытые тоже). */}
              {skills.filter((skill) => skill.visible).map((skill) => (
                <button
                  key={skill.id}
                  onClick={() => sendText(skill.prompt)}
                  disabled={chipsBusy}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    flexShrink: 0, whiteSpace: 'nowrap',
                    padding: '6px 12px',
                    borderRadius: 'var(--radius-chip)',
                    border: '1px solid var(--glass-edge)',
                    background: 'var(--surface-solid)',
                    boxShadow: 'var(--shadow-chip)',
                    color: 'var(--text-body)',
                    fontSize: 'var(--fs-xs)', fontWeight: 500,
                    cursor: chipsBusy ? 'default' : 'pointer',
                    opacity: chipsBusy ? 0.5 : 1,
                  }}
                  onMouseEnter={(e) => { if (!chipsBusy) e.currentTarget.style.background = 'var(--surface-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-solid)'; }}
                >
                  {skill.icon && <span>{skill.icon}</span>}
                  {skill.label}
                </button>
              ))}
              {/* ⚠️ «+» здесь БОЛЬШЕ НЕТ: ряд рисуется только в начатой беседе (chipsCompact),
                  а там «+» и так стоит в несдвигаемом хвосте ниже. В пустой беседе его место —
                  пунктирная карточка «Свой скилл» в сетке. */}
            </div>
            {/* Шеврон «показать все» — только когда строк действительно больше одной (chipsOverflow
                меряется, а не угадывается) и только в схлопывающемся режиме. Разворачивает ВСЕ
                подсказки разом: со скиллами человек работает списком, а не выискивает нужную. */}
            {chipsCompact && chipsOverflow && (
              <button
                onClick={() => setChipsExpanded((v) => !v)}
                title={chipsExpanded ? 'Свернуть подсказки' : 'Показать все подсказки'}
                aria-expanded={chipsExpanded}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                  padding: '6px 8px',
                  borderRadius: 'var(--radius-chip)',
                  border: '1px solid var(--glass-edge)',
                  background: 'var(--surface-solid)',
                  boxShadow: 'var(--shadow-chip)',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-solid)'; }}
              >
                <ChevronDown
                  size={13}
                  style={{
                    transform: chipsExpanded ? 'rotate(180deg)' : 'none',
                    transition: 'transform var(--dur-fast) var(--ease-standard)',
                  }}
                />
              </button>
            )}
            {/* В схлопнутом ряду «+» живёт здесь, в несдвигаемом хвосте, — иначе он уехал бы за
                обрез вместе с лишними строками. См. парную ветку внутри области чипов. */}
            {chipsCompact && settingsChip}
            </div>
          )
        )}

        {/* Плашка согласия на web-grounding — та же механика, что у фактчека (обязательна перед
            КАЖДЫМ включением, без «запомнить»), но текст честный про СВОЮ инфраструктуру: это не
            облако третьей стороны, а собственный сервер пользователя, поэтому и формулировка другая. */}
        {showWebGroundingConfirm && (
          <div style={{
            display: 'flex', flexDirection: 'column', gap: 8,
            margin: `0 var(--pad-island) 8px`,
            padding: '12px 14px',
            borderRadius: 'var(--radius-card)',
            background: 'var(--surface-solid)',
            border: '1px solid var(--glass-edge)',
            boxShadow: 'var(--shadow-card)',
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-body)', lineHeight: 'var(--lh-body)', overflowWrap: 'anywhere' }}>
              Запросы поиска будут отправлены на твой поисковый сервер через VPN.
            </span>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowWebGroundingConfirm(false)}
                style={{
                  padding: '5px 12px', borderRadius: 'var(--radius-chip)', border: 'none',
                  background: 'transparent', color: 'var(--text-muted)',
                  fontSize: 'var(--fs-xs)', fontWeight: 500, cursor: 'pointer',
                }}
              >
                Отмена
              </button>
              <button
                onClick={confirmWebGrounding}
                style={{
                  padding: '5px 12px', borderRadius: 'var(--radius-chip)', border: 'none',
                  background: 'var(--accent)', color: 'var(--on-accent)',
                  fontSize: 'var(--fs-xs)', fontWeight: 600, cursor: 'pointer',
                }}
              >
                Продолжить
              </button>
            </div>
          </div>
        )}

        {/* Поле ввода — Enter отправляет, Shift+Enter переносит строку. Кнопка отправки —
            единственный акцентный (--accent) элемент здесь, как и просит цветовой закон
            (send — одно из немногих мест, где акцент уместен). Глобус — исключение по смыслу,
            не по цвету: это НЕ send-действие, а залипающий тоггл состояния, поэтому активное
            состояние светится accent-обводкой/фоном, а не отправляет ничего само по себе. */}
        <div style={{
          padding: 'var(--pad-island)',
          flexShrink: 0,
        }}>
          {/* Белая парящая карточка вместо серой заливки прямо на textarea — тот же стиль, что
              у поля ввода в Hub.tsx (:450-454), переиспользован буквально (surface-solid +
              glass-edge + shadow-card + radius-island), не изобретали новый. Внешний div выше
              не трогали — это panel-edge отступ (--pad-island используется так же по всей
              aipanel.tsx), card — отдельный вложенный уровень, чтобы не сдвинуть остальную
              вёрстку панели. */}
          <div style={{
            display: 'flex', alignItems: 'flex-end', gap: 8,
            padding: '12px 14px',
            background: 'var(--surface-solid)',
            borderRadius: 'var(--radius-island)', boxShadow: 'var(--shadow-card)',
            border: '1px solid var(--glass-edge)',
          }}>
            <button
              onClick={handleGlobeClick}
              title={
                !searxngConfigured
                  ? 'Веб-поиск не настроен — открыть настройки'
                  : webGroundingActive
                    ? 'Веб-поиск включён — нажмите, чтобы выключить'
                    : 'Включить веб-поиск (SearXNG)'
              }
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 34, height: 34, flexShrink: 0,
                background: webGroundingActive ? 'var(--accent-soft)' : 'transparent',
                border: webGroundingActive ? '1.5px solid var(--accent)' : '1.5px solid transparent',
                borderRadius: '50%',
                color: webGroundingActive ? 'var(--accent)' : 'var(--text-muted)',
                cursor: 'pointer', padding: 0,
              }}
            >
              <Globe size={16} strokeWidth={2} />
            </button>
            <textarea
              className="ai-composer-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              // Встали в поле — main начинает греть модель (с отсрочкой, см. WARMUP_DEFER_MS).
              // Раньше это делало само открытие панели, и человек, зашедший за калькулятором,
              // платил ~900 мс подвисания main ни за что.
              onFocus={() => window.aiPanel.chatIntent()}
              placeholder="Написать сообщение…"
              rows={1}
              style={{
                flex: 1, resize: 'none', maxHeight: 96,
                border: 'none', outline: 'none',
                background: 'transparent', borderRadius: 'var(--radius-chip)',
                padding: '8px 12px', fontSize: 'var(--fs-md)', fontFamily: 'var(--font-sans)',
                color: 'var(--text-strong)',
              }}
            />
            <button
              onClick={handleSend}
              disabled={sending || !input.trim()}
              title="Отправить"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 34, height: 34, flexShrink: 0,
                background: 'var(--accent)', border: 'none', borderRadius: '50%',
                color: 'var(--text-on-accent)',
                cursor: sending || !input.trim() ? 'default' : 'pointer',
                opacity: sending || !input.trim() ? 0.45 : 1,
                padding: 0,
              }}
            >
              <Send size={15} strokeWidth={2} />
            </button>
          </div>
        </div>
        </div>
        {/* display:none, а не условный рендер — состояние приложений (идущий таймер, набранное
            в калькуляторе) переживает переключение в чат и обратно. */}
        <div className={mode === 'apps' ? 'oblako-mode-in' : undefined} style={{
          flex: 1, minHeight: 0,
          display: mode === 'apps' ? 'flex' : 'none', flexDirection: 'column',
        }}>
          <AppsMode
            wallpaper={wallpaper}
            onSelectWallpaper={selectWallpaper}
            requestedApp={requestedApp}
            onRequestHandled={() => setRequestedApp(null)}
          />
        </div>
      </div>
    </div>
  );
}

// ── Переключатель режимов AI/Приложения — визуально и структурно клон ModeToggle/ModeButton
// из src/components/Hub.tsx (тот же --radius-pill/--surface-sunken/--shadow-chip рецепт), но
// на свои два варианта — отдельный компонент, не общий с Hub.tsx: aipanel.tsx живёт в изолированной
// WebContentsView со своим бандлом (см. vite.config.ts), общий импорт между entry-points не заведён.
function ModeToggle({ mode, onChange }: { mode: 'chat' | 'apps'; onChange: (m: 'chat' | 'apps') => void }) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const btns = useRef<(HTMLButtonElement | null)[]>([]);
  // Геометрия плашки. Считаем по реальным кнопкам: «AI» и «Приложения» разной ширины, и
  // делить пополам нельзя — плашка не совпала бы с подписью.
  const [box, setBox] = useState({ left: 3, width: 0 });
  const [drag, setDrag] = useState<number | null>(null);   // смещение под пальцем, px
  const index = mode === 'chat' ? 0 : 1;

  const measure = useCallback(() => {
    const host = wrap.current;
    const b = btns.current[index];
    if (!host || !b) return;
    setBox({ left: b.offsetLeft, width: b.offsetWidth });
  }, [index]);

  useEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [measure]);

  // Перетаскивание плашки. Пока тянут — она идёт за курсором без перехода, на отпускании
  // выбирается ближайшая половина и включается плавный доводчик.
  // ⚠️ Тащить можно ТОЛЬКО за плашку. Когда этот же обработчик висел и на кнопках, перетаскивание
  // с кнопки заканчивалось её обычным click — он возвращал прежний режим, и выбор откатывался.
  // Визуально плашка ехала, а результат не менялся.
  const onPointerDown = (e: React.PointerEvent) => {
    const host = wrap.current;
    if (!host) return;
    const startX = e.clientX;
    let moved = false;
    const base = box.left;
    const move = (ev: PointerEvent) => {
      const first = btns.current[0], second = btns.current[1];
      if (!first || !second) return;
      if (Math.abs(ev.clientX - startX) > 3) moved = true;
      const min = first.offsetLeft, max = second.offsetLeft;
      setDrag(Math.max(min - base, Math.min(max - base, ev.clientX - startX)));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const first = btns.current[0], second = btns.current[1];
      setDrag(null);
      if (!first || !second) return;
      // Клик по самой плашке (без протаскивания) режим не меняет — менять нечего.
      if (!moved) return;
      // Перевалили середину между центрами кнопок — переключаемся.
      const centre = base + (ev.clientX - startX) + box.width / 2;
      const middle = (first.offsetLeft + first.offsetWidth / 2
        + second.offsetLeft + second.offsetWidth / 2) / 2;
      onChange(centre < middle ? 'chat' : 'apps');
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      ref={wrap}
      style={{
        position: 'relative', display: 'inline-flex', flex: 'none', padding: 3, gap: 2,
        background: 'var(--surface-sunken)', borderRadius: 'var(--radius-pill)',
        border: '1px solid var(--glass-edge)',
      }}
    >
      {/* Плашка — ОДИН элемент, который ездит, а не белый фон, перескакивающий с кнопки на
          кнопку. Именно от перескока переключатель и выглядел мёртвым. */}
      <div
        onPointerDown={onPointerDown}
        style={{
          position: 'absolute', top: 3, bottom: 3, left: box.left, width: box.width,
          background: 'var(--surface-solid)', boxShadow: 'var(--shadow-chip)',
          borderRadius: 'var(--radius-pill)', cursor: 'grab', touchAction: 'none',
          transform: drag === null ? 'none' : `translateX(${drag}px)`,
          // Пока тянут — никакого перехода, плашка обязана идти ровно за курсором.
          transition: drag === null
            ? 'left 260ms var(--ease-out), width 260ms var(--ease-out)'
            : 'none',
        }}
      />
      <ModeButton
        refCb={(el) => { btns.current[0] = el; }} active={mode === 'chat'}
        onClick={() => onChange('chat')}
        icon={<Sparkles size={14} />} label="AI"
      />
      <ModeButton
        refCb={(el) => { btns.current[1] = el; }} active={mode === 'apps'}
        onClick={() => onChange('apps')}
        icon={<LayoutGrid size={14} />} label="Приложения"
      />
    </div>
  );
}

function ModeButton({ active, onClick, icon, label, refCb }: {
  active: boolean; onClick: () => void;
  icon: JSX.Element; label: string; refCb: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button
      ref={refCb}
      onClick={onClick}
      style={{
        position: 'relative', zIndex: 1,
        display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px',
        border: 'none', borderRadius: 'var(--radius-pill)', cursor: 'pointer',
        fontSize: 'var(--fs-xs)', fontWeight: 600,
        background: 'transparent', boxShadow: 'none',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
        transition: 'color var(--dur-base) var(--ease-standard)',
        touchAction: 'none',
      }}
    >
      {icon}{label}
    </button>
  );
}

installOverlayReveal();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AiPanel />
  </React.StrictMode>,
);
