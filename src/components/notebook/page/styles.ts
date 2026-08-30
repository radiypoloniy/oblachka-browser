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

import { STYLE_SCRIPTS } from './scripts';

export type PageStyle = 'izdanie' | 'panel' | 'ekran';

export const PAGE_STYLES: { id: PageStyle; label: string; hint: string }[] = [
  { id: 'izdanie', label: 'Издание', hint: 'Бумага: заголовок на поле едет за текстом, буквица, зерно' },
  { id: 'panel',   label: 'Пульт',   hint: 'Разделы вкладками, абзацы раскрываются, тёмная доска' },
  { id: 'ekran',   label: 'Экран',   hint: 'Кино: титры, проявление разделов, счёт чисел' },
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
  // ⚠️ Разделы стали ВКЛАДКАМИ, а не лентой. Причина в жалобе «сделано по остаточному
  // принципу»: тёмная доска без единого отклика читалась картинкой, а не прибором. Теперь
  // виден один раздел, переход — мягким подъёмом.
  '.navrow{display:flex;gap:8px;overflow-x:auto;padding:0 0 18px;scrollbar-width:none}',
  '.navrow::-webkit-scrollbar{display:none}',
  '.nav{flex:none;display:flex;align-items:center;gap:9px;background:#151A21;border:1px solid #222932;',
  '  color:#8A94A3;border-radius:999px;padding:9px 16px;font:inherit;font-size:13px;font-weight:600;',
  '  cursor:pointer;font-family:inherit;transition:background .18s,color .18s,border-color .18s}',
  '.nav .k{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px;color:#5BE3A7}',
  '.nav:hover{border-color:#2E3A46;color:#C9D2DD}',
  '.nav.on{background:#5BE3A7;color:#0D1014;border-color:#5BE3A7}',
  '.nav.on .k{color:rgba(13,16,20,.6)}',
  // «Развернуть всё» — та же пилюля, но приглушённая: это служебное действие, а не раздел.
  '.nav.toggle{margin-left:auto;color:#66717F;border-style:dashed}',
  '.nav.toggle:hover{color:#5BE3A7;border-color:#2E4A3E}',
  'section{display:none;margin-bottom:22px}',
  'section.on{display:block;animation:oblako-pane-in .32s cubic-bezier(.16,1,.3,1) both}',
  '@keyframes oblako-pane-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}',
  // Абзац — раскрывающаяся карточка. Высоту анимирует сетка, а не скрипт: мерить нечего.
  '.cardx{background:#151A21;border:1px solid #222932;border-radius:16px;margin-bottom:10px;overflow:hidden}',
  '.chead{width:100%;display:flex;align-items:center;justify-content:space-between;background:none;',
  '  border:0;color:#7C8797;font:inherit;font-family:"JetBrains Mono",ui-monospace,monospace;',
  '  font-size:10px;letter-spacing:.14em;text-transform:uppercase;padding:14px 18px;cursor:pointer}',
  '.chead i{width:9px;height:9px;border-right:2px solid #5BE3A7;border-bottom:2px solid #5BE3A7;',
  '  transform:rotate(45deg);transition:transform .25s cubic-bezier(.16,1,.3,1);margin-bottom:3px}',
  '.cardx.open .chead i{transform:rotate(-135deg);margin-bottom:-3px}',
  '.cbody{display:grid;grid-template-rows:0fr;transition:grid-template-rows .3s cubic-bezier(.16,1,.3,1)}',
  '.cardx.open .cbody{grid-template-rows:1fr}',
  '.cbody>p{overflow:hidden;margin:0;padding:0 18px;max-width:74ch;background:none;border:0}',
  '.cardx.open .cbody>p{padding:0 18px 16px}',
  '@media(prefers-reduced-motion:reduce){section.on{animation:none}',
  '  .cbody,.chead i{transition:none}}',
  // ⚠️ Заголовок внутри вкладки — НАСТОЯЩИЙ заголовок, а не моношрифтовая метка. Метка с
  // номером теперь живёт на кнопке вкладки, и дублировать её тут значило бы сказать одно
  // дважды. Заодно чинится счётчик: у скрытых разделов (display:none) ::before не создаётся,
  // counter-increment не срабатывает — номер в заголовке всегда показывал бы «01».
  'h2{font-family:Unbounded,system-ui,sans-serif;font-weight:700;font-size:clamp(19px,2.2vw,26px);',
  '  letter-spacing:-.03em;line-height:1.16;color:#F2F5F9;margin:2px 0 16px}',
  'h3{font-size:14px;font-weight:600;color:#D6DCE4;margin:0 0 -4px;grid-column:1/-1}',
  // Отклик на курсор у числовых плиток: деталь, которая отличает прибор от картинки.
  '.stats div{transition:transform .18s,border-color .18s}',
  '.stats div:hover{transform:translateY(-3px);border-color:#2E3A46}',
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
  // ⚠️ Источники СТРОКАМИ, а не сеткой. Сетка auto-fit разводила их по колонкам разной
  // высоты, и подвал «ехал»: два названия разной длины давали разный низ. Строка с адресом
  // справа читается списком и не может разъехаться по построению.
  '.sources{margin-top:26px;padding-top:18px;border-top:1px solid #222932}',
  '.sources h2{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px;letter-spacing:.16em;',
  '  text-transform:uppercase;color:#66717F;font-weight:500;margin:0 0 12px}',
  '.sources div{display:flex;align-items:baseline;gap:14px;font-size:13.5px;color:#A8B1BE;',
  '  padding:9px 0;border-bottom:1px solid #1B212A}',
  '.sources div:last-child{border-bottom:none}',
  '.sources em.src{margin-left:auto;flex:none;font-family:"JetBrains Mono",ui-monospace,monospace;',
  '  font-size:11.5px;color:#5BE3A7}',
].join('');

