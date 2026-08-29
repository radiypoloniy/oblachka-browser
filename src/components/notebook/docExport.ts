import type { DocBlock, DocSpec } from '../../../shared/notebookDoc';

// Выгрузка документа одним самодостаточным .html.
//
// ⚠️ Стили ИНЛАЙНОМ и цвета ЧИСЛАМИ, а не токенами. Файл уезжает человеку, у которого нашего
// браузера нет: var(--section-tone) там не значит ничего, и документ приехал бы чёрным текстом
// на прозрачном фоне. По той же причине здесь одна светлая тема, а не палитры браузера — это
// документ, а не экран приложения.
//
// ⚠️ Тон — тот же чай, что у раздела AI (--poster-tea): выгруженный документ обязан быть узнаваем
// как «сделано в Oblako», иначе фирменность заканчивается ровно на границе окна.
const TEA = '#1F5E52';
const INK = '#24252E';
const BODY = '#3D3F4E';
const FAINT = '#6D7492';
const PAPER = '#FFFFFF';
const SUNKEN = '#F2F3F6';
const LINE = 'rgba(60,60,67,0.14)';

/** Экранирование: заголовки и текст пришли от модели по материалам чужих страниц. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function blockHtml(b: DocBlock): string {
  switch (b.kind) {
    case 'cover':
      return `<header class="cover"><h1>${esc(b.title ?? '')}</h1>`
        + (b.text ? `<p>${esc(b.text)}</p>` : '') + '</header>';
    case 'heading':
      return `<h2>${esc(b.title ?? '')}</h2>`;
    case 'text':
      return `<p>${esc(b.text ?? '')}</p>`;
    case 'quote':
      return `<blockquote>${esc(b.text ?? '')}</blockquote>`;
    case 'list':
      return '<ul>' + (b.items ?? []).map((i) => `<li>${esc(i)}</li>`).join('') + '</ul>';
    case 'metrics':
      return '<div class="mets">' + (b.pairs ?? []).map((p) =>
        `<div class="met"><b>${esc(p.value)}</b><span>${esc(p.label)}</span></div>`).join('') + '</div>';
    case 'table':
    case 'compare':
      return '<table>' + (b.pairs ?? []).map((p) =>
        `<tr><td class="k">${esc(p.label)}</td><td>${esc(p.value)}</td></tr>`).join('') + '</table>';
    case 'sources':
      return `<div class="src"><h3>${esc(b.title || 'Источники')}</h3>`
        + (b.pairs ?? []).map((p) => `<div>${esc(p.label)}${p.value ? ` · <span>${esc(p.value)}</span>` : ''}</div>`).join('')
        + '</div>';
  }
}

export function docToHtml(spec: DocSpec): string {
  const body = spec.blocks.map(blockHtml).join('\n');
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(spec.title)}</title>
<style>
:root{color-scheme:light}
*{box-sizing:border-box}
body{margin:0;background:${SUNKEN};color:${BODY};
  font:16px/1.55 "Golos Text","Segoe UI",system-ui,-apple-system,sans-serif;
  -webkit-font-smoothing:antialiased}
main{max-width:720px;margin:0 auto;padding:40px 24px 80px;background:${PAPER};min-height:100vh}
.cover{background:${TEA};color:#F2EDE1;border-radius:12px;padding:22px 24px;margin-bottom:24px}
.cover h1{margin:0;font-size:26px;font-weight:700;letter-spacing:-.03em;line-height:1.15}
.cover p{margin:6px 0 0;font-size:12.5px;opacity:.8}
h2{font-size:16px;font-weight:600;color:${INK};margin:26px 0 8px;letter-spacing:-.01em}
p{margin:0 0 14px}
blockquote{margin:0 0 16px;padding-left:14px;border-left:3px solid ${TEA};
  font-weight:600;color:${INK}}
ul{margin:0 0 16px;padding-left:20px}
li{margin-bottom:6px}
.mets{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin-bottom:18px}
.met{background:${SUNKEN};border-radius:12px;padding:12px}
.met b{display:block;font-size:22px;font-weight:700;color:${TEA};letter-spacing:-.02em;
  font-variant-numeric:tabular-nums}
.met span{display:block;font-size:12.5px;color:${FAINT};margin-top:2px}
table{width:100%;border-collapse:collapse;margin:0 0 18px;border:1px solid ${LINE};border-radius:12px;overflow:hidden}
td{padding:10px 14px;border-bottom:1px solid ${LINE};vertical-align:top;font-size:14px}
tr:last-child td{border-bottom:none}
td.k{color:${FAINT};width:38%}
.src{margin-top:28px;padding-top:18px;border-top:1px solid ${LINE};font-size:12.5px;color:${FAINT}}
.src h3{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${FAINT};
  font-weight:500;margin:0 0 8px;font-family:ui-monospace,Consolas,monospace}
.src div{margin-bottom:4px}
.src span{font-family:ui-monospace,Consolas,monospace}
@media print{body{background:${PAPER}}main{padding:0}}
</style></head>
<body><main>
${body}
</main></body></html>`;
}
