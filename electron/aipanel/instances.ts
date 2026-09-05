// Экземпляры правой панели — по одному на окно.
//
// ⚠️ ВЫНЕСЕНО ИЗ AiPanelManager.ts не ради красоты: тот файл стоит на храповике структуры
// (scripts/fixtures/structure-baseline.json, 820 строк) и расти ему некуда — тот же повод, что у
// aipanel/panelStatus.ts.
//
// ⚠️ Панель БЫЛА синглтоном на приложение: panelView/attachedWin/isOpen жили модульными
// переменными, и держалось это ровно до второго окна. Одну WebContentsView нельзя показать в
// двух окнах — она ребёнок конкретного contentView, поэтому открытие панели во втором окне
// уводило её из первого, а первое об этом не узнавало: о закрытии сообщалось слою хрома
// ГЛАВНОГО окна, и резерв ширины под панель оставался висеть в окне, где панели уже нет.
// Путь туда существовал и без кнопки: плитка приложения на рабочем столе зовёт openPanelApp для
// СВОЕГО окна (electron/ipc/system.ts), а лёгкое окно рабочий стол показывает.
//
// Реестр устроен ровно как у поповеров (ClipboardPopoverManager, FindBarManager): Map по win.id,
// состояние заводится по требованию, вью закрывается вместе с окном.
import type { BrowserWindow, WebContents, WebContentsView } from 'electron'
import { closeWindowView } from '../viewTeardown'
import { contextForWindow, mainContext } from '../WindowRegistry'
import type { TabManager } from '../TabManager'

/**
 * Вид панели у окна.
 *
 * ⚠️ Решает РОЛЬ ОКНА, а не человек: 'full' — панель с чатом и приложениями, 'apps' — только
 * домашний экран приложений. В лёгком окне беседы быть не может по устройству: она привязана к
 * вкладкам главного окна (см. AiPanelManager.onTabsSynced), а извлечение страницы и модель
 * обслуживают его же. Приложения при этом ни от чего этого не зависят — они и едут.
 */
export type PanelKind = 'full' | 'apps'

export interface PanelInstance {
  win: BrowserWindow
  kind: PanelKind
  /** null — вью ещё не создана: панель ни разу не открывали и прогрев до неё не доехал. */
  view: WebContentsView | null
  /** Показана в окне прямо сейчас (то есть добавлена в contentView). */
  open: boolean
  /** На окно уже повешен слушатель resize, который двигает панель (вешаем один раз). */
  resizeBound: boolean
}

const panels = new Map<number, PanelInstance>()

/** Состояние панели этого окна; заводится по требованию, как у поповеров. */
export function panelFor(win: BrowserWindow): PanelInstance {
  const existing = panels.get(win.id)
  if (existing) return existing
  const created: PanelInstance = {
    win,
    kind: contextForWindow(win)?.role === 'light' ? 'apps' : 'full',
    view: null, open: false, resizeBound: false,
  }
  panels.set(win.id, created)
  // ⚠️ Вью закрываем сами: окно не уносит с собой дочерние WebContentsView, и панель закрытого
  // окна осталась бы жить отдельным процессом рендерера (замер и разбор — viewTeardown.ts).
  win.once('closed', () => {
    closeWindowView(panels.get(win.id)?.view)
    panels.delete(win.id)
  })
  return created
}

/** Панель окна, если она вообще заводилась. Без побочного эффекта — для чтения геометрии. */
export function existingPanel(win: BrowserWindow): PanelInstance | null {
  return panels.get(win.id) ?? null
}

/**
 * Панель, приславшая сообщение.
 *
 * ⚠️ Заменяет прежнее `attachedWin` в обработчиках IPC. Сообщение приходит ОТ КОНКРЕТНОЙ панели,
 * и адресат ответа обязан считаться от отправителя, а не от того, кого последним трогали:
 * ровно так «закрыть» из одного окна закрывало бы панель другого.
 */
export function panelBySender(sender: WebContents): PanelInstance | null {
  for (const st of panels.values()) if (st.view?.webContents === sender) return st
  return null
}

export function allPanels(): PanelInstance[] {
  return [...panels.values()]
}

/** Живые вью всех панелей — адресаты рассылки общего состояния приложения (см. panelStatus.ts). */
export function panelViews(): WebContentsView[] {
  const out: WebContentsView[] = []
  for (const st of panels.values()) {
    if (st.view && !st.view.webContents.isDestroyed()) out.push(st.view)
  }
  return out
}

/** Открыта ли панель хоть в каком-нибудь окне. */
export function anyPanelOpen(): boolean {
  for (const st of panels.values()) if (st.open) return true
  return false
}

// ── Окружение панели: чей это слой хрома и чьи вкладки ───────────────────────────────────────

/**
 * Слой хрома окна этой панели.
 *
 * ⚠️ Ссылки на него у панели БОЛЬШЕ НЕТ: слой у каждого окна свой, и единственная ссылка
 * означала бы «о закрытии панели всегда узнаёт главное окно» — а резерв ширины под панель
 * держит то окно, в котором её открыли. Берём слой у реестра окон, он там и так лежит.
 */
export function chromeOf(win: BrowserWindow): WebContents | null {
  const view = contextForWindow(win)?.chromeView
  return view && !view.webContents.isDestroyed() ? view.webContents : null
}

/**
 * Вкладки ТОГО ЖЕ окна: панель отдаёт фокус странице при закрытии и уводит внешние ссылки в
 * соседнюю вкладку — и то и другое обязано случиться в её собственном окне, а не в главном.
 */
export function tabsOf(win: BrowserWindow): TabManager | null {
  return contextForWindow(win)?.tabs ?? null
}

/**
 * Панель, которой принадлежит БЕСЕДА.
 *
 * ⚠️ Чат один на приложение и собран из снапшота вкладок ГЛАВНОГО окна (см.
 * AiPanelManager.onTabsSynced): показывать эту беседу в панели другого окна значило бы
 * рассказывать про чужие вкладки.
 */
export function chatPanel(): PanelInstance | null {
  const win = mainContext()?.win
  return win ? existingPanel(win) : null
}

/**
 * Панель, приславшая вопрос, всё ещё жива.
 *
 * ⚠️ Ответ модели адресуется КОНКРЕТНОЙ вью: пока шла генерация, панель могли закрыть (вью
 * уничтожена) или закрыть окно целиком. Раньше тем же занималась сверка с единственным
 * модульным panelView — теперь вью ищется в реестре по отправителю.
 */
export function panelAlive(wc: WebContents): boolean {
  return !wc.isDestroyed() && panelBySender(wc) !== null
}
