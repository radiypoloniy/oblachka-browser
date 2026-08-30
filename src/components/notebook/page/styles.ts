// Три стиля страницы: ОДНА разметка — три разных мира.
//
// ⚠️ Прежние три шаблона были честно названы «шапками разных цветов»: отличались обложкой и почти
// ничем больше. Здесь отличается ВСЁ, кроме содержимого, — гарнитура, сетка, поведение ширины,
// сама метафора. Так и должно быть: если два стиля различимы только цветом, их не два, а один.
//
// ⚠️ Ширина ТЯНУЩАЯСЯ, а не лист в 1080 px посреди серого поля. Прошлый вариант перестал
// ломаться на узком окне, но так и не начал пользоваться широким — жалоба «всё узкое» была ровно
// про это. Поля здесь в процентах и clamp, колонка текста задаётся мерой чтения (ch), а врезки и
// числа выходят на всю ширину окна.
//
// ⚠️ Стили ЧИСЛАМИ, а не токенами: страница уезжает человеку, у которого нашего браузера нет.

export type PageStyle = 'izdanie' | 'panel' | 'polosa';

export const PAGE_STYLES: { id: PageStyle; label: string; hint: string }[] = [
  { id: 'izdanie', label: 'Издание', hint: 'Бумага, засечный набор, две колонки на широком экране' },
  { id: 'panel',   label: 'Панель',  hint: 'Тёмная приборная доска: каждый абзац карточкой' },
  { id: 'polosa',  label: 'Полоса',  hint: 'Длинное чтение: цитаты и числа выходят во всю ширину' },
];

const SHARED = [
  '*{box-sizing:border-box}',
  'html,body{margin:0}',
  'img{max-width:100%}',
  'table{width:100%;border-collapse:collapse}',
  'em.src{font-style:normal}',
].join('');

// ── Издание: бумажный мир, засечная гарнитура, журнальная полоса ────────────
const IZDANIE = SHARED + [
  'body{background:#F5F1E8;color:#2B2A26;font:17px/1.62 "Golos Text",system-ui,sans-serif}',
  '.page{padding:clamp(20px,4vw,56px) clamp(16px,6vw,90px) 70px}',
  '.title{font-family:Fraunces,Georgia,"Times New Roman",serif;font-weight:900;',
  '  font-size:clamp(32px,7vw,86px);line-height:.95;letter-spacing:-.03em;margin:0 0 20px;',
  '  color:#17150F;max-width:16ch}',
  '.lede{font-family:Fraunces,Georgia,serif;font-size:clamp(18px,2.2vw,27px);line-height:1.35;',
  '  color:#4A463C;max-width:34ch;margin:0 0 34px}',
  '.meta{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px;letter-spacing:.14em;',
  '  text-transform:uppercase;color:#8A8375;margin:0 0 18px}',
  '.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0;margin:0 0 44px;',
  '  border-top:3px solid #17150F;border-bottom:3px solid #17150F}',
  '.stats div{padding:18px 18px 18px 0}',
  '.stats b{display:block;font-family:Fraunces,Georgia,serif;font-weight:900;',
  '  font-size:clamp(26px,3.4vw,42px);line-height:1;letter-spacing:-.03em;color:#B4451F;',
  '  font-variant-numeric:tabular-nums}',
  '.stats span{display:block;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px;',
  '  letter-spacing:.12em;text-transform:uppercase;color:#6E695C;margin-top:8px}',
  'h2{font-family:Fraunces,Georgia,serif;font-weight:600;font-size:clamp(23px,2.6vw,34px);',
  '  letter-spacing:-.02em;line-height:1.12;margin:44px 0 14px;color:#17150F;column-span:all}',
  'h3{font-size:17px;font-weight:700;margin:22px 0 8px;color:#17150F}',
  '.body>p{margin:0 0 16px}',
  '@media(min-width:900px){.body>p{columns:2;column-gap:52px}}',
  'blockquote{margin:38px 0;padding:26px 0;font-family:Fraunces,Georgia,serif;font-weight:600;',
  '  font-size:clamp(20px,3vw,34px);line-height:1.22;color:#B4451F;max-width:22ch;',
  '  border-top:3px solid #B4451F;border-bottom:3px solid #B4451F}',
  'table{margin:26px 0 30px;font-size:15px}',
  'td,th{padding:13px 16px 13px 0;border-bottom:1px solid rgba(23,21,15,.14);vertical-align:top;text-align:left}',
  'td:first-child,th:first-child{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px;',
  '  letter-spacing:.08em;text-transform:uppercase;color:#6E695C;width:26%}',
  'ul,ol{margin:0 0 26px;padding-left:0;list-style:none;columns:2;column-gap:44px}',
  '@media(max-width:700px){ul,ol{columns:1}}',
  'li{padding-left:22px;position:relative;margin-bottom:11px;break-inside:avoid}',
  'li:before{content:"";position:absolute;left:0;top:11px;width:12px;height:2px;background:#B4451F}',
  '.sources{margin-top:56px;padding-top:22px;border-top:3px solid #17150F}',
  '.sources h2{font-size:13px;font-family:"JetBrains Mono",ui-monospace,monospace;letter-spacing:.14em;',
  '  text-transform:uppercase;margin:0 0 12px;font-weight:500;color:#6E695C}',
  '.sources div{font-size:14px;margin-bottom:7px}',
  '.sources em.src{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11.5px;',
  '  color:#6E695C;display:block}',
].join('');

