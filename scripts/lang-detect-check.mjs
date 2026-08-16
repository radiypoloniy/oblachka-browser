// Выбор языка текста (shared/langDetect.ts) — на НАСТОЯЩИХ ответах franc, а не на выдуманных.
//
// ⚠️ Почему на настоящих. Все три эвристики родились из живых жалоб, и каждая — костыль поверх
// ошибки franc. Проверять их на придуманных «кандидатах» бессмысленно: сломается ровно то, что
// franc отвечает на самом деле. Поэтому здесь грузится сам franc-min и вызывается ровно так же,
// как в TranslationService.
//
// ⚠️ Каждая фраза ниже — из жалобы или контрольная к ней. Правишь эвристику — прогоняй ВЕСЬ набор:
// они конфликтуют между собой (кириллическое правило легко ломает французское и наоборот).
//
// Запуск: npm test -- lang-detect
import { francAll } from 'franc-min';
import { pickLanguage, FRANC_TO_CODE, hasSubstantialCyrillic } from '../shared/langDetect.ts';

let passed = 0;
let failed = 0;

function check(what, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passed++; else failed++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${what}`);
  if (!ok) console.log(`         получили ${JSON.stringify(actual)}, ждали ${JSON.stringify(expected)}`);
}

// Ровно тот же вызов, что в TranslationService.detectLang.
const detect = (text) => pickLanguage(francAll(text, { only: Object.keys(FRANC_TO_CODE), minLength: 3 }), text);

console.log('\n— жалоба: русский текст с латинскими брендами —');
{
  // ПКМ → «Перевести» на этой фразе переводил её НА РУССКИЙ, хотя она и так русская: десять
  // брендов сбивают частотную статистику franc, и он отдаёт латинописьменный язык.
  const ADOBE = 'Adobe запустила единый плагин для ChatGPT, который включает более 70 инструментов '
    + 'из нескольких продуктов, в том числе Adobe Express, Photoshop, Firefly, Premiere, Acrobat, '
    + 'Lightroom, Illustrator, InDesign и Adobe Stock';
  const raw = francAll(ADOBE, { only: Object.keys(FRANC_TO_CODE), minLength: 3 })[0][0];
  check('franc по-прежнему ошибается на ней (иначе проверка потеряла смысл)', raw !== 'rus', true);
  check('но итог — русский', detect(ADOBE).code, 'ru');
  check('и сработало именно правило письменности', detect(ADOBE).overrode, 'cyrillic');
  // ⚠️ Порог НЕ «больше половины»: латиницы тут БОЛЬШЕ, чем кириллицы, и правило «преимущественно
  // кириллический» эту фразу не спасало.
  check('латиницы в ней больше, чем кириллицы', (ADOBE.match(/[a-zA-Z]/g) ?? []).length > (ADOBE.match(/[а-яёА-ЯЁ]/g) ?? []).length, true);
}

console.log('\n— контроль: правило не должно хватать лишнего —');
{
  const EN_WITH_QUOTE = 'The sign said "Осторожно" and everyone in the group immediately understood '
    + 'that they had to stop walking along the road.';
  check('английский с русской цитатой остаётся английским', detect(EN_WITH_QUOTE).code, 'en');
  check('и доля кириллицы в нём ниже порога', hasSubstantialCyrillic(EN_WITH_QUOTE), false);
}
{
  check('чистый английский', detect('The quick brown fox jumps over the lazy dog and then runs away into the deep forest.').code, 'en');
  check('чистый русский', detect('Вчера вечером мы обсуждали новые правила и решили перенести встречу на следующую неделю.').code, 'ru');
}

console.log('\n— французский: своя старая починка не должна пострадать —');
{
  // Живой баг: страница на французском, franc отдавал 'en' (сбит англицизмами), и Qwen переводил
  // только английские вкрапления, оставляя французский текст как есть.
  const FR = 'Le gouvernement a annoncé des mesures pour les entreprises qui sont dans une situation '
    + 'difficile avec leurs salariés et leurs partenaires.';
  check('французский определяется французским', detect(FR).code, 'fr');
}
{
  // Тонкое место: французские служебные слова подставляются, только если franc вообще рассматривал
  // французский. Иначе мы бы «назначали» язык, которого нет среди кандидатов.
  const pick = pickLanguage([['eng', 1]], 'le la des dans avec pour');
  check('без французского среди кандидатов подмены не происходит', pick.code, 'en');
  const pick2 = pickLanguage([['eng', 1], ['fra', 0.9]], 'le la des dans avec pour');
  check('а с ним — происходит', [pick2.code, pick2.overrode], ['fr', 'french-function-word']);
}

console.log('\n— английские сокращения на короткой строке —');
{
  // "honestly that's a game changer, let's ship it" franc отдавал как 'fr'.
  const pick = pickLanguage([['fra', 1], ['eng', 0.9]], "honestly that's a game changer, let's ship it");
  check('сокращение перебивает ошибочный французский', [pick.code, pick.overrode], ['en', 'english-contraction']);
}
{
  // ⚠️ Правило ограничено короткими строками сознательно — на длинных оно не подтверждено.
  const long = "honestly that's a game changer and we should ship it right now because the whole team "
    + 'has been waiting for this release for a very long time already';
  const pick = pickLanguage([['fra', 1], ['eng', 0.9]], long);
  check('на длинной строке правило не применяется', pick.overrode, null);
}
{
  // Французские l'/c'/qu' — апостроф ПЕРЕД словом, под правило попадать не должны.
  const pick = pickLanguage([['fra', 1], ['eng', 0.9]], "l'homme c'est qu'il a dit");
  check('французские апострофы не считаются англ. сокращением', pick.overrode, null);
}

console.log('\n— порядок правил —');
{
  // Кириллица проверяется ПЕРВОЙ: русский текст с англ. сокращением в цитате остаётся русским.
  const pick = pickLanguage([['eng', 1]], 'Он сказал буквально «that\'s a game changer» и все засмеялись над этим');
  check('кириллица сильнее правила сокращений', pick.code, 'ru');
}

console.log('\n— пустое и мусор —');
{
  check('пустая строка — запасной язык', pickLanguage([], '').code, 'en');
  check('нет букв вовсе — кириллическое правило молчит', hasSubstantialCyrillic('12345 !@#'), false);
  check('неизвестный код franc уходит в запасной', pickLanguage([['xxx', 1]], 'qwerty asdf').code, 'en');
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
