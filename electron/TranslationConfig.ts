// Единственное место, где живёт целевой язык автоперевода (см. resolveDirection в
// TranslationService.ts). Пока без UI — дефолт 'ru' (вариант A: иностранное → русский,
// русский → английский). Когда кнопка настроек AI (Settings.tsx, секция 'ai') станет активной,
// она будет читать/писать через getTargetLang/setTargetLang — TranslationService трогать не придётся.
let targetLang = 'ru'

export function getTargetLang(): string {
  return targetLang
}

export function setTargetLang(lang: string): void {
  targetLang = lang
}
