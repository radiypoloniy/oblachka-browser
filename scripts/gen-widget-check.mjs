// Санитайзер и обвязка своих виджетов стола (shared/genWidget.ts) — без electron.
//
// Зачем: HTML модели нельзя пускать в хром. Эта граница проверяется запуском, не чтением.
//   npm test -- gen-widget
import {
  sanitizeGenHtml, extractGenHtml, wrapGenSrcdoc, pickGenFacts, clampGenStorage,
  parseGenMeta, wantsGenPhoto, wantsGenTimer, parseGenDurationMs, parseGenClockWrite,
  genClockLeftMs, formatGenClock, extractGenLexicon, phraseClearlyAsksBuiltin, GEN_FACT_IDS, GEN_STORAGE_MAX_CHARS,
  pickGenMode, timerIsWholeWidget, genHtmlIsBlank, isGenLexiconRunner,
} from '../shared/genWidget.ts';

let passed = 0;
let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { failed++; console.log(`  ✗ ${name}\n      получили ${JSON.stringify(got)}\n      ждали    ${JSON.stringify(want)}`); }
  else { passed++; console.log(`  ✓ ${name}`); }
};
const checkTrue = (name, got) => check(name, !!got, true);

console.log('\n── факты ──');
check('пустой список', pickGenFacts(null), []);
check('мусор выкинут', pickGenFacts(['openTabs', 'btc', 'openTabs']), ['openTabs']);
check('три известных', GEN_FACT_IDS.includes('sessionBlocks'), true);

console.log('\n── санитайзер ──');
{
  const dirty = '<iframe src="https://evil"></iframe><p onclick="go()">ok</p>'
    + '<script src="https://evil/x.js"></script><img src="https://x/a.png">'
    + '<a href="javascript:alert(1)">x</a>';
  const clean = sanitizeGenHtml(dirty);
  checkTrue('iframe вырезан', !clean.includes('iframe'));
  checkTrue('onclick ЖИВ в песочнице', /onclick/i.test(clean));
  checkTrue('script src вырезан', !/script src/i.test(clean) && !clean.includes('evil/x.js'));
  checkTrue('http img вырезан', !clean.includes('https://x/a.png'));
  checkTrue('javascript: href вырезан', !/javascript:/i.test(clean));
  checkTrue('текст остался', clean.includes('ok'));
}

{
  const ok = sanitizeGenHtml('<style>.a{color:var(--accent)}</style><div>hi</div><script>api.facts</script>');
  checkTrue('style с токеном жив', ok.includes('var(--accent)'));
  checkTrue('inline script жив', ok.includes('api.facts'));
}

{
  const css = sanitizeGenHtml('<style>@import url("https://evil");body{background:url(https://x)}</style>');
  checkTrue('@import вырезан', !css.includes('@import'));
  checkTrue('url http вырезан', !css.includes('https://x'));
}

console.log('\n── разбор ответа ──');
{
  const raw = 'Sure.\nHTML:\n<div>hello widget</div>';
  const html = extractGenHtml(raw);
  checkTrue('берёт после метки', !!html && html.includes('hello widget'));
  check('без разметки — пусто', extractGenHtml('просто текст без тегов'), null);
  const fenced = 'HTML:\n```html\n<div data-caption>Слово</div>\n<div data-display>Sun</div>\n```\n';
  const fromFence = extractGenHtml(fenced) ?? '';
  checkTrue('забор снят', fromFence.includes('Sun') && !fromFence.includes('```'));
  const tail = 'HTML:\n<div data-caption>Слово</div>\n<div data-display>Sun Солнце</div>\nСлучайное слово\n```\n';
  const fromTail = extractGenHtml(tail) ?? '';
  checkTrue('хвост-забор срезан', fromTail.includes('Sun') && !fromTail.includes('```') && !fromTail.includes('Случайное слово'));
  const dict = 'HTML:\n<div data-caption>Слово</div>\n<div data-display></div>\nsun — солнце\ncat — кот\ndog — собака\ntree — дерево\n';
  const fromDict = extractGenHtml(dict) ?? '';
  checkTrue('словарь свёрнут в скрипт', fromDict.includes('солнце') && fromDict.includes('<script>') && !fromDict.includes('tree —'));
  check('хост видит пары', extractGenLexicon(fromDict).length >= 4, true);
}

