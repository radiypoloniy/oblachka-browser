import type { WebContents } from 'electron';
import { disputedKeyStuckInFrame, disputedPageAction } from './tabHotkeyPolicy';

export interface TabHotkeyHost {
  ownsWebContents(id: number): boolean;
  screenshotOpen(): boolean;
  closeScreenshot(): void;
  findBarOpen(): boolean;
  closeFind(): void;
  omniboxEditing(): boolean;
  activeWebContents(): WebContents | null;
  openTaskManager(): void;
  reload(): void;
  toggleDevTools(): void;
  goBack(): void;
  goForward(): void;
  openHub(): void;
  reopenLastClosedTab(): void;
  openNewWindow(): void;
  newIncognitoTab(): void;
  returnActiveTab(): void;
  closeActiveTab(): void;
  selectNext(): void;
  selectPrev(): void;
  zoomIn(): void;
  zoomOut(): void;
  resetZoom(): void;
  runPageHotkey(action: string): void;
  openFind(): void;
  quickSearch(): void;
  openHistory(): void;
  bookmarkPage(): void;
  reloadHard(): void;
  focusOmnibox(): void;
  captureScreenshot(): void;
  saveScreenshot(): void;
  openBookmarks(): void;
  toggleClipboard(): void;
  selectByIndex(index: number): void;
}

// source — откуда пришёл ввод. Слой хрома принадлежит окну навсегда; вкладка может уехать
// в другое окно, и тогда слушатель прежнего менеджера обязан замолчать.
export function wireTabHotkeys(wc: WebContents, source: 'chrome' | 'tab', host: TabHotkeyHost): void {
  wc.on('before-input-event', (event, input) => {
    // ⚠️ Тот же закон, что у mine() в проводке страницы: после переезда вкладки слушатель
    // ПРЕЖНЕГО менеджера остаётся на webContents навсегда, снять его выборочно нечем.
    // Без проверки один Ctrl+W закрывал вкладку и здесь, и в старом окне (там — свою активную).
    if (source === 'tab' && !host.ownsWebContents(wc.id)) return;
    if (input.type !== 'keyDown') return;
    const { code, shift } = input;

    if (!input.control) {
      // Esc: карточка снимка (поверх всего) → FindBar → иначе остановить загрузку.
      // В омнибоксе клавиша принадлежит React: он вернёт прежний адрес, а stop() здесь был бы чужим.
      if (code === 'Escape' && !shift) {
        if (host.screenshotOpen()) {
          event.preventDefault();
          host.closeScreenshot();
        } else if (host.findBarOpen()) {
          event.preventDefault();
          host.closeFind();
        } else if (host.omniboxEditing()) {
          // не гасим: Toolbar::handleKeyDown вернёт адрес
        } else {
          const active = host.activeWebContents();
          if (active) { event.preventDefault(); active.stop(); }
        }
        return;
      }
      // Shift+Esc отдельной веткой: иначе обычный Esc и диспетчер спорили бы за одну клавишу.
      if (code === 'Escape' && shift) { event.preventDefault(); host.openTaskManager(); return; }
      if (code === 'F5' && !shift) { event.preventDefault(); host.reload(); return; }
      if (code === 'F12' && !shift && !input.alt) { event.preventDefault(); host.toggleDevTools(); return; }
      if (code === 'ArrowLeft' && input.alt && !shift) { event.preventDefault(); host.goBack(); return; }
      if (code === 'ArrowRight' && input.alt && !shift) { event.preventDefault(); host.goForward(); return; }
      return;
    }

    if (code === 'KeyT' && !shift) {
      event.preventDefault(); host.openHub();
    } else if (code === 'KeyT' && shift) {
      event.preventDefault(); host.reopenLastClosedTab();
    } else if (code === 'KeyN' && !shift) {
      event.preventDefault(); host.openNewWindow();
    } else if (code === 'KeyN' && shift) {
      event.preventDefault(); host.newIncognitoTab();
    } else if (code === 'KeyM' && shift) {
      event.preventDefault(); host.returnActiveTab();
    } else if (code === 'KeyW' && !shift) {
      event.preventDefault(); host.closeActiveTab();
    } else if (code === 'Tab' && !shift) {
      event.preventDefault(); host.selectNext();
    } else if (code === 'Tab' && shift) {
      event.preventDefault(); host.selectPrev();
    } else if (code === 'Equal' || code === 'NumpadAdd') {
      event.preventDefault(); host.zoomIn();
    } else if (code === 'Minus' || code === 'NumpadSubtract') {
      event.preventDefault(); host.zoomOut();
    } else if (code === 'Digit0' || code === 'Numpad0') {
      event.preventDefault(); host.resetZoom();
    // Ctrl+F/E/D/R/H на странице ждут preload: редакторы могут использовать их сами.
    // В chrome-слое preload страницы нет; в чужом iframe он не видит keydown.
    } else if (source === 'tab' && !shift && disputedPageAction(code) !== undefined
      && disputedKeyStuckInFrame(wc)) {
      event.preventDefault(); host.runPageHotkey(disputedPageAction(code)!);
    } else if (source === 'chrome' && code === 'KeyF' && !shift) {
      event.preventDefault(); host.openFind();
    } else if (source === 'chrome' && code === 'KeyE' && !shift) {
      event.preventDefault(); host.quickSearch();
    } else if (source === 'chrome' && code === 'KeyR' && !shift) {
      event.preventDefault(); host.reload();
    } else if (source === 'chrome' && code === 'KeyH' && !shift) {
      event.preventDefault(); host.openHistory();
    } else if (source === 'chrome' && code === 'KeyD' && !shift) {
      event.preventDefault(); host.bookmarkPage();
    } else if ((code === 'KeyR' && shift) || code === 'F5') {
      event.preventDefault(); host.reloadHard();
    } else if (code === 'KeyL' && !shift) {
      event.preventDefault(); host.focusOmnibox();
    } else if (code === 'KeyS' && shift) {
      event.preventDefault(); host.captureScreenshot();
    } else if (code === 'KeyS' && !shift && host.screenshotOpen()) {
      // Без карточки Ctrl+S остаётся странице: сохранения страницы у браузера пока нет.
      event.preventDefault(); host.saveScreenshot();
    } else if (code === 'KeyO' && shift) {
      event.preventDefault(); host.openBookmarks();
    } else if (code === 'KeyB' && shift) {
      event.preventDefault(); host.toggleClipboard();
    } else if (code === 'KeyI' && shift) {
      event.preventDefault(); host.toggleDevTools();
    } else if (code.startsWith('Digit') && !shift) {
      const index = parseInt(code[5]!, 10);
      if (index >= 1 && index <= 9) { event.preventDefault(); host.selectByIndex(index); }
    }
  });
}
