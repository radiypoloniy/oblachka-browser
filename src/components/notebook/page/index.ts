import { splitSections, type PageSpec } from '../../../../shared/docMarkup';
import { STYLE_CSS, STYLE_JS, PAGE_STYLES, type PageStyle } from './styles';

export { PAGE_STYLES, type PageStyle };
export type { PageSpec };

// Сборка готовой страницы: наша обвязка вокруг разметки, которую написала модель.
//
// ⚠️ Разметка от модели вставляется как есть — она УЖЕ прошла очистку в main
// (shared/docMarkup.ts): собрана заново по белому списку, без единого атрибута. Чистить её
// второй раз здесь было бы не «вторым рубежом», а вторым местом, где правило может разойтись
// с первым.
//
// ⚠️ Всё, что вокруг (название, числа, источники), рисуем МЫ и экранируем сами: это не разметка
// модели, это наши данные, и путь у них другой.
//
// ⚠️ Скрипт стиля кладётся ПОСЛЕДНИМ и приходит из STYLE_JS — не от модели. Её `<script>`
// санитайзер выбрасывает вместе с содержимым, и это правило не меняется: живой здесь только
// наш код. Закрывающий тег экранирован обратным слешем, иначе он оборвал бы наш собственный
// блок прямо при сборке строки.

function esc(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const FONTS = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,900'
  + '&family=Golos+Text:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500'
  + '&family=Unbounded:wght@600;700;800&family=Instrument+Serif:ital@0;1&display=swap';

/**
 * Тело страницы под конкретный стиль.
 *
 * ⚠️ Разметка от модели ОДНА и не меняется — меняется обвязка вокруг неё. «Пульт» строит из
 * разделов вкладки, «Экран» — титры, номера и врезку во весь экран, «Издание» берёт разделы
 * как есть.
 * Заголовки для навигации достаются разбором собственной разметки (splitSections), а не вторым
 * вопросом к модели: второй источник правды однажды разошёлся бы с первым.
 */
function bodyFor(page: PageSpec, style: PageStyle): string {
  if (style === 'panel') {
    const secs = splitSections(page.html);
    // Разделов нет (модель прислала сплошной текст) — вкладкам не из чего браться.
    if (secs.length === 0) return `<div class="body">${page.html}</div>`;
    const nav = secs.map((s, i) =>
      `<button class="nav${i === 0 ? ' on' : ''}" data-i="${i}">`
      + `<span class="k">${String(i + 1).padStart(2, '0')}</span>${esc(stripTags(s.title))}</button>`).join('');
    // ⚠️ Абзацы заворачиваются в раскрывающиеся карточки ЗДЕСЬ, а не в разметке модели: она
    // отдаёт <p>, и знать про наши карточки ей незачем.
    const panes = secs.map((s, i) => {
      let n = 0;
      const inner = s.html.replace(/<p>([\s\S]*?)<\/p>/g, (_m, text: string) => {
        n += 1;
        return `<article class="cardx${n === 1 ? ' open' : ''}">`
          + `<button class="chead"><span>Абзац ${n}</span><i></i></button>`
          + `<div class="cbody"><p>${text}</p></div></article>`;
      });
      return `<section class="pane${i === 0 ? ' on' : ''}" data-i="${i}">${inner}</section>`;
    }).join('');
    // Одна кнопка на весь раздел: раскрыть все абзацы или свернуть до сводки.
    const all = '<button class="nav toggle" id="toggle-all">Развернуть всё</button>';
    return `<nav class="navrow">${nav}${all}</nav><div class="body">${panes}</div>`;
  }

  if (style === 'ekran') {
    // ⚠️ Врезка ВЫНИМАЕТСЯ из раздела и ставится сразу за ним. Внутри раздела она не может
    // растянуться во всю ширину: у раздела свои поля, а врезка здесь держит паузу на весь
    // экран. Модели про это знать незачем — она отдаёт blockquote там, где он по смыслу.
    let n = 0;
    const body = splitSections(page.html).map((sec) => {
      n += 1;
      const quotes: string[] = [];
      const inner = sec.html.replace(/<blockquote>([\s\S]*?)<\/blockquote>/g, (_m, q: string) => {
        quotes.push(`<blockquote class="rise"><p>${q}</p></blockquote>`);
        return '';
      });
      // Появление вешаем на заголовок и абзацы: они и отбивают границу раздела.
      const risen = inner
        .replace(/<h2>/g, '<h2 class="rise">')
        .replace(/<p>/g, '<p class="rise">');
      return `<section><span class="no">${String(n).padStart(2, '0')}</span>${risen}</section>`
        + quotes.join('');
    }).join('');
    return `<div class="body">${body || page.html}</div>`
      + '<button id="ring" title="Наверх" aria-label="Наверх">'
      + '<svg width="52" height="52" aria-hidden="true">'
      + '<circle class="bg" cx="26" cy="26" r="23"></circle>'
      + '<circle class="fg" cx="26" cy="26" r="23" stroke-dasharray="144.5" stroke-dashoffset="144.5"></circle>'
      + '</svg><i>&#8593;</i></button>';
  }

  return `<div class="body">${page.html}</div>`;
}

/**
 * Шапка страницы под стиль.
 *
 * ⚠️ У «Экрана» она занимает первый экран целиком — это титры, а не строка с названием. Поэтому
 * шапка тоже принадлежит стилю, а не общей оболочке: у двух других она остаётся прежней.
 */
function headerFor(page: PageSpec, style: PageStyle, meta: string): string {
  if (style === 'ekran') {
    return '<header class="hero">'
      + `<div class="meta">${esc(meta)}</div>`
      + `<h1 class="title">${esc(page.title)}</h1>`
      + (page.lede ? `<p class="lede">${esc(page.lede)}</p>` : '')
      + '<div class="down">&#8595; листайте</div></header>';
  }
  return `<div class="meta">${esc(meta)}</div>`
    + `<h1 class="title">${esc(page.title)}</h1>`
    + (page.lede ? `<p class="lede">${esc(page.lede)}</p>` : '');
}

/** Заголовок раздела приходит уже разметкой — для кнопки нужен голый текст. */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

export function pageToHtml(page: PageSpec, style: PageStyle): string {
  const meta = `${new Date().toLocaleDateString('ru-RU')} · собрано в Oblako`;
  const stats = page.stats.length
    ? '<div class="stats">' + page.stats.map((s) =>
      `<div><b>${esc(s.value)}</b><span>${esc(s.label)}</span></div>`).join('') + '</div>'
    : '';
  const sources = page.sources.length
    ? '<footer class="sources"><h2>Источники</h2>' + page.sources.map((s) =>
      `<div>${esc(s.title)}<em class="src">${esc(s.url)}</em></div>`).join('') + '</footer>'
    : '';

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<style>${STYLE_CSS[style]}</style></head>
<body><div class="page">
${headerFor(page, style, meta)}
${stats}
${bodyFor(page, style)}
${sources}
</div>
${STYLE_JS[style] ? `<script>${STYLE_JS[style]}<\/script>` : ''}
</body></html>`;
}
