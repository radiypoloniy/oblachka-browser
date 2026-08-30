// Три стиля страницы: ОДНА разметка — три разных мира.
//
// ⚠️ КОЛОНОК В ТЕКСТЕ НЕТ НИ В ОДНОМ СТИЛЕ, и возвращать их нельзя. Здесь был `columns: 2` на
// `.body > p`, то есть на КАЖДОМ абзаце по отдельности: абзац делился надвое внутри себя, и
// читать приходилось «левая половина — назад наверх — правая». Живая оценка: «неочевидно, как
// читать текст». Правильное применение (columns на контейнере) не спасает: чтобы дочитать
// левую колонку, надо долистать страницу до низа и вернуться. Многоколоночность — приём ПЕЧАТИ,
// где полоса конечна и видна целиком. Журнальность даётся другими средствами, их тут хватает.
//
// ⚠️ Раскладка держится на <section> вокруг каждого раздела, и оборачиваем их МЫ
// (shared/docMarkup.ts::groupSections). Модель отдаёт плоскую последовательность, а сетка
// раскладывает плоские элементы по строкам сама — заголовок второго раздела попадал в строку к
// абзацу первого, липкие заголовки наезжали друг на друга.
//
// ⚠️ Движение — ТОЛЬКО на CSS (`animation-timeline`), ни строчки скрипта. Предпросмотр идёт в
// iframe с sandbox="", где скрипты запрещены: любое JS-решение врало бы про сохранённый файл.
// Где таймлайны не поддерживаются — просто нет анимации, страница цела.
//
// ⚠️ Стили ЧИСЛАМИ, а не токенами: страница уезжает человеку, у которого нашего браузера нет.

export type PageStyle = 'izdanie' | 'panel' | 'polosa';

export const PAGE_STYLES: { id: PageStyle; label: string; hint: string }[] = [
  { id: 'izdanie', label: 'Издание', hint: 'Бумага: заголовок на поле едет за текстом, буквица, зерно' },
  { id: 'panel',   label: 'Панель',  hint: 'Тёмная приборная доска: абзацы карточками, метки разделов' },
  { id: 'polosa',  label: 'Полоса',  hint: 'Длинное чтение: висячие номера, врезка во всю ширину' },
];

const FONT_FRAUNCES = '@import url("https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,900&display=swap");';

// Зерно — тот же рецепт, что у островов интерфейса (grain в styles/system.ts).
const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.65' numOctaves='2'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='.5'/%3E%3C/svg%3E\")";

// Общее: сброс, микротипографика, полоса прогресса чтения, проявление разделов.
const BASE = [
  '*{box-sizing:border-box}html,body{margin:0}',
  'table{width:100%;border-collapse:collapse}em.src{font-style:normal}',
  'img{max-width:100%}',
  // Микротипографика — то, что и даёт ощущение «дорого». balance не даёт заголовку висеть
  // одним словом на второй строке, pretty — тому же в конце абзаца.
  'h1,h2{text-wrap:balance}p{text-wrap:pretty;hyphens:auto}',
  'blockquote{hanging-punctuation:first}',
  // Полоса прогресса чтения. Никакого скрипта: прокрутка сама и есть таймлайн.
  '@supports (animation-timeline:scroll()){',
  '  body::before{content:"";position:fixed;top:0;left:0;height:3px;width:100%;z-index:99;',
  '    transform-origin:0 50%;transform:scaleX(0);',
  '    animation:oblako-progress linear;animation-timeline:scroll(root block)}',
  '  @keyframes oblako-progress{to{transform:scaleX(1)}}',
  '}',
  // Проявление по мере прокрутки: движение мягкое и одноразовое на элемент.
  '@supports (animation-timeline:view()){',
  '  section,.body>p,.body>blockquote{animation:oblako-rise linear both;',
  '    animation-timeline:view();animation-range:entry 0% entry 40%}',
  '  @keyframes oblako-rise{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}',
  '}',
  '@media (prefers-reduced-motion:reduce){body::before{animation:none;transform:scaleX(0)}',
  '  section,.body>p,.body>blockquote{animation:none!important;opacity:1!important;transform:none!important}}',
].join('');

