// Скрипты стилей страницы: то, что делает её сайтом, а не картинкой.
//
// ⚠️ ЭТО НАШ КОД, а не код модели. Ответ модели проходит через sanitizeDocHtml, который
// выбрасывает `<script>` вместе с содержимым, и это правило не меняется. Здесь лежит ровно то,
// что мы кладём в страницу сами.
//
// ⚠️ Работает в песочнице `sandbox="allow-scripts"` БЕЗ `allow-same-origin` (см. PageView.tsx):
// доступа к родителю, куки и хранилищу у страницы нет. Поэтому здесь нельзя рассчитывать ни на
// localStorage, ни на что-либо снаружи — только DOM самой страницы.
//
// ⚠️ Никаких библиотек. Каждая строка едет в файл, который человек кому-то отправит; тянуть
// туда чужой код ради двух обработчиков — плохая сделка. Всё, что нужно, укладывается в
// несколько десятков строк на голом DOM.
//
// ⚠️ Уважение к prefers-reduced-motion делает CSS: плавная прокрутка гасится там же
// (scroll-behavior), а здесь остаётся только логика.

/** «Пульт»: разделы вкладками, абзацы раскрываются. */
const PANEL_JS = `
var navs = [].slice.call(document.querySelectorAll('.nav'));
var panes = [].slice.call(document.querySelectorAll('.pane'));
navs.forEach(function (b) {
  b.addEventListener('click', function () {
    navs.forEach(function (x) { x.classList.toggle('on', x === b); });
    panes.forEach(function (p) { p.classList.toggle('on', p.dataset.i === b.dataset.i); });
  });
});
// Абзац раскрывается по шапке. Высоту анимирует CSS (grid-template-rows), поэтому мерить
// ничего не надо — скрипту остаётся один класс.
[].slice.call(document.querySelectorAll('.chead')).forEach(function (h) {
  h.addEventListener('click', function () { h.parentNode.classList.toggle('open'); });
});
`;

/** «Лонгрид»: полоса чтения, подсветка раздела в оглавлении, кнопка наверх. */
const POLOSA_JS = `
var bar = document.getElementById('read-bar');
var up = document.getElementById('to-top');
// ⚠️ Меряем ЗАГОЛОВКИ, а не разделы, и это не стилистика. В «Лонгриде» раздел объявлен
// display:contents — он раскрывается в сетку страницы и СВОЕЙ КОРОБКИ НЕ ИМЕЕТ, поэтому
// getBoundingClientRect() возвращает у него сплошные нули. Условие «верх выше 40 % экрана»
// выполнялось тогда для ВСЕХ разделов сразу, и текущим всегда оказывался последний — что и
// было видно: стоишь в начале, подсвечен конец.
var secs = [].slice.call(document.querySelectorAll('section')).map(function (s) {
  return s.querySelector('h2') || s;
});
var links = [].slice.call(document.querySelectorAll('.toc a'));
function tick() {
  var h = document.body.scrollHeight - window.innerHeight;
  if (bar) bar.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + '%';
  if (up) up.classList.toggle('on', window.scrollY > 400);
  // Текущий раздел — последний, чья верхушка выше 40 % экрана. Порог, а не пересечение:
  // короткий раздел иначе никогда не становился бы текущим.
  var cur = 0;
  secs.forEach(function (s, i) { if (s.getBoundingClientRect().top < window.innerHeight * 0.4) cur = i; });
  links.forEach(function (a, i) { a.classList.toggle('on', i === cur); });
}
window.addEventListener('scroll', tick, { passive: true });
window.addEventListener('resize', tick);
tick();
if (up) up.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
`;

export const STYLE_SCRIPTS = {
  izdanie: '',
  panel: PANEL_JS,
  polosa: POLOSA_JS,
} as const;
