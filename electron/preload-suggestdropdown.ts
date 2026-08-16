// Минимальный preload для вью дропдауна подсказок (src/suggestdropdown.tsx). Своя маленькая
// точка входа, не боевой preload.ts (тот же принцип, что у preload-findbar.ts/preload-aipanel.ts).
// Заход 4/5: + клавиатурная подсветка (onHighlight) — вью только отрисовывает номер, ничего не решает.
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { SuggestDropdownItem, OmniboxPanel, OmniboxRecommendEdit } from '../shared/ipc'

contextBridge.exposeInMainWorld('suggestDropdown', {
  onItems: (cb: (items: SuggestDropdownItem[]) => void) => {
    const handler = (_e: unknown, items: SuggestDropdownItem[]) => cb(items)
    ipcRenderer.on('suggest-dropdown:items', handler)
    return () => ipcRenderer.removeListener('suggest-dropdown:items', handler)
  },
  // Заход 11 — панель по нетронутой строке (плитки + полоска сайта + «вы это уже читали»).
  // Тот же принцип, что у onItems: вью получает готовое и только рисует.
  onPanel: (cb: (panel: OmniboxPanel) => void) => {
    const handler = (_e: unknown, panel: OmniboxPanel) => cb(panel)
    ipcRenderer.on('suggest-dropdown:panel', handler)
    return () => ipcRenderer.removeListener('suggest-dropdown:panel', handler)
  },
  // Клик по полоске сайта в панели — main пересылает в chrome, Toolbar.tsx открывает поповер
  // замочка. Панель НЕ дублирует его содержимое: управление разрешениями живёт в одном месте.
  openSiteInfo: () => ipcRenderer.send(IPC.SUGGEST_DROPDOWN_SITE_INFO),
  // Правка набора «Рекомендуемые» из режима карандаша. ⚠️ Только add/remove уже известного сайта:
  // окно неактивируемое, набрать в нём адрес руками физически нельзя (см. OmniboxRecommendEdit).
  editRecommended: (edit: OmniboxRecommendEdit) => ipcRenderer.send(IPC.SUGGEST_DROPDOWN_RECOMMEND, edit),
  // Клик по строке — уходит в main как есть, main пересылает в chrome (IPC.SUGGEST_DROPDOWN_PICKED),
  // где Toolbar.tsx вызывает свой существующий pickSuggestion() (см. SuggestDropdownManager.ts::onPick).
  pick: (item: SuggestDropdownItem) => ipcRenderer.send('suggest-dropdown:pick', item),
  // Клавиатурная подсветка — номер строки от омнибокса (-1 = снять). Только отрисовка.
  onHighlight: (cb: (idx: number) => void) => {
    const handler = (_e: unknown, idx: number) => cb(idx)
    ipcRenderer.on(IPC.SUGGEST_DROPDOWN_HIGHLIGHT, handler)
    return () => ipcRenderer.removeListener(IPC.SUGGEST_DROPDOWN_HIGHLIGHT, handler)
  },
  // Заход 5 (кардинальный фикс): реальная высота карточки (ResizeObserver в suggestdropdown.tsx) —
  // main пересчитывает bounds самой вью под неё, вместо фиксированных 280px (см.
  // SuggestDropdownManager.ts). Тот же приём, что translate-popover:height у поповера перевода.
  reportHeight: (px: number) => ipcRenderer.send('suggest-dropdown:height', px),
})
