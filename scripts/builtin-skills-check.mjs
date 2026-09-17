import { BUILTIN_SKILLS, isStockBuiltinPrompt, localizeBuiltinSkill } from '../shared/builtinSkills.ts';

let passed = 0;
let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else { failed++; console.log(`  FAIL ${name}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`); }
}

const ru = { id: 'explain', label: BUILTIN_SKILLS.ru.explain.label, prompt: BUILTIN_SKILLS.ru.explain.prompt, builtin: true };
check('русский сток остаётся русским', localizeBuiltinSkill(ru, 'ru').label, 'Объяснить');
check('русский сток на английском экране', localizeBuiltinSkill(ru, 'en').label, 'Explain');
check('английский промпт на английском экране', localizeBuiltinSkill(ru, 'en').prompt, BUILTIN_SKILLS.en.explain.prompt);

const custom = { ...ru, prompt: 'Explain this like I am five' };
check('свой промпт не подменяем', localizeBuiltinSkill(custom, 'en').prompt, 'Explain this like I am five');
check('сток узнаётся в обоих языках', isStockBuiltinPrompt('summary', BUILTIN_SKILLS.en.summary.label, BUILTIN_SKILLS.en.summary.prompt), true);

const user = { id: 'mine', label: 'Объяснить', prompt: 'x', builtin: false };
check('пользовательский скилл не трогаем', localizeBuiltinSkill(user, 'en').label, 'Объяснить');

console.log(`Итого: ${passed} прошло, ${failed} не прошло`);
if (failed) process.exitCode = 1;