// ── Панель: мир данных, тёмный фон, каждый абзац карточкой ──────────────────
const PANEL = SHARED + [
  'body{background:#0E1116;color:#AEB6C2;font:15px/1.6 "Golos Text",system-ui,sans-serif}',
  '.page{padding:clamp(18px,3vw,34px);display:grid;gap:14px;',
  '  grid-template-columns:repeat(auto-fit,minmax(300px,1fr));align-content:start}',
  '.page>*{grid-column:1/-1}',
  '.meta{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px;letter-spacing:.14em;',
  '  text-transform:uppercase;color:#5A6472;margin:0}',
  '.title{font-family:Unbounded,system-ui,sans-serif;font-weight:800;',
  '  font-size:clamp(23px,3.2vw,40px);letter-spacing:-.04em;line-height:1.05;margin:0;color:#F2F5F9}',
  '.lede{font-size:15.5px;color:#8A94A3;margin:-4px 0 6px;max-width:80ch}',
  '.stats{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin:0}',
  '.stats div{background:#161B23;border:1px solid #232A35;border-radius:14px;padding:16px 18px}',
  '.stats b{display:block;font-family:Unbounded,system-ui,sans-serif;font-weight:800;',
  '  font-size:clamp(22px,2.6vw,30px);line-height:1;letter-spacing:-.03em;color:#5BE3A7;',
  '  font-variant-numeric:tabular-nums}',
  '.stats span{display:block;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:9.5px;',
  '  letter-spacing:.11em;text-transform:uppercase;color:#6C7785;margin-top:9px}',
  // Заголовок раздела — тонкой линейкой, а не плитой: он служебный, содержимое в карточках.
  'h2{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10.5px;letter-spacing:.16em;',
  '  text-transform:uppercase;color:#6C7785;margin:20px 0 -4px;font-weight:500;',
  '  display:flex;align-items:center;gap:12px}',
  'h2:after{content:"";flex:1;height:1px;background:#232A35}',
  'h3{font-size:14px;font-weight:600;color:#D6DCE4;margin:14px 0 -6px}',
  '.body>p{background:#161B23;border:1px solid #232A35;border-radius:14px;padding:17px 19px;',
  '  margin:0;grid-column:auto}',
  '@media(min-width:820px){.body{display:contents}}',
  'blockquote{margin:6px 0;padding:22px 24px;border-radius:16px;',
  '  background:linear-gradient(135deg,#16302A,#161B23);border:1px solid #245244;',
  '  font-family:Unbounded,system-ui,sans-serif;font-weight:700;font-size:clamp(15px,1.7vw,20px);',
  '  line-height:1.32;color:#8FF0C4;letter-spacing:-.02em}',
  'table{background:#161B23;border:1px solid #232A35;border-radius:14px;overflow:hidden;',
  '  margin:0;font-size:14px}',
  'td,th{padding:13px 18px;border-bottom:1px solid #1E242D;vertical-align:top;text-align:left}',
  'tr:last-child td{border-bottom:none}',
  'td:first-child,th:first-child{color:#6C7785;font-family:"JetBrains Mono",ui-monospace,monospace;',
  '  font-size:11px;letter-spacing:.07em;text-transform:uppercase;width:30%}',
  'ul,ol{background:#161B23;border:1px solid #232A35;border-radius:14px;',
  '  padding:17px 19px 17px 36px;margin:0}',
  'li{margin-bottom:9px}',
  'li::marker{color:#5BE3A7}',
  '.sources{margin-top:12px;padding-top:18px;border-top:1px solid #232A35;display:grid;gap:10px;',
  '  grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}',
  '.sources h2{grid-column:1/-1;margin:0 0 2px}',
  '.sources div{font-size:13px;color:#8A94A3}',
  '.sources em.src{display:block;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px;',
  '  color:#5BE3A7;margin-top:2px}',
].join('');

