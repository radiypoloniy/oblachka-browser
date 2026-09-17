// Встроенные скиллы панели. На диске хранится одна из стоковых пар «подпись + промпт»;
// язык экрана подставляется при чтении, пока человек их не правил.
import type { UiLanguage } from './uiLanguage';

export const BUILTIN_SKILL_IDS = ['explain', 'summary'] as const;

export interface BuiltinSkillText {
  label: string;
  prompt: string;
}

export const BUILTIN_SKILLS: Record<UiLanguage, Record<(typeof BUILTIN_SKILL_IDS)[number], BuiltinSkillText>> = {
  ru: {
    explain: { label: 'Объяснить', prompt: 'Объясни простыми словами, о чём эта страница.' },
    summary: { label: 'Сделать саммари', prompt: 'Сделай краткое саммари этой страницы.' },
  },
  en: {
    explain: { label: 'Explain', prompt: 'Explain in simple words what this page is about. Answer in English.' },
    summary: { label: 'Summarize', prompt: 'Write a short summary of this page in English.' },
  },
};

export function isStockBuiltinPrompt(id: string, label: string, prompt: string): boolean {
  return (['en', 'ru'] as const).some((language) => {
    const stock = BUILTIN_SKILLS[language][id as (typeof BUILTIN_SKILL_IDS)[number]];
    return stock !== undefined && stock.label === label && stock.prompt === prompt;
  });
}

export function localizeBuiltinSkill<T extends { id: string; label: string; prompt: string; builtin?: boolean }>(
  skill: T,
  language: UiLanguage,
): T {
  if (!skill.builtin) return skill;
  const next = BUILTIN_SKILLS[language][skill.id as (typeof BUILTIN_SKILL_IDS)[number]];
  if (!next || !isStockBuiltinPrompt(skill.id, skill.label, skill.prompt)) return skill;
  return { ...skill, label: next.label, prompt: next.prompt };
}
