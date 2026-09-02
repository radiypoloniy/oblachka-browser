import { useEffect, useState } from 'react';
import type { ChatMessage, ModelErrorCode, SkillItem } from './contract';

/**
 * Беседа AI-панели: всё, что приходит из main, и всё, что туда уходит.
 *
 * ⚠️ Лента здесь — ВИТРИНА, а не хранилище. Авторитетная беседа (сообщения + история для Qwen)
 * живёт в main (AiPanelManager.ts::tabContexts), она эфемерная и привязана к вкладке. Своё
 * состояние тут пополняется оптимистично при отправке и ПОЛНОСТЬЮ ЗАМЕНЯЕТСЯ при каждом
 * onContext: переключили вкладку — другая лента целиком, а не дописывание к старой.
 *
 * Наружу не отдаётся ни один сеттер: отправка идёт через три действия ниже, всё остальное
 * читается. Разделить «подписки» и «отправку» на два хука нельзя — они пишут одни и те же семь
 * полей (лента, стрим, признаки занятости, ошибка), и разделение вынесло бы эти сеттеры наружу.
 */
export function useAiChat() {
  // Что за страница под панелью — приезжает целиком одним onContext.
  const [tabId, setTabId] = useState<string | null>(null)
  const [pageTitle, setPageTitle] = useState('')
  const [pageUrl, setPageUrl] = useState('')
  const [pageFavicon, setPageFavicon] = useState<string | null>(null)
  const [modelState, setModelState] = useState<{ label: string | null; loaded: boolean } | null>(null)

  const [messages, setMessages] = useState<ChatMessage[]>([])
  // Копится по мере генерации (тот же токен-стриминг, что у поповера/AI-действий) — показывается
  // как «печатающееся» сообщение ассистента, пока не придёт финальный result.
  const [streamedText, setStreamedText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<ModelErrorCode | null>(null)

  // Коммит 1 (реестр скиллов) — prompt-кнопки (Объяснить/Саммари, позже пользовательские) из
  // main (SkillsStore.ts). Перевести/Фактчек в этот список не входят — они спец-кнопки.
  const [skills, setSkills] = useState<SkillItem[]>([])
  // Заход D — кнопка фактчека видна только когда ключ Gemini подключён (см. AiKeyStore.ts,
  // пуш через AiPanelManager.ts::sendKeyStatus).
  const [factCheckAvailable, setFactCheckAvailable] = useState(false)
  // ⚠️ Отдельный флаг ТОЛЬКО ради подписи «печатающегося» сообщения: вызов Gemini с Search
  // Grounding идёт заметно дольше локальной модели и без частичного стриминга, обычное «…»
  // выглядело бы как зависание — явный текст снижает риск повторного клика.
  const [factChecking, setFactChecking] = useState(false)
  // Пуш из AiPanelManager.ts::sendSearxngStatus — тот же источник, что читает секция настроек.
  const [searxngConfigured, setSearxngConfigured] = useState(false)
  // ⚠️ Фаза «идёт поиск в SearXNG», ДО первого чанка от Qwen: main сначала ждёт searxngSearch(),
  // генерация стартует только после. Без этого флага та же дыра, что чинил factChecking — пустой
  // streamedText молча висел бы, читаясь как зависание. Гасится первым чанком, тем же сигналом
  // «генерация началась».
  const [webSearching, setWebSearching] = useState(false)

  useEffect(() => {
    // Переключение вкладки / смена её URL / (пере)открытие панели / очистка беседы — main
    // присылает АВТОРИТЕТНУЮ ленту этой вкладки целиком. Любая незавершённая генерация
    // «протухшей» вкладки визуально гасится (sending/streamedText/error сбрасываются) — она
    // никуда не делась в main, просто эта страница её больше не показывает, пока пользователь не
    // вернётся на ту вкладку.
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
        setMessages((prev) => [...prev, { role: 'assistant', text: outcome.out, via: outcome.via }])
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

  // Общая точка отправки — и текстовое поле, и кнопки-подсказки шлют через неё «как будто
  // пользователь сам написал»: один и тот же путь (оптимистичное сообщение в ленте → sendChat).
  const sendText = (text: string, webGrounding: boolean) => {
    if (!text || sending || !tabId) return
    setMessages((prev) => [...prev, { role: 'user', text }])
    setStreamedText('')
    setError(null)
    setSending(true)
    setWebSearching(webGrounding)
    window.aiPanel.sendChat(text, webGrounding)
  }

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

  // Заход D — фактчек уходит в облако (Google Gemini), а не к локальной модели. Плашка
  // приватности обязательна перед КАЖДЫМ вызовом, и живёт она в компоненте: сюда попадают уже
  // после явного подтверждения.
  const sendFactCheck = () => {
    if (sending || !tabId) return
    setMessages((prev) => [...prev, { role: 'user', text: 'Фактчек' }])
    setStreamedText('')
    setError(null)
    setSending(true)
    setFactChecking(true)
    window.aiPanel.factCheck()
  }

  return {
    tabId, pageTitle, pageUrl, pageFavicon, modelState,
    messages, streamedText, sending, error, errorCode,
    skills, factCheckAvailable, factChecking, searxngConfigured, webSearching,
    sendText, sendQuickTranslate, sendFactCheck,
  }
}
