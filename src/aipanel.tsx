// Правая AI-панель — чат с локальным Qwen (Заход 2), беседа привязана к вкладке (Заход 3).
// Дизайн (остров/тень/скругления/отступы/закрытие) не трогается — только контент внутри.
// Позиция/размер/открытие-закрытие по-прежнему в main (AiPanelManager.ts), эта страница просто
// рисует чипс страницы + ленту + поле ввода на весь свой вьюпорт.
// Беседы эфемерные, per-вкладка, БЕЗ персистентности — авторитетное хранилище (messages+history
// для Qwen) живёт в main (AiPanelManager.ts::tabContexts), эта страница только отображает то, что
// приходит через onContext при переключении/навигации/(пере)открытии панели. Свой собственный
// messages-стейт здесь — витрина: пополняется оптимистично при отправке и полностью ЗАМЕНЯЕТСЯ
// целиком при каждом onContext (переключили вкладку → другая лента, не дописывание к старой).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { Sparkles, X, Send, Globe, LayoutGrid, Plus } from 'lucide-react';
import './styles/global.css';
import { AiActivityPill } from './aipanel/AiActivityPill';
import { ModelChip } from './aipanel/parts/ModelChip';
import { AppsMode, loadWallpaper, saveWallpaper, wallpaperBackground } from './components/aiApps';
import { subscribeMeshes } from './newtab/gradients';
import { SHELL_MARGIN } from '../shared/layout';
import { installOverlayReveal } from './overlayReveal';
import { useAiChat } from './aipanel/useAiChat';
import { ActionsRow } from './aipanel/parts/ActionsRow'
import { MessageList } from './aipanel/parts/MessageList'
import { PageIsland } from './aipanel/parts/PageIsland'
import { useChipsRow } from './aipanel/useChipsRow';
import './aipanel/contract';

/**
 * Крупное действие над страницей — «Перевести» и «Фактчек».
 *
 * ⚠️ Их ровно два, и это условие, при котором им разрешено быть крупными: они заданы нами и
 * работают на любой странице. Пятно цвета осталось только здесь — на девяти карточках оно было
 * не различением, а витриной.
 */

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


function AiPanel() {
  // Беседа целиком — подписки на main, лента, признаки занятости и три способа отправки.
  const {
    tabId, pageTitle, pageUrl, pageFavicon, modelState,
    messages, streamedText, sending, error, errorCode,
    skills, factCheckAvailable, factChecking, searxngConfigured, webSearching,
    sendText, sendQuickTranslate, sendFactCheck,
  } = useAiChat()

  const [input, setInput] = useState('')
  // Ошибка загрузки favicon — чисто про <img> в шапке, к беседе отношения не имеет.
  const [faviconError, setFaviconError] = useState(false)
  // Плашка приватности перед фактчеком — обязательна каждый раз, без «запомнить».
  const [showFactCheckConfirm, setShowFactCheckConfirm] = useState(false)
  // Тоггл-глобус web-grounding: чисто локальный UI-стейт (не персистится, не переживает
  // переключение вкладки/перезапуск панели — тот же принцип, что mode ниже).
  // ⚠️ Плашка согласия у него СВОЯ, отдельная от фактчека: это разные независимые действия, и
  // общий флаг гасил бы одно при подтверждении другого.
  const [webGroundingActive, setWebGroundingActive] = useState(false)
  const [showWebGroundingConfirm, setShowWebGroundingConfirm] = useState(false)
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

  // Смена favicon (переключение вкладки/навигация) — сбрасываем прошлую ошибку загрузки,
  // иначе новая иконка не покажется, если старая когда-то не загрузилась.
  useEffect(() => { setFaviconError(false) }, [pageFavicon])

  // Автоскролл вниз при новом тексте — свои сообщения, ответы AI, стриминг по ходу генерации.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages, streamedText])

  const handleSend = () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    sendText(text, webGroundingActive)
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

  // Ряд подсказок: измерение строки, схлопывание и шеврон — в useChipsRow. ⚠️ Разбор ловушек
  // (почему ref-колбэк, а не useRef, и почему «строк больше одной» считается по offsetTop детей)
  // живёт там же, рядом с кодом, а не здесь.
  const chips = useChipsRow({ compact: chipsCompact, skills, factCheckAvailable })

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

        {/* ⚠️ Полосой под шапкой, а не пилюлей В шапке: панель узкая, а рядом с переключателем
            режимов индикатор либо ужимался бы до нечитаемого, либо выталкивал крестик. Здесь он
            виден в ОБОИХ режимах — работа ИИ не принадлежит ни чату, ни приложениям. */}
        <AiActivityPill />

        {/* Индикатор текущей страницы — парящий островок. Смена URL внутри вкладки обновит и его,
            и ленту (сброшенную на новый разговор) одним и тем же onContext. */}
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
      <PageIsland
        pageTitle={pageTitle} pageHost={pageHost} pageFavicon={pageFavicon}
        faviconError={faviconError} sending={sending}
        messages={messages} modelState={modelState} setFaviconError={setFaviconError}
      />

        {/* Лента сообщений — minHeight:0 обязателен, иначе flex-контейнер не даёт себе схлопнуться
            под overflowY:auto и скролл не работает (стандартная ловушка flex+scroll). */}
      <MessageList
        listRef={listRef} messages={messages} streamedText={streamedText}
        sending={sending} factChecking={factChecking} webSearching={webSearching}
        error={error} errorCode={errorCode} modelState={modelState}
      />

        {/* Кнопки-подсказки над полем ввода.
            ⚠️ Раньше ряд жил под условием `messages.length === 0 && !sending` — то есть скилл был
            буквально ОДНОРАЗОВЫЙ: попросил саммари, и попросить второй раз уже нечем, кнопки
            исчезли вместе с первым же ответом. Теперь ряд не исчезает никогда, а в начатой беседе
            переходит в компактный вид (chipsCompact выше). Плашка приватности фактчека занимает
            то же место — она по-прежнему взаимоисключающа с рядом (см. showFactCheckConfirm). */}
        <ActionsRow
          chips={chips} chipsBusy={chipsBusy} chipsCompact={chipsCompact}
          factCheckAvailable={factCheckAvailable}
          skills={skills} settingsChip={settingsChip}
          showFactCheckConfirm={showFactCheckConfirm} webGroundingActive={webGroundingActive}
          setShowFactCheckConfirm={setShowFactCheckConfirm}
          sendText={sendText} sendQuickTranslate={sendQuickTranslate} sendFactCheck={sendFactCheck}
        />

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
            /><ModelChip />
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