// ── Полоса: длинное чтение, мера чтения плюс вылеты во всю ширину ───────────
const POLOSA = SHARED + [
  'body{background:#FFFFFF;color:#33383F;font:17.5px/1.72 "Golos Text",system-ui,sans-serif}',
  // ⚠️ Сетка «мера чтения + вылеты»: обычный блок стоит в центральной колонке, а цитата и числа
  // объявляют себя full и выходят на всю ширину окна. Именно это и есть «адаптивность» — не
  // растянутый абзац (строка длиннее 75 знаков теряется на возврате), а работающая ширина.
  '.page{display:grid;grid-template-columns:',
  '  [full-start] minmax(clamp(14px,4vw,60px),1fr)',
  '  [wide-start] minmax(0,190px)',
  '  [text-start] minmax(0,68ch) [text-end]',
  '  minmax(0,190px) [wide-end]',
  '  minmax(clamp(14px,4vw,60px),1fr) [full-end];',
  '  padding:clamp(24px,5vw,72px) 0 80px}',
  '.page>*,.body>*{grid-column:text}',
  '@media(min-width:0px){.body{display:contents}}',
  '.meta{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10.5px;letter-spacing:.14em;',
  '  text-transform:uppercase;color:#8A929D;margin:0 0 14px;grid-column:wide}',
  '.title{font-family:Unbounded,system-ui,sans-serif;font-weight:800;font-size:clamp(30px,5vw,54px);',
  '  line-height:1.02;letter-spacing:-.04em;color:#15181C;margin:0 0 18px;grid-column:wide}',
  '.lede{font-size:clamp(18px,2vw,22px);line-height:1.5;color:#5B636E;margin:0 0 40px;grid-column:wide}',
  '.stats{grid-column:full;display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));',
  '  gap:1px;background:#E4E7EB;border-top:1px solid #E4E7EB;border-bottom:1px solid #E4E7EB;',
  '  margin:0 0 44px}',
  '.stats div{background:#fff;padding:22px clamp(14px,3vw,34px)}',
  '.stats b{display:block;font-family:Unbounded,system-ui,sans-serif;font-weight:800;',
  '  font-size:clamp(24px,3vw,36px);line-height:1;letter-spacing:-.035em;color:#15181C;',
  '  font-variant-numeric:tabular-nums}',
  '.stats span{display:block;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:10px;',
  '  letter-spacing:.11em;text-transform:uppercase;color:#8A929D;margin-top:9px}',
  'h2{font-family:Unbounded,system-ui,sans-serif;font-weight:700;font-size:clamp(20px,2.2vw,27px);',
  '  letter-spacing:-.03em;line-height:1.2;color:#15181C;margin:48px 0 14px}',
  'h3{font-size:17px;font-weight:600;color:#15181C;margin:26px 0 8px}',
  '.body>p{margin:0 0 20px}',
  'blockquote{grid-column:full;margin:44px 0;padding:clamp(28px,5vw,54px) clamp(16px,6vw,90px);',
  '  background:#15181C;color:#fff;font-family:Unbounded,system-ui,sans-serif;font-weight:700;',
  '  font-size:clamp(18px,2.6vw,30px);line-height:1.3;letter-spacing:-.025em}',
  'table{grid-column:wide;margin:26px 0 34px;font-size:15.5px}',
  'td,th{padding:15px 18px 15px 0;border-bottom:1px solid #EDEFF2;vertical-align:top;text-align:left}',
  'td:first-child,th:first-child{color:#8A929D;width:28%;font-weight:500}',
  'ul,ol{margin:0 0 26px;padding-left:0;list-style:none}',
  'li{padding-left:26px;position:relative;margin-bottom:12px}',
  'li:before{content:"";position:absolute;left:2px;top:12px;width:9px;height:9px;border-radius:50%;',
  '  border:2px solid #15181C}',
  '.sources{grid-column:wide;margin-top:60px;padding-top:24px;border-top:1px solid #E4E7EB}',
  '.sources h2{font-family:"JetBrains Mono",ui-monospace,monospace;font-size:11px;letter-spacing:.14em;',
  '  text-transform:uppercase;color:#8A929D;font-weight:500;margin:0 0 12px}',
  '.sources div{font-size:14.5px;margin-bottom:9px}',
  '.sources em.src{display:block;font-family:"JetBrains Mono",ui-monospace,monospace;font-size:12px;',
  '  color:#8A929D}',
].join('');

export const STYLE_CSS: Record<PageStyle, string> = {
  izdanie: IZDANIE,
  panel: PANEL,
  polosa: POLOSA,
};