console.log('\n── обвязка ──');
{
  const doc = wrapGenSrcdoc('<div>x</div>', { '--accent': '#2C4BD8' }, 'abc');
  checkTrue('CSP есть', doc.includes('Content-Security-Policy'));
  checkTrue('connect-src none', doc.includes("connect-src 'none'"));
  checkTrue('токен прокинут', doc.includes('--accent:#2C4BD8'));
  checkTrue('мост api', doc.includes('window.api'));
  checkTrue('тик таймера', doc.includes('oblako-tick'));
  checkTrue('хост без своего фона', doc.includes('background:transparent!important'));
  checkTrue('кнопка акцентом', doc.includes('background:var(--accent)'));
  checkTrue('font-src data', doc.includes("font-src data:"));
  checkTrue('ход на хосте', doc.includes('oblako-gen-timer-start'));
  checkTrue('подпись как у часов', doc.includes('data-caption'));
}

console.log('\n── метки ──');
{
  const m = parseGenMeta('WIDGET: weather\nFACTS: -\nSIZE: small\nASSET: none\nTITLE: Погода');
  check('готовая погода', m.widget, 'weather');
  const g = parseGenMeta('WIDGET: gen\nFACTS: openTabs, sessionBlocks\nSIZE: medium\nASSET: photo\nTITLE: Фоторамка');
  check('свой', g.widget, 'gen');
  check('факты', g.facts, ['openTabs', 'sessionBlocks']);
  check('размер', g.size, { w: 4, h: 2 });
  check('фото', g.assetPhoto, true);
  const n = parseGenMeta('WIDGET: bitcoin\nFACTS:\nSIZE: huge');
  check('сеть — none', n.widget, 'none');
  check('размер по умолчанию', n.size, { w: 2, h: 2 });
}

console.log('\n── фото и готовые ──');
check('фраза фоторамка', wantsGenPhoto('фоторамка на стол', '', false), true);
check('img в html', wantsGenPhoto('виджет', '<img src="data:image/png;base64,xx">', false), true);
check('просто таймер', wantsGenPhoto('помодоро', '<div>25:00</div>', false), false);
check('фраза помодоро — таймер хоста', wantsGenTimer('помодоро 25 минут', ''), true);
check('часы с timer в html — не хост', wantsGenTimer('часы', 'api.timer.start(25)'), false);
check('фоторамка — не таймер', wantsGenTimer('фоторамка', '<img>'), false);
check('длительность из фразы', parseGenDurationMs('помодоро 45 минут'), 45 * 60_000);
check('помодоро без числа', parseGenDurationMs('помодоро'), 25 * 60_000);
check('только погода', phraseClearlyAsksBuiltin('погода', 'weather'), true);
check('виджет часы — готовые', phraseClearlyAsksBuiltin('виджет часы', 'clock'), true);
check('погода и кот — свой', phraseClearlyAsksBuiltin('погода с котом на фото', 'weather'), false);

console.log('\n── ход таймера ──');
{
  const now = 1_700_000_000_000;
  const fromEnd = parseGenClockWrite(JSON.stringify({ endAt: now + 90_000 }), now);
  check('endAt остаётся', fromEnd && fromEnd !== 'stop' && fromEnd.endAt, now + 90_000);
  check('остаток от стены', fromEnd && fromEnd !== 'stop' ? genClockLeftMs(fromEnd, now + 30_000) : -1, 60_000);
  const started = parseGenClockWrite(JSON.stringify({ running: true, remaining: 1500 }), now);
  check('старт из remaining', started && started !== 'stop' && started.endAt, now + 1_500_000);
  check('стоп', parseGenClockWrite('{"running":false}', now), 'stop');
  check('тихий remaining без start не часы', parseGenClockWrite('{"remaining":12}', now), null);
  check('формат', formatGenClock(90_000), '1:30');
}

console.log('\n── storage ──');
check('длинное режется', clampGenStorage('a'.repeat(GEN_STORAGE_MAX_CHARS + 50)).length, GEN_STORAGE_MAX_CHARS);

