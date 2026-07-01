// Изолированный тест-мост для ручного теста перевода: живое поле ввод→вывод (src/translatetest.ts).
// Тонкая IPC-обвязка над production-сервисом TranslationService — логика перевода не дублируется.
// Не часть боевого чрома: регистрируется только при OBLAKO_TRANSLATE_TEST=1 (electron/main.ts).
import { ipcMain } from 'electron'
import { translate, type Direction } from './TranslationService'

export function initTranslateTestBridge(): void {
  ipcMain.handle('translatetest:run', (_e, text: string, dir: Direction) => translate(text, dir))
  console.log('[translatetest] bridge ready (модель загрузится по первому запросу)')
}