// ── Издание: бумага, засечный набор, заголовок на поле ──────────────────────
const IZDANIE = FONT_FRAUNCES + BASE + [
  'body{background:#F5F1E8;color:#33302A;font:18px/1.68 "Golos Text",system-ui,sans-serif;',
  `  background-image:${GRAIN}}`,
  'body::before{background:#B4451F}',
  '.page{padding:clamp(22px,4vw,60px) clamp(16px,6vw,80px) 80px;counter-reset:sec}',
  '.meta{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px;letter-spacing:.16em;',
  '  text-transform:uppercase;color:#8A8375;margin:0 0 16px}',
  '.title{font-family:Fraunces,Georgia,"Times New Roman",serif;font-weight:900;',
  '  font-size:clamp(34px,7.2vw,88px);line-height:.94;letter-spacing:-.032em;margin:0 0 22px;',
  '  color:#17150F;max-width:17ch}',
  '.lede{font-family:Fraunces,Georgia,serif;font-weight:400;font-size:clamp(19px,2.3vw,29px);',
  '  line-height:1.34;color:#5A5347;max-width:36ch;margin:0 0 40px}',
  '.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));',
  '  border-top:4px solid #17150F;border-bottom:4px solid #17150F;margin:0 0 52px}',
  '.stats div{padding:20px 20px 20px 0}',
  '.stats b{display:block;font-family:Fraunces,Georgia,serif;font-weight:900;',
  '  font-variant-numeric:tabular-nums;font-size:clamp(28px,3.6vw,46px);line-height:1;',
  '  letter-spacing:-.03em;color:#B4451F}',
  '.stats span{display:block;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px;',
  '  letter-spacing:.12em;text-transform:uppercase;color:#7A7263;margin-top:9px}',
  // ⚠️ Сетка — ВНУТРИ раздела, а не на всём теле. Только так заголовок и его абзацы стоят в
  // одной строке, а липкость ограничена своим разделом: наехать на соседний заголовок нечему.
  'section{margin-bottom:8px}',
  '@media(min-width:1000px){',
  '  section{display:grid;grid-template-columns:minmax(200px,270px) minmax(0,68ch);column-gap:64px}',
  // ⚠️ min-width:0 и перенос по слогам ОБЯЗАТЕЛЬНЫ. Элемент сетки по умолчанию не уже своего
  // содержимого, и одно длинное слово («Диверсификация» в 32 px — это ~250 px) распирало
  // колонку и наезжало на текст справа. Живой случай, виден на скриншоте 30.08.
  '  section>h2{grid-column:1;grid-row:1/span 99;position:sticky;top:26px;align-self:start;margin-top:0;',
  '    min-width:0;overflow-wrap:break-word;hyphens:auto;font-size:clamp(21px,2vw,27px)}',
  '  section>*:not(h2){grid-column:2}',
  '}',
  'h2{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:clamp(23px,2.5vw,32px);',
  '  letter-spacing:-.02em;line-height:1.1;margin:46px 0 14px;color:#17150F}',
  'h2::before{counter-increment:sec;content:counter(sec,decimal-leading-zero);display:block;',
  '  font-size:13px;font-family:"JetBrains Mono",ui-monospace,monospace;letter-spacing:.14em;',
  '  color:#B4451F;margin-bottom:10px}',
  'h3{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:20px;margin:26px 0 8px;color:#17150F}',
  'p{margin:0 0 20px;max-width:68ch}',
  // Буквица — один раз на статью, у первого абзаца первого раздела: один раз значит событие.
  'section:first-of-type>h2+p::first-letter{font-family:Fraunces,Georgia,serif;font-weight:900;',
  '  font-size:4.6em;float:left;line-height:.78;padding:.06em .09em 0 0;color:#B4451F}',
  // Капитель первой строки после заголовка — вход в раздел виден боковым зрением.
  'section>h2+p::first-line{font-variant:small-caps;letter-spacing:.02em;color:#17150F}',
  'blockquote{margin:44px 0;padding:30px 0;border-top:4px solid #B4451F;border-bottom:4px solid #B4451F;',
  '  font-family:Fraunces,Georgia,serif;font-weight:600;font-size:clamp(21px,2.9vw,33px);',
  '  line-height:1.2;color:#B4451F;max-width:24ch}',
  'ul,ol{margin:0 0 24px;padding-left:0;list-style:none;max-width:68ch}',
  'li{padding-left:24px;position:relative;margin-bottom:11px}',
  'li:before{content:"";position:absolute;left:0;top:13px;width:13px;height:2px;background:#B4451F}',
  'table{margin:26px 0 30px;font-size:15.5px;max-width:68ch}',
  'td,th{padding:14px 16px 14px 0;border-bottom:1px solid rgba(23,21,15,.14);vertical-align:top;text-align:left}',
  'td:first-child,th:first-child{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px;',
  '  letter-spacing:.08em;text-transform:uppercase;color:#7A7263;width:28%}',
  '.sources{margin-top:64px;padding-top:24px;border-top:4px solid #17150F}',
  '.sources h2{font-size:12px;font-family:"JetBrains Mono",ui-monospace,monospace;letter-spacing:.15em;',
  '  text-transform:uppercase;margin:0 0 14px;font-weight:500;color:#7A7263}',
  '.sources h2::before{content:none}',
  '.sources div{font-size:14.5px;margin-bottom:9px}',
  '.sources em.src{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11.5px;',
  '  color:#8A8375;display:block}',
].join('');