console.log('\n── ответ полным документом (живой случай 22.08) ──');
{
  // 4B регулярно отдаёт <html><head>…<body>. Раньше body вырезался ВМЕСТЕ С СОДЕРЖИМЫМ,
  // оставался один <style>, длину порога он проходил — человек получал «собрал» и пустой квадрат.
  const full = 'HTML:\n<html><head><title>W</title><style>.a{color:var(--accent)}</style></head>'
    + '<body><div data-caption>Кубик</div><div data-display>7</div>'
    + '<button onclick="roll()">Кинуть</button></body></html>';
  const out = extractGenHtml(full) ?? '';
  checkTrue('содержимое body выжило', out.includes('Кинуть') && out.includes('>7<'));
  checkTrue('обёртки документа нет', !/<\/?(?:html|body|head)\b/i.test(out));
  checkTrue('<title> не стал текстом плитки', !out.includes('W<') && !/>W/.test(out));
  // ⚠️ Атрибут БЕЗ значения: промпт просит именно <div data-display>, и на нём держится
  // оформление героя в GEN_HOST_CSS. Прежний разбор требовал `=` и молча его выбрасывал.
  checkTrue('data-display без значения жив', out.includes('data-display'));
  checkTrue('data-caption без значения жив', out.includes('data-caption'));
}

console.log('\n── пустой результат — это провал, а не виджет ──');
check('один <style> не виджет', extractGenHtml('HTML:\n<style>.a{color:red}</style>'), null);
checkTrue('пустой распознаётся', genHtmlIsBlank('<style>.a{color:red}</style>'));
checkTrue('скрипт рисует себя сам — не пустой', !genHtmlIsBlank('<script>document.body.textContent="hi"</script>'));
checkTrue('видимый элемент — не пустой', !genHtmlIsBlank('<div data-display>7</div>'));

console.log('\n── кто рисует плитку ──');
{
  // ⚠️ Живой случай: рабочий виджет с массивом пар внутри <script> хост подменял карточкой
  // «слово → значение», то есть выбрасывал ровно то, что человек просил.
  const dice = extractGenHtml('HTML:\n<div data-display>0</div><script>var P=[["red","красный"],'
    + '["blue","синий"],["green","зелёный"],["black","чёрный"]];</script>') ?? '';
  check('массив пар в рабочем скрипте не словарь', pickGenMode('кубик с цветами', dice, false), 'html');
  checkTrue('чужой массив не помечен нашим бегунком', !isGenLexiconRunner(dice));

  // А список, напечатанный ТЕКСТОМ вместо виджета, по-прежнему сворачивается в бегунок.
  const printed = extractGenHtml('HTML:\n<div data-caption>Слово</div>\nSun - Солнце\nMoon - Луна\n'
    + 'Rain - Дождь\nSnow - Снег\n') ?? '';
  checkTrue('текстовый список свёрнут в наш бегунок', isGenLexiconRunner(printed));
  check('и рисует его хост', pickGenMode('английские слова', printed, false), 'lexicon');
}

console.log('\n── таймер целиком vs таймер в составе ──');
checkTrue('«помодоро на 25 минут» — таймер целиком', timerIsWholeWidget('помодоро на 25 минут'));
checkTrue('«таймер» — таймер целиком', timerIsWholeWidget('таймер'));
checkTrue('«трекер привычек с таймером» — НЕ голый таймер', !timerIsWholeWidget('трекер привычек с таймером'));
check('и режим у него обычный', pickGenMode('трекер привычек с таймером', '<div>x</div>', false), 'html');

console.log('\n── фоторамка не крадёт рабочий виджет ──');
checkTrue('<img> в статичном ответе — рамка', wantsGenPhoto('карточка дня', '<img src="data:image/png;base64,x">', false));
checkTrue('<img> рядом со скриптом — украшение',
  !wantsGenPhoto('счётчик привычек', '<img src="data:image/png;base64,x"><script>go()</script>', false));
checkTrue('класс .photo-card в вёрстке — не заказ рамки',
  !wantsGenPhoto('счётчик', '<div class="photo-card"></div><script>x()</script>', false));
checkTrue('слово «фоторамка» во фразе — рамка', wantsGenPhoto('фоторамка с котом', '<div></div>', false));

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
