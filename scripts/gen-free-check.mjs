// Ярус 2 генератора виджетов: снятие фенса и годность ответа к показу.
//
// ⚠️ Проверяется машиной потому, что обе ошибки ТИХИЕ. Неснятый markdown-фенс даёт «успешно
// собранный» виджет с тремя апострофами вместо содержимого; пропущенный пустой ответ даёт пустую
// плитку, неотличимую от рабочей, пока на неё не посмотришь. Ровно на этом уже обожглись в
// августе, когда 4B выдавала 250 пустых <div>.
import {
  stripCodeFence, freeWidgetUsable, freeTierAllowed, freeAnswerTruncated, freeStopWasLimit,
} from '../shared/genFree.ts';

let passed = 0;
let failed = 0;
const check = (what, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { passed++; console.log(`  ok   ${what}`); }
  else { failed++; console.log(` FAIL  ${what}\n         получили ${JSON.stringify(got)}, ждали ${JSON.stringify(want)}`); }
};

console.log('\n— обёртка markdown —');
check('фенс с языком снимается', stripCodeFence('```html\n<div>привет</div>\n```'), '<div>привет</div>');
check('фенс без языка снимается', stripCodeFence('```\n<p>a</p>\n```'), '<p>a</p>');
check('пробелы вокруг не мешают', stripCodeFence('  ```html\n<b>x</b>\n```  '), '<b>x</b>');
check('без фенса ответ не трогаем', stripCodeFence('<div>чисто</div>'), '<div>чисто</div>');
// ⚠️ Фенс В СЕРЕДИНЕ — часть содержимого: модель показывает пример кода ВНУТРИ виджета.
// Снять его значило бы съесть половину разметки.
check('фенс в середине не трогаем',
  stripCodeFence('<p>вот код:</p>\n```js\nlet a = 1;\n```\n<p>конец</p>'),
  '<p>вот код:</p>\n```js\nlet a = 1;\n```\n<p>конец</p>');
check('незакрытый фенс не трогаем', stripCodeFence('```html\n<div>x</div>'), '```html\n<div>x</div>');

console.log('\n— годится ли к показу —');
const long = `<div class="w">${'слово '.repeat(20)}</div>`;
check('нормальная разметка', freeWidgetUsable(long), true);
check('пусто', freeWidgetUsable('   '), false);
// ⚠️ «Не могу» в ответ на просьбу — частый исход, и это не разметка.
check('отказ словами', freeWidgetUsable('Извините, я не могу сделать такой виджет для вас сегодня.'), false);
check('короткий огрызок', freeWidgetUsable('<div></div>'), false);
// ⚠️ Каркас без содержимого — ровно та пустая плитка, ради которой порог и заведён.
check('каркас без содержимого', freeWidgetUsable(`<div>${'<span></span>'.repeat(30)}</div>`), false);
// ...но скрипт или svg внутри — это содержимое, даже если текста между тегами нет.
check('svg без текста годится', freeWidgetUsable(`<div><svg viewBox="0 0 10 10">${' '.repeat(40)}<circle r="4"/></svg></div>`), true);
check('скрипт без текста годится', freeWidgetUsable(`<div id="w"></div><script>${'var a=1;'.repeat(8)}</script>`), true);
check('слишком длинный ответ', freeWidgetUsable(`<div>${'a'.repeat(13000)}</div>`), false);

console.log('\n— ответ оборвался —');
// ⚠️ Обрыв на лимите токенов проходит freeWidgetUsable: разметка есть, содержимое есть — и на
// столе встаёт полувиджет. Отличить его можно только этими двумя признаками.
check('лимит: Anthropic', freeStopWasLimit('max_tokens'), true);
check('лимит: OpenAI-совместимые', freeStopWasLimit('length'), true);
check('лимит: Gemini', freeStopWasLimit('MAX_TOKENS'), true);
check('естественный конец: локальная', freeStopWasLimit('eogToken'), false);
check('естественный конец: OpenAI', freeStopWasLimit('stop'), false);
check('естественный конец: Anthropic', freeStopWasLimit('end_turn'), false);
check('незакрытый скрипт — обрыв', freeAnswerTruncated('<div id="w"></div><script>var a = 1; setInter'), true);
check('закрытый скрипт — не обрыв', freeAnswerTruncated('<div id="w"></div><script>var a=1;</script>'), false);
check('два скрипта, второй не закрыт', freeAnswerTruncated('<script>a</script><div>x</div><script>b'), true);
check('обрыв на открывающем теге', freeAnswerTruncated('<div class="wrap"><p data-caption>Итог</p><div style="colo'), true);
check('целая разметка — не обрыв', freeAnswerTruncated('<div><p data-caption>Итог</p></div>'), false);
// ⚠️ Хвостовой перевод строки — не обрыв: ответ модели почти всегда им заканчивается.
check('перевод строки в конце не обрыв', freeAnswerTruncated('<div>x</div>\n  '), false);

console.log('\n— кому даём свободу —');
// ⚠️ Признак — облако, а не «сильная модель»: силу по имени не узнать, адрес известен точно.
check('облаку — да', freeTierAllowed(false), true);
check('локальной — нет', freeTierAllowed(true), false);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
