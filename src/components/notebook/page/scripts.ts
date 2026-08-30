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
// Стрелки листают разделы. Раз скрипты разрешены — не дать клавиши было бы странно.
document.addEventListener('keydown', function (e) {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  var i = navs.findIndex(function (b) { return b.classList.contains('on'); });
  var next = e.key === 'ArrowRight' ? Math.min(i + 1, navs.length - 1) : Math.max(i - 1, 0);
  if (next !== i) navs[next].click();
});
// «Развернуть всё» — одна кнопка на весь раздел. Решение принимается по ПЕРВОЙ карточке:
// если она свёрнута, значит человек хочет открыть, и наоборот.
var all = document.getElementById('toggle-all');
if (all) all.addEventListener('click', function () {
  var pane = document.querySelector('.pane.on');
  if (!pane) return;
  var cards = [].slice.call(pane.querySelectorAll('.cardx'));
  var open = !(cards[0] && cards[0].classList.contains('open'));
  cards.forEach(function (c) { c.classList.toggle('open', open); });
  all.textContent = open ? 'Свернуть всё' : 'Развернуть всё';
});
`;

/**
 * «Экран»: проявление разделов, счёт чисел, кольцо прогресса, параллакс титров.
 *
 * ⚠️ Появление и счёт — на IntersectionObserver, а не на обработчике прокрутки: наблюдатель
 * будит браузер только когда элемент реально пересёк край, а обработчик считает на каждом
 * кадре. На странице в полтора десятка блоков разница видна на слабой машине.
 *
 * ⚠️ Каждый наблюдатель отписывается от элемента, который уже сработал (unobserve). Иначе
 * появление проигрывалось бы заново при каждом возврате — движение, которое повторяется,
 * перестаёт что-либо означать.
 */
const EKRAN_JS = `
var ring = document.getElementById('ring');
var fg = ring && ring.querySelector('.fg');
var ttl = document.querySelector('.hero .title');
var LEN = 144.5;   // длина окружности r=23

var io = new IntersectionObserver(function (es) {
  es.forEach(function (e) {
    if (!e.isIntersecting) return;
    e.target.classList.add('in');
    io.unobserve(e.target);
  });
}, { threshold: 0.15 });
[].slice.call(document.querySelectorAll('.rise')).forEach(function (el) { io.observe(el); });

// Досчёт числа до значения. Считаем ЧИСЛОВУЮ ЧАСТЬ, а суффикс («тыс.», «млрд», «%») оставляем
// на месте: подставлять его самим значило бы разбирать единицы, которых мы не знаем.
function count(el) {
  var raw = el.getAttribute('data-v') || el.textContent;
  var m = raw.match(/[0-9][0-9\s.,]*/);
  if (!m) return;
  var target = parseFloat(m[0].replace(/\s/g, '').replace(',', '.'));
  if (!isFinite(target)) return;
  var t0 = performance.now();
  function step(t) {
    var k = Math.min(1, (t - t0) / 900);
    var v = target * (1 - Math.pow(1 - k, 3));
    var shown = (target % 1 ? v.toFixed(1) : Math.round(v)).toString();
    el.textContent = raw.replace(m[0], shown);
    if (k < 1) requestAnimationFrame(step); else el.textContent = raw;
  }
  requestAnimationFrame(step);
}
var io2 = new IntersectionObserver(function (es) {
  es.forEach(function (e) {
    if (!e.isIntersecting) return;
    count(e.target);
    io2.unobserve(e.target);
  });
}, { threshold: 0.6 });
[].slice.call(document.querySelectorAll('.stats b')).forEach(function (el) { io2.observe(el); });

function tick() {
  var h = document.body.scrollHeight - window.innerHeight;
  var k = h > 0 ? window.scrollY / h : 0;
  if (fg) fg.setAttribute('stroke-dashoffset', String(LEN * (1 - k)));
  if (ring) ring.classList.toggle('on', window.scrollY > 300);
  // Параллакс титров: название уезжает медленнее страницы и останавливается — дальше оно
  // всё равно за кадром, и продолжать движение нечему.
  if (ttl) ttl.style.transform = 'translateY(' + Math.min(window.scrollY * 0.22, 140) + 'px)';
}
window.addEventListener('scroll', tick, { passive: true });
window.addEventListener('resize', tick);
tick();
if (ring) ring.addEventListener('click', function () { window.scrollTo({ top: 0, behavior: 'smooth' }); });
`;

/**
 * «Колода»: точки-указатели и листание стрелками.
 *
 * ⚠️ Стрелки ДОБАВЛЯЮТ способ листать, а не заменяют прокрутку. Колесо, тачпад и полоса
 * работают как везде — перехватывать их (скролл-джекинг) здесь соблазнительнее всего, и именно
 * это первым делом раздражает на сайтах-презентациях.
 */
const DECK_JS = `
var slides = [].slice.call(document.querySelectorAll('.hero, .stats, section, blockquote, .sources'));
var dots = document.getElementById('dots');
if (dots) {
  slides.forEach(function () { dots.appendChild(document.createElement('i')); });
}
var marks = dots ? [].slice.call(dots.children) : [];
var cur = 0;

function sync() {
  var best = 0, bd = Infinity;
  slides.forEach(function (s, i) {
    var d = Math.abs(s.getBoundingClientRect().top);
    if (d < bd) { bd = d; best = i; }
  });
  cur = best;
  marks.forEach(function (m, i) { m.classList.toggle('on', i === cur); });
}
window.addEventListener('scroll', sync, { passive: true });
window.addEventListener('resize', sync);
sync();

document.addEventListener('keydown', function (e) {
  var fwd = e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ';
  var back = e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp';
  if (!fwd && !back) return;
  e.preventDefault();
  var next = fwd ? Math.min(cur + 1, slides.length - 1) : Math.max(cur - 1, 0);
  if (next !== cur) slides[next].scrollIntoView({ behavior: 'smooth' });
});
`;

export const STYLE_SCRIPTS = {
  izdanie: '',
  panel: PANEL_JS,
  ekran: EKRAN_JS,
  deck: DECK_JS,
} as const;
