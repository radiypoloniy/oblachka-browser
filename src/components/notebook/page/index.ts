import type { PageSpec } from '../../../../shared/docMarkup';
import { STYLE_CSS, PAGE_STYLES, type PageStyle } from './styles';

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

function esc(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const FONTS = 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,900'
  + '&family=Golos+Text:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500'
  + '&family=Unbounded:wght@600;700;800&display=swap';

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
<div class="body">
${page.html}
</div>
${sources}
</div></body></html>`;
}
