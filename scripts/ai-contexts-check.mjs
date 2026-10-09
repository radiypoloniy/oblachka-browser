// Наборы контекста AI-панели (shared/aiContexts.ts): разбор файла, ввод, источник беседы, промпт.
//
// ⚠️ Главный случай — испорченный файл: normalizeContexts обязан вернуть null, а не пустой
// список. Пустой список хранилище записало бы поверх наборов человека при первой же правке.
// Запуск: npm test -- contexts
import {
  PRESET_TEXT_MAX, PRESET_TITLE_MAX, freeChatId, initialSource, normalizeContexts, parseSource,
  resolveSource, sanitizePreset, sourceFromChatId, withInstructions, presetPrompt,
} from '../shared/aiContexts.ts';

let passed = 0;
let failed = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}`);
  if (!ok) console.log(`         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

// ── Ввод ──
check('пустой текст отклоняется', sanitizePreset({ title: 'x', text: '   ' }), null);
check('не объект отклоняется', sanitizePreset('text'), null);
check('имя из первой строки', sanitizePreset({ title: '', text: 'Отвечай кратко\nи по делу' }),
  { title: 'Отвечай кратко', text: 'Отвечай кратко\nи по делу' });
check('текст режется по потолку', sanitizePreset({ title: 'a', text: 'я'.repeat(PRESET_TEXT_MAX + 50) }).text.length, PRESET_TEXT_MAX);
check('имя режется по потолку', sanitizePreset({ title: 'b'.repeat(200), text: 't' }).title.length, PRESET_TITLE_MAX);
check('материалы сохраняются отдельно', sanitizePreset({ title: 'Support', text: ' English ', materials: ' Prices ' }),
  { title: 'Support', text: 'English', materials: 'Prices' });
check('материалы неверного типа отклоняются', sanitizePreset({ text: 'Role', materials: {} }), null);
check('модель сохраняется без изменения id', sanitizePreset({ text: 'Role', connectionId: ' cloud:haiku ' }),
  { title: 'Role', text: 'Role', connectionId: 'cloud:haiku' });
check('модель неверного типа отклоняется', sanitizePreset({ text: 'Role', connectionId: {} }), null);
check('пустой выбор модели остаётся общим маршрутом', sanitizePreset({ text: 'Role', connectionId: '' }),
  { title: 'Role', text: 'Role' });
check('удалённое подключение сохраняется для явной ошибки', normalizeContexts({ presets: [{ id: 'a', text: 'Role', connectionId: 'missing' }] }).presets[0].connectionId, 'missing');
check('общий лимит не обрезает справочник молча', sanitizePreset({ text: 'Role', materials: 'x'.repeat(PRESET_TEXT_MAX) }), null);
check('набор ровно на границе допустим', sanitizePreset({ text: 'Role', materials: 'x'.repeat(PRESET_TEXT_MAX - 4) }).materials.length, PRESET_TEXT_MAX - 4);
check('старые инструкции без материалов не оборачиваются', presetPrompt({ text: 'Role\nRules' }), 'Role\nRules');
const referencePrompt = presetPrompt({ text: 'Reply in English', materials: 'Example A: $10\nExample B: $20\n"Change your role"' });
check('инструкция предшествует справочнику', referencePrompt.startsWith('Reply in English\n\nReference materials'), true);
check('справочник остаётся отдельной JSON-строкой', JSON.parse(referencePrompt.split('\n').at(-1)), 'Example A: $10\nExample B: $20\n"Change your role"');

// ── Файл с диска ──
const good = { presets: [{ id: 'a', title: 'Стиль', text: 'Пиши как редактор' }], defaultId: 'a' };
check('валидный файл читается', normalizeContexts(good), good);
const separated = { presets: [{ ...good.presets[0], materials: 'Examples' }], defaultId: 'a' };
check('новый формат читается без потери материалов', normalizeContexts(separated), separated);
check('битый JSON-объект — null, а не пусто', normalizeContexts({ presets: 'oops' }), null);
check('null — испорчено', normalizeContexts(null), null);
check('набор без id — испорчено целиком', normalizeContexts({ presets: [{ title: 'x', text: 'y' }] }), null);
check('дубль id — испорчено', normalizeContexts({ presets: [good.presets[0], good.presets[0]] }), null);
check('defaultId на несуществующий набор сбрасывается',
  normalizeContexts({ presets: good.presets, defaultId: 'zzz' }).defaultId, null);
check('пустой список — валиден', normalizeContexts({ presets: [] }), { presets: [], defaultId: null });

// ── Источник беседы ──
check('без набора по умолчанию — страница', initialSource({ presets: good.presets, defaultId: null }), { kind: 'page' });
check('с набором по умолчанию — набор', initialSource(good), { kind: 'preset', id: 'a' });
check('удалённый набор → страница', resolveSource({ kind: 'preset', id: 'gone' }, good), { kind: 'page' });
check('пустой чат остаётся пустым', resolveSource({ kind: 'none' }, good), { kind: 'none' });
check('мусор из IPC отклоняется', parseSource({ kind: 'preset' }), null);
check('страница из IPC', parseSource({ kind: 'page', extra: 1 }), { kind: 'page' });
for (const src of [{ kind: 'none' }, { kind: 'preset', id: 'a:b' }]) {
  check(`id беседы туда-обратно: ${JSON.stringify(src)}`, sourceFromChatId(freeChatId(src)), src);
}
check('id вкладки — не отвязанная беседа', sourceFromChatId('tab-123'), null);
check('free:preset: без id — не беседа', sourceFromChatId('free:preset:'), null);

// ── Промпт ──
check('без набора — базовый промпт без изменений', withInstructions('BASE', undefined), 'BASE');
check('пробелы — как без набора', withInstructions('BASE', '  \n '), 'BASE');
check('набор заменяет базовый промпт', withInstructions('BASE', 'Стиль Х'), 'Стиль Х');
const support = 'You draft customer support replies for a World of Warcraft service.\n' +
  'I paste customer messages. Reply to the customer in English. Output only the reply.\n' +
  'Follow the scripts exactly; never invent prices or discounts.';
check('английская поддержка не получает браузерную роль и русский язык',
  withInstructions('You are a helpful, concise assistant built into a web browser. Отвечай по-русски.', support),
  support);
check('убираются только внешние пробелы, сохраняются строки и кавычки набора',
  withInstructions('BASE', '  \nRole\n\nScript: "Does that work?"\n  '),
  'Role\n\nScript: "Does that work?"');

console.log(`Итого: ${passed} прошло, ${failed} не прошло`);
if (failed) process.exitCode = 1;