// ── Панель: мир данных, тёмная доска, абзацы карточками ─────────────────────
const PANEL = BASE + [
  'body{background:#0D1014;color:#A8B1BE;font:15.5px/1.65 "Golos Text",system-ui,sans-serif;',
  '  background-image:linear-gradient(rgba(91,227,167,.045) 1px,transparent 1px),',
  '    linear-gradient(90deg,rgba(91,227,167,.045) 1px,transparent 1px);background-size:34px 34px}',
  'body::before{background:#5BE3A7}',
  '.page{padding:clamp(18px,3vw,36px);counter-reset:sec;max-width:1500px;margin:0 auto}',
  '.meta{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px;letter-spacing:.16em;',
  '  text-transform:uppercase;color:#55606E;margin:0 0 10px}',
  '.title{font-family:Unbounded,system-ui,sans-serif;font-weight:800;font-size:clamp(24px,3.4vw,44px);',
  '  letter-spacing:-.042em;line-height:1.04;margin:0 0 12px;color:#F2F5F9;max-width:20ch}',
  '.lede{font-size:16px;color:#818C9B;margin:0 0 26px;max-width:74ch}',
  '.stats{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin:0 0 30px}',
  '.stats div{background:#151A21;border:1px solid #222932;border-radius:16px;padding:18px 20px;',
  '  position:relative;overflow:hidden}',
  '.stats div::after{content:"";position:absolute;top:0;left:0;width:34px;height:2px;background:#5BE3A7}',
  '.stats b{display:block;font-family:Unbounded,system-ui,sans-serif;font-weight:800;',
  '  font-variant-numeric:tabular-nums;font-size:clamp(24px,2.8vw,34px);line-height:1;',
  '  letter-spacing:-.03em;color:#5BE3A7}',
  '.stats span{display:block;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:9.5px;',
  '  letter-spacing:.11em;text-transform:uppercase;color:#66717F;margin-top:10px}',
  // ⚠️ Две колонки — ВНУТРИ раздела. Заголовок занимает всю ширину и открывает свой раздел,
  // поэтому разделы не перемешиваются между собой: это и была ошибка колонок.
  'section{display:grid;gap:14px;margin-bottom:22px}',
  '@media(min-width:1080px){section{grid-template-columns:1fr 1fr}}',
  'section>h2,section>blockquote,section>table,section>ul,section>ol{grid-column:1/-1}',
  'h2{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10.5px;letter-spacing:.17em;',
  '  text-transform:uppercase;color:#66717F;margin:10px 0 -2px;font-weight:500;',
  '  display:flex;align-items:center;gap:14px}',
  'h2::before{counter-increment:sec;content:"[" counter(sec,decimal-leading-zero) "]";color:#5BE3A7}',
  'h2::after{content:"";flex:1;height:1px;background:#222932}',
  'h3{font-size:14px;font-weight:600;color:#D6DCE4;margin:0 0 -4px;grid-column:1/-1}',
  'section>p{background:#151A21;border:1px solid #222932;border-radius:16px;padding:19px 21px;margin:0;',
  '  transition:border-color .2s,transform .2s}',
  'section>p:hover{border-color:#2E3A46;transform:translateY(-2px)}',
  'blockquote{margin:4px 0;padding:26px 28px;border-radius:18px;',
  '  background:linear-gradient(135deg,#14302A 0%,#151A21 70%);border:1px solid #24523F;',
  '  font-family:Unbounded,system-ui,sans-serif;font-weight:700;font-size:clamp(16px,1.9vw,23px);',
  '  line-height:1.3;color:#8FF0C4;letter-spacing:-.02em}',
  'ul,ol{background:#151A21;border:1px solid #222932;border-radius:16px;',
  '  padding:19px 21px 19px 40px;margin:0}',
  'li{margin-bottom:9px}li::marker{color:#5BE3A7}',
  'table{background:#151A21;border:1px solid #222932;border-radius:16px;overflow:hidden;font-size:14px}',
  'td,th{padding:14px 18px;border-bottom:1px solid #1D232B;vertical-align:top;text-align:left}',
  'tr:last-child td{border-bottom:none}',
  'td:first-child,th:first-child{color:#66717F;font-family:"JetBrains Mono",ui-monospace,monospace;',
  '  font-size:11px;letter-spacing:.07em;text-transform:uppercase;width:30%}',
  '.sources{margin-top:26px;padding-top:20px;border-top:1px solid #222932;display:grid;gap:10px;',
  '  grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}',
  '.sources h2{grid-column:1/-1;margin:0;color:#66717F}',
  '.sources h2::before{content:none}.sources h2::after{content:none}',
  '.sources div{font-size:13px;color:#818C9B}',
  '.sources em.src{display:block;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px;',
  '  color:#5BE3A7;margin-top:3px}',
].join('');