// ── Экран: кино, а не бумага ─────────────────────────────────────────────────
//
// ⚠️ Третий стиль переписан целиком. Прежний («Полоса») был честно назван «газетой на белом»:
// я взял «Издание», убрал засечки и покрасил в белое — вышел тот же документ, только тише.
// Белый фон, чёрный текст, единственный приём — оглавление сбоку, ни одного состояния.
//
// ⚠️ Отсюда решение о территориях: «Издание» — бумага, «Пульт» — прибор, третьему остаётся
// КИНО. Тёмный зал, крупный кегль, вещи появляются по мере того, как до них доходишь.
// Название честнее прежнего: «Экран» не обещает газету.
//
// ⚠️ Скролл-джекинга здесь нет и не будет. Прокрутка обычная: ни перехвата колеса, ни
// «долистывания» за человека — это первое, что раздражает на сайтах-презентациях. Всё движение
// отвечает только на вопросы «где я», «что появилось», «сколько осталось».
const EKRAN = BASE + [
  'html{scroll-behavior:smooth}',
  'body{background:#0B0A0F;color:#9C9AA8;font:19px/1.72 "Golos Text",system-ui,sans-serif;overflow-x:hidden}',
  'body::before{display:none}',
  // Титры: первый экран занят целиком, название уезжает медленнее текста (параллакс на слое).
  '.hero{min-height:92vh;display:flex;flex-direction:column;justify-content:center;',
  '  padding:0 clamp(20px,7vw,110px);position:relative}',
  '.hero .meta{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10.5px;letter-spacing:.2em;',
  '  text-transform:uppercase;color:#4E4B5C;margin-bottom:26px}',
  '.hero .title{font-family:Unbounded,system-ui,sans-serif;font-weight:800;',
  '  font-size:clamp(38px,9vw,116px);line-height:.92;letter-spacing:-.05em;color:#fff;',
  '  margin:0 0 28px;max-width:14ch}',
  '.hero .lede{font-family:"Instrument Serif",Georgia,serif;font-style:italic;',
  '  font-size:clamp(19px,2.6vw,32px);line-height:1.34;color:#8F8CA0;max-width:30ch;margin:0}',
  '.hero .down{position:absolute;bottom:34px;left:clamp(20px,7vw,110px);',
  '  font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px;letter-spacing:.18em;',
  '  text-transform:uppercase;color:#413E4E;animation:oblako-bob 2.4s ease-in-out infinite}',
  '@keyframes oblako-bob{0%,100%{transform:translateY(0);opacity:.7}50%{transform:translateY(5px);opacity:1}}',
  '.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:1px;',
  '  background:#191722;border-top:1px solid #191722;border-bottom:1px solid #191722;',
  '  margin:0 0 clamp(60px,10vw,130px)}',
  '.stats div{background:#0B0A0F;padding:clamp(22px,3vw,38px) clamp(18px,3vw,34px)}',
  '.stats b{display:block;font-family:Unbounded,system-ui,sans-serif;font-weight:800;',
  '  font-size:clamp(26px,4vw,48px);line-height:1;letter-spacing:-.04em;color:#fff;',
  '  font-variant-numeric:tabular-nums}',
  '.stats span{display:block;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:9.5px;',
  '  letter-spacing:.13em;text-transform:uppercase;color:#5A5668;margin-top:12px}',
  'section{position:relative;padding:0 clamp(20px,7vw,110px);margin-bottom:clamp(52px,8vw,104px)}',
  '@media(min-width:1100px){section{padding-left:clamp(150px,16vw,260px)}}',
  // Огромный номер на поле — украшение, а не навигация: на узком окне он встаёт над текстом.
  '.no{position:absolute;left:clamp(20px,4vw,60px);top:-0.16em;',
  '  font-family:Unbounded,system-ui,sans-serif;font-weight:800;font-size:clamp(56px,9vw,132px);',
  '  line-height:1;color:#16141E;letter-spacing:-.06em;pointer-events:none;user-select:none}',
  '@media(max-width:1099px){.no{position:static;display:block;font-size:44px;margin-bottom:6px}}',
  'h2{font-family:Unbounded,system-ui,sans-serif;font-weight:700;font-size:clamp(23px,3.4vw,44px);',
  '  letter-spacing:-.04em;line-height:1.08;color:#fff;margin:0 0 22px;max-width:20ch}',
  'h3{font-family:Unbounded,system-ui,sans-serif;font-weight:700;font-size:20px;color:#fff;margin:26px 0 10px}',
  'section p{margin:0 0 24px;max-width:60ch}',
  'section p:first-of-type{color:#B8B5C6}',
  // Врезка держит паузу во весь экран — единственный акцентный цвет в стиле.
  'blockquote{margin:0 0 clamp(52px,8vw,104px);min-height:76vh;display:flex;align-items:center;',
  '  padding:0 clamp(20px,7vw,110px);background:#100E17;',
  '  border-top:1px solid #1C1926;border-bottom:1px solid #1C1926;',
  '  font-family:"Instrument Serif",Georgia,serif;font-style:italic;',
  '  font-size:clamp(24px,4.6vw,58px);line-height:1.18;color:#C9A227}',
  'blockquote p{margin:0;max-width:18ch;font:inherit;color:inherit}',
  'ul,ol{margin:0 0 26px;padding-left:0;list-style:none;max-width:60ch}',
  'li{padding-left:26px;position:relative;margin-bottom:13px}',
  'li:before{content:"";position:absolute;left:2px;top:14px;width:8px;height:8px;',
  '  border-radius:50%;background:#C9A227}',
  'table{margin:26px 0 34px;font-size:16px;max-width:64ch}',
  'td,th{padding:15px 18px 15px 0;border-bottom:1px solid #1C1926;vertical-align:top;text-align:left}',
  'td:first-child,th:first-child{color:#5A5668;width:28%}',
  // Кольцо прогресса — оно же кнопка «наверх». Один предмет вместо двух, и его видно.
  '#ring{position:fixed;right:22px;bottom:22px;width:52px;height:52px;border:0;background:none;',
  '  cursor:pointer;opacity:0;transform:scale(.85);transition:opacity .25s,transform .25s;z-index:9}',
  '#ring.on{opacity:1;transform:none}',
  '#ring svg{display:block;transform:rotate(-90deg)}',
  '#ring circle{fill:none;stroke-width:2}',
  '#ring .bg{stroke:#221F2C}',
  '#ring .fg{stroke:#C9A227;stroke-linecap:round;transition:stroke-dashoffset .12s linear}',
  '#ring i{position:absolute;inset:0;display:grid;place-items:center;color:#8F8CA0;',
  '  font-size:15px;font-style:normal}',
  '.rise{opacity:0;transform:translateY(22px);',
  '  transition:opacity .7s cubic-bezier(.16,1,.3,1),transform .7s cubic-bezier(.16,1,.3,1)}',
  '.rise.in{opacity:1;transform:none}',
  '.sources{margin:0 clamp(20px,7vw,110px);padding-top:26px;border-top:1px solid #1C1926}',
  '.sources h2{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px;letter-spacing:.15em;',
  '  text-transform:uppercase;color:#5A5668;font-weight:500;margin:0 0 14px;max-width:none}',
  '.sources div{display:flex;align-items:baseline;gap:14px;font-size:15px;color:#9C9AA8;',
  '  padding:9px 0;border-bottom:1px solid #16141E}',
  '.sources div:last-child{border-bottom:none}',
  '.sources em.src{margin-left:auto;flex:none;font-family:"JetBrains Mono",ui-monospace,monospace;',
  '  font-size:12px;color:#5A5668}',
  '@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}',
  '  .rise{opacity:1;transform:none;transition:none}.hero .down{animation:none}',
  '  #ring{transition:none}}',
].join('');

export const STYLE_CSS: Record<PageStyle, string> = {
  izdanie: IZDANIE,
  panel: PANEL,
  ekran: EKRAN,
};

/**
 * Скрипт стиля — то, что делает страницу сайтом, а не картинкой.
 *
 * ⚠️ Пустая строка означает «стилю скрипт не нужен», и у «Издания» он именно такой: там всё
 * движение уже сделано на CSS (`animation-timeline`), а трогать этот стиль не просили — он
 * нравится как есть.
 */
export const STYLE_JS: Record<PageStyle, string> = STYLE_SCRIPTS;
