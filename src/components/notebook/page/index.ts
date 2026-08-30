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
  + '&family=Unbounded:wght@600;700;800&display=swap';

/**
 * Тело страницы под конкретный стиль.
 *
 * ⚠️ Разметка от модели ОДНА и не меняется — меняется обвязка вокруг неё. «Пульт» строит из
 * разделов вкладки, «Лонгрид» — оглавление и полосу чтения, «Издание» берёт разделы как есть.
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
    return `<nav class="navrow">${nav}</nav><div class="body">${panes}</div>`;
  }

  if (style === 'polosa') {
    const secs = splitSections(page.html);
    const toc = secs.length > 1
      ? '<nav class="toc">' + secs.map((s, i) =>
        `<a href="#s${i}"><span>${String(i + 1).padStart(2, '0')}</span>${esc(stripTags(s.title))}</a>`).join('')
        + '</nav>'
      : '';
    // Разделам нужны якоря — оглавление ведёт по ним.
    let k = -1;
    const body = page.html.replace(/<section>/g, () => { k += 1; return `<section id="s${k}">`; });
    return `<div id="read-bar"></div>${toc}<div class="body">${body}</div>`
      + '<button id="to-top" title="Наверх" aria-label="Наверх">&#8593;</button>';
  }

  return `<div class="body">${page.html}</div>`;
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
<div class="meta">${esc(meta)}</div>
<h1 class="title">${esc(page.title)}</h1>
${page.lede ? `<p class="lede">${esc(page.lede)}</p>` : ''}
${stats}
${bodyFor(page, style)}
${sources}
</div>
${STYLE_JS[style] ? `<script>${STYLE_JS[style]}<\/script>` : ''}
</body></html>`;
}
