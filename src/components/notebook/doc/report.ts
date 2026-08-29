import type { DocBlock, DocSpec } from '../../../../shared/notebookDoc';
import { C, esc } from './shell';

// Шаблон «Отчёт»: одна колонка, оглавление, источники в подвале.
//
// ⚠️ Это шаблон ПО УМОЛЧАНИЮ, и выбран он не по красоте, а по надёжности: единственный из трёх,
// который не подводит ни на какой длине и ни на каком наполнении. Нет чисел — просто нет блока;
// нет разделов — просто нет оглавления; печатается на A4 без сюрпризов.

export const CSS = `
.sheet{max-width:760px}
.cover{background:${C.tea};color:${C.cream};padding:26px 30px}
.cover h1{font-size:27px;font-weight:700;letter-spacing:-.03em;line-height:1.14}
.cover .k{opacity:.72;margin-bottom:8px}
.cover p{margin:9px 0 0;font-size:13px;opacity:.82;max-width:54ch}
.toc{background:${C.sunken};padding:18px 30px;display:flex;flex-wrap:wrap;gap:6px 18px}
.toc .k{width:100%;margin-bottom:2px}
.toc a{font-size:13px;color:${C.body};text-decoration:none;border-bottom:1px solid ${C.line}}
.body{padding:28px 30px 36px}
.body h2{font-size:16px;font-weight:600;color:${C.ink};margin:26px 0 8px;scroll-margin-top:12px}
.body>h2:first-child{margin-top:0}
.body p{font-size:14.5px;line-height:1.62}
blockquote{margin:18px 0;padding:3px 0 3px 15px;border-left:3px solid ${C.tea};
  font-size:15px;font-weight:600;color:${C.ink}}
ul{margin:0 0 16px;padding-left:20px;font-size:14.5px;line-height:1.6}
li{margin-bottom:7px}
.mets{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin:0 0 18px}
.met{background:${C.sunken};border-radius:12px;padding:13px 14px}
.met b{display:block;font-size:22px;font-weight:700;color:${C.tea};letter-spacing:-.03em;line-height:1}
.met span{display:block;font-size:11px;color:${C.faint};margin-top:6px}
.tab{border:1px solid ${C.line};border-radius:12px;overflow:hidden;margin:0 0 18px}
.tab .r{display:grid;grid-template-columns:34% 1fr;gap:14px;padding:11px 14px;
  border-bottom:1px solid ${C.lineSoft};font-size:13.5px;line-height:1.5}
.tab .r:last-child{border-bottom:none}
.tab .r span:first-child{color:${C.faint}}
.src{margin-top:28px;padding-top:16px;border-top:1px solid ${C.line};font-size:12.5px;color:${C.faint}}
.src .r{margin-bottom:4px}
`;

function block(b: DocBlock, i: number): string {
  switch (b.kind) {
    case 'cover': return '';           // обложку рисует body() отдельно, до оглавления
    case 'heading': return `<h2 id="h${i}">${esc(b.title)}</h2>`;
    case 'text': return `<p>${esc(b.text)}</p>`;
    case 'quote': return `<blockquote>${esc(b.text)}</blockquote>`;
    case 'list':
      return '<ul>' + (b.items ?? []).map((x) => `<li>${esc(x)}</li>`).join('') + '</ul>';
    case 'metrics':
      return '<div class="mets">' + (b.pairs ?? []).map((p) =>
        `<div class="met"><b class="num">${esc(p.value)}</b><span>${esc(p.label)}</span></div>`).join('') + '</div>';
    case 'table':
    case 'compare':
      return '<div class="tab">' + (b.pairs ?? []).map((p) =>
        `<div class="r"><span>${esc(p.label)}</span><span>${esc(p.value)}</span></div>`).join('') + '</div>';
    case 'sources':
      return `<div class="src"><div class="caps">${esc(b.title || 'Источники')}</div>`
        + (b.pairs ?? []).map((p) => `<div class="r">${esc(p.label)}${p.value ? ` · <span class="mono">${esc(p.value)}</span>` : ''}</div>`).join('')
        + '</div>';
  }
}

export function body(spec: DocSpec, meta: string): string {
  const cover = spec.blocks.find((b) => b.kind === 'cover');
  const heads = spec.blocks.map((b, i) => ({ b, i })).filter((x) => x.b.kind === 'heading');
  let out = `<header class="cover grain"><div><div class="caps k">${esc(meta)}</div>`
    + `<h1>${esc(cover?.title ?? spec.title)}</h1>`
    + (cover?.text ? `<p>${esc(cover.text)}</p>` : '') + '</div></header>';
  // ⚠️ Оглавление строит ШАБЛОН, а не модель: заголовки разделов у неё уже есть, и просить
  // её собрать список второй раз — лишние токены и лишний способ разъехаться с документом.
  // Порог в три раздела: на двух оглавление длиннее пользы.
  if (heads.length > 2) {
    out += '<nav class="toc"><span class="caps k">В документе</span>'
      + heads.map((x) => `<a href="#h${x.i}">${esc(x.b.title)}</a>`).join('') + '</nav>';
  }
  return out + '<main class="body">' + spec.blocks.map(block).join('\n') + '</main>';
}
