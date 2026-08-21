// Санитайзер и обвязка своих виджетов стола (shared/genWidget.ts) — без electron.
//
// Зачем: HTML модели нельзя пускать в хром. Эта граница проверяется запуском, не чтением.
//   npm test -- gen-widget
import {
  sanitizeGenHtml, extractGenHtml, wrapGenSrcdoc, pickGenFacts, clampGenStorage,
  parseGenMeta, GEN_FACT_IDS, GEN_STORAGE_MAX_CHARS,
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
  checkTrue('нет allow-same-origin в документе', !doc.includes('allow-same-origin'));
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

console.log('\n── storage ──');
check('длинное режется', clampGenStorage('a'.repeat(GEN_STORAGE_MAX_CHARS + 50)).length, GEN_STORAGE_MAX_CHARS);

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло\n`);
process.exit(failed === 0 ? 0 : 1);
