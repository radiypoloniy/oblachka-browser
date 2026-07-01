// Изолированный тест-мост перевода: живое поле ввод→вывод для ручной проверки качества
// EuroLLM-1.7B (node-llama-cpp). Не React, не часть боевого чрома — временный, за флагом
// OBLAKO_TRANSLATE_TEST=1 (electron/main.ts). Мост к main — electron/translateTestBridge.ts.
export {} // делает файл модулем — нужно для declare global ниже

type Direction = 'ru->en' | 'en->ru' | 'auto'
type TranslateResult =
  | { ok: true; out: string; dirUsed: 'ru->en' | 'en->ru'; ms: number; tokPerSec: number; loadMs: number | null }
  | { ok: false; error: string }

declare global {
  interface Window {
    translateTest: { run: (text: string, dir: Direction) => Promise<TranslateResult> }
  }
}

const input  = document.getElementById('input')  as HTMLTextAreaElement
const dirSel = document.getElementById('dir')     as HTMLSelectElement
const goBtn  = document.getElementById('go')      as HTMLButtonElement
const output = document.getElementById('output')  as HTMLDivElement
const statusEl = document.getElementById('status') as HTMLDivElement

async function runTranslate(): Promise<void> {
  const text = input.value.trim()
  if (!text) return

  goBtn.disabled = true
  statusEl.textContent = 'Перевожу… (первый вызов грузит модель, ~4с)'
  output.textContent = ''

  const dir = dirSel.value as Direction
  const result = await window.translateTest.run(text, dir)

  if (result.ok) {
    output.textContent = result.out
    const loadNote = result.loadMs !== null ? `, загрузка модели: ${result.loadMs.toFixed(0)}ms` : ''
    statusEl.textContent = `[${result.dirUsed}] ${result.ms.toFixed(0)}ms, ${result.tokPerSec.toFixed(1)} tok/s${loadNote}`
  } else {
    output.textContent = ''
    statusEl.textContent = `Ошибка: ${result.error}`
  }
  goBtn.disabled = false
}

goBtn.addEventListener('click', () => { void runTranslate() })
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault()
    void runTranslate()
  }
})