// ── Полоса: длинное чтение, висячие номера, вылеты во всю ширину ────────────
const POLOSA = BASE + [
  'body{background:#fff;color:#2F343B;font:18.5px/1.76 "Golos Text",system-ui,sans-serif}',
  'body::before{background:#15181C}',
  // ⚠️ Сетка «мера чтения + вылеты»: обычный блок в центральной колонке, врезка и числа
  // объявляют себя full и выходят на всю ширину окна. Тянется СТРАНИЦА, а не строка — строка
  // длиннее 70 знаков теряется на возврате.
  '.page{display:grid;counter-reset:sec;grid-template-columns:',
  '  [full-start] minmax(clamp(14px,4vw,56px),1fr)',
  '  [wide-start] minmax(0,150px)',
  '  [text-start] minmax(0,66ch) [text-end]',
  '  minmax(0,150px) [wide-end]',
  '  minmax(clamp(14px,4vw,56px),1fr) [full-end];',
  '  padding:clamp(26px,5vw,80px) 0 90px}',
  '.page>*,section>*{grid-column:text}',
  // section прозрачен для сетки: его дети встают в общую колонку страницы, но группировка
  // сохраняется — от неё зависит и нумерация, и «первый абзац первого раздела».
  'section{display:contents}',
  '.meta{grid-column:wide;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10.5px;',
  '  letter-spacing:.16em;text-transform:uppercase;color:#8A929D;margin:0 0 16px}',
  '.title{grid-column:wide;font-family:Unbounded,system-ui,sans-serif;font-weight:800;',
  '  font-size:clamp(32px,5.4vw,60px);line-height:1;letter-spacing:-.042em;color:#12151A;margin:0 0 20px}',
  '.lede{grid-column:wide;font-size:clamp(19px,2.1vw,24px);line-height:1.48;color:#5B636E;margin:0 0 46px}',
  '.stats{grid-column:full;display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));',
  '  gap:1px;background:#E6E9ED;border-top:1px solid #E6E9ED;border-bottom:1px solid #E6E9ED;margin:0 0 54px}',
  '.stats div{background:#fff;padding:26px clamp(14px,3vw,36px)}',
  '.stats b{display:block;font-family:Unbounded,system-ui,sans-serif;font-weight:800;',
  '  font-variant-numeric:tabular-nums;font-size:clamp(26px,3.2vw,40px);line-height:1;',
  '  letter-spacing:-.035em;color:#12151A}',
  '.stats span{display:block;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px;',
  '  letter-spacing:.11em;text-transform:uppercase;color:#8A929D;margin-top:10px}',
  // Номер раздела ВИСИТ в левом поле: не занимает места в колонке и держит ритм.
  'h2{font-family:Unbounded,system-ui,sans-serif;font-weight:700;font-size:clamp(21px,2.3vw,29px);',
  '  letter-spacing:-.03em;line-height:1.18;color:#12151A;margin:56px 0 16px;position:relative}',
  'h2::before{counter-increment:sec;content:counter(sec,decimal-leading-zero);position:absolute;',
  '  left:-64px;top:.36em;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:12px;',
  '  letter-spacing:.1em;color:#B6BDC6;font-weight:400}',
  '@media(max-width:1000px){h2::before{position:static;display:block;margin-bottom:8px}}',
  'h3{font-size:19px;font-weight:600;color:#12151A;margin:28px 0 10px}',
  'p{margin:0 0 22px}',
  'section:first-of-type>h2+p{font-size:1.06em}',
  'section:first-of-type>h2+p::first-letter{font-family:Unbounded,system-ui,sans-serif;font-weight:800;',
  '  font-size:3.5em;float:left;line-height:.84;padding:.04em .1em 0 0;color:#12151A}',
  'blockquote{grid-column:full;margin:56px 0;padding:clamp(34px,6vw,72px) clamp(16px,6vw,90px);',
  '  background:#12151A;color:#fff;font-family:Unbounded,system-ui,sans-serif;font-weight:700;',
  '  font-size:clamp(19px,2.8vw,34px);line-height:1.28;letter-spacing:-.028em;text-align:center;',
  '  position:relative;overflow:hidden;isolation:isolate}',
  // ⚠️ Кавычка — ФОН, а не украшение поверх текста. Позиционированный ::before рисуется НАД текстом
  // соседнего узла, и на живом прогоне она легла прямо на первую строку. z-index:-1 уводит её под текст,
  // а isolation выше не даёт ей уйти за сам фон врезки и пропасть вовсе.
  'blockquote::before{content:"«";position:absolute;z-index:-1;left:clamp(4px,2vw,32px);',
  '  top:clamp(-18px,-2vw,-6px);font-family:Unbounded,system-ui,sans-serif;',
  '  font-size:clamp(72px,11vw,160px);line-height:1;color:#1C2129}',
  'ul,ol{margin:0 0 26px;padding-left:0;list-style:none}',
  'li{padding-left:28px;position:relative;margin-bottom:12px}',
  'li:before{content:"";position:absolute;left:2px;top:13px;width:9px;height:9px;border-radius:50%;',
  '  border:2px solid #12151A}',
  'table{grid-column:wide;margin:28px 0 36px;font-size:16px}',
  'td,th{padding:16px 18px 16px 0;border-bottom:1px solid #EDEFF2;vertical-align:top;text-align:left}',
  'td:first-child,th:first-child{color:#8A929D;width:28%;font-weight:500}',
  '.sources{grid-column:wide;margin-top:70px;padding-top:26px;border-top:1px solid #E6E9ED}',
  '.sources h2{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px;letter-spacing:.15em;',
  '  text-transform:uppercase;color:#8A929D;font-weight:500;margin:0 0 14px}',
  '.sources h2::before{content:none}',
  '.sources div{font-size:15px;margin-bottom:10px}',
  '.sources em.src{display:block;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:12px;color:#8A929D}',
].join('');

export const STYLE_CSS: Record<PageStyle, string> = {
  izdanie: IZDANIE,
  panel: PANEL,
  polosa: POLOSA,
};
