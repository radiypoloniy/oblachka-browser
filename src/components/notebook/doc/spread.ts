import type { DocBlock, DocSpec } from '../../../../shared/notebookDoc';
import { C, esc } from './shell';

// Шаблон «Разворот»: журнальный. Тёмная обложка с крупным числом, плакатная полоса цифр во всю
// ширину, две колонки, буквица, выноски и источники на поле.
//
// ⚠️ Требует НАПОЛНЕНИЯ, и это его настоящая цена: без блока metrics полоса цифр пустая, без
// list поле голое. Поэтому пилюля шаблона гаснет, когда в документе нет чисел (см. index.ts,
// isTemplateFit) — предлагать шаблон, который развалится на этом материале, хуже, чем его
// не показывать.

export const CSS = `
.sheet{max-width:min(1180px,100%);box-shadow:0 1px 2px rgba(20,20,30,.06),0 12px 40px rgba(20,20,30,.07)}
.cover{background:${C.night};color:${C.cream};padding:clamp(30px,4vw,46px) clamp(20px,4vw,40px)}
/* .caps красит серым — на тёмной обложке это нечитаемо (см. разбор в report.ts). */
.cover .caps,.cover .k,.cover .nol{color:inherit}
.cover .i{display:grid;grid-template-columns:1fr auto;gap:28px;align-items:end}
.cover .k{opacity:.6;letter-spacing:.16em}
.cover h1{font-size:38px;font-weight:800;letter-spacing:-.045em;margin:10px 0 0;
  line-height:1;max-width:16ch;font-family:"Unbounded","Golos Text",system-ui,sans-serif}
.cover .sd{font-size:13.5px;opacity:.72;margin:12px 0 0;max-width:50ch}
.cover .no{font-size:70px;line-height:.82;letter-spacing:-.05em;color:${C.tangerine};
  text-align:right;font-weight:800;font-family:"Unbounded","Golos Text",system-ui,sans-serif}
.cover .nol{opacity:.6;text-align:right;margin-top:6px;letter-spacing:.14em}
.strip{display:flex;flex-wrap:wrap;background:${C.tangerine};color:#14140F}
.strip .c{flex:1;min-width:130px;padding:15px 18px;border-right:1px solid rgba(20,20,15,.16)}
.strip .c:last-child{border-right:none}
.strip b{display:block;font-size:21px;font-weight:800;letter-spacing:-.03em;line-height:1;
  font-family:"Unbounded","Golos Text",system-ui,sans-serif}
.strip span{display:block;font-size:9px;letter-spacing:.12em;text-transform:uppercase;
  opacity:.74;margin-top:6px;font-family:"JetBrains Mono",ui-monospace,monospace}
.body{padding:clamp(26px,4vw,40px) clamp(20px,4vw,40px) 44px;display:grid;
  grid-template-columns:minmax(0,1fr) minmax(190px,240px);gap:clamp(24px,3vw,40px)}
.main h2{font-size:18px;font-weight:700;letter-spacing:-.025em;color:${C.ink};margin:26px 0 9px;
  font-family:"Unbounded","Golos Text",system-ui,sans-serif}
.main>h2:first-child{margin-top:0}
.main p{font-size:15px;line-height:1.68;max-width:70ch}
.main p.drop::first-letter{font-size:46px;float:left;line-height:.85;padding:4px 10px 0 0;
  color:${C.tea};font-weight:800;font-family:"Unbounded","Golos Text",system-ui,sans-serif}
blockquote{margin:24px 0;padding:20px 0;border-top:2px solid ${C.ink};border-bottom:2px solid ${C.ink};
  font-size:19px;font-weight:700;letter-spacing:-.02em;line-height:1.3;color:${C.ink};
  font-family:"Unbounded","Golos Text",system-ui,sans-serif}
.tab{margin:4px 0 18px;border-top:1px solid ${C.line}}
.tab .r{display:grid;grid-template-columns:32% 1fr;gap:16px;padding:11px 0;
  border-bottom:1px solid ${C.lineSoft};font-size:13.5px;line-height:1.5}
.tab .r span:first-child{color:${C.faint}}
.side{border-left:1px solid ${C.line};padding-left:22px}
.side .blk{margin-bottom:24px}
.side .k{margin-bottom:10px}
.side ul{margin:0;padding:0}
.side li{font-size:12.5px;line-height:1.5;margin-bottom:9px;list-style:none;padding-left:13px;position:relative}
.side li::before{content:'';position:absolute;left:0;top:7px;width:5px;height:5px;border-radius:50%;background:${C.tea}}
.side .sd{font-size:12px;color:${C.faint};margin-bottom:6px;line-height:1.45}
.side .sd em{font-style:normal;display:block;opacity:.8;margin-top:1px;
  font-family:"JetBrains Mono",ui-monospace,monospace}
@media print,(max-width:760px){.body{grid-template-columns:1fr}
  .side{border-left:none;border-top:1px solid ${C.line};padding-left:0;padding-top:20px}}
`;

function mainBlock(b: DocBlock, firstText: boolean): string {
  switch (b.kind) {
    case 'cover': case 'metrics': case 'list': case 'sources': return '';
    case 'heading': return `<h2>${esc(b.title)}</h2>`;
    // Буквица только у ПЕРВОГО абзаца: на каждом она превращается из приёма в узор.
    case 'text': return `<p${firstText ? ' class="drop"' : ''}>${esc(b.text)}</p>`;
    case 'quote': return `<blockquote>${esc(b.text)}</blockquote>`;
    case 'table': case 'compare':
      return '<div class="tab">' + (b.pairs ?? []).map((p) =>
        `<div class="r"><span>${esc(p.label)}</span><span>${esc(p.value)}</span></div>`).join('') + '</div>';
  }
}

export function body(spec: DocSpec, meta: string): string {
  const cover = spec.blocks.find((b) => b.kind === 'cover');
  const mets = spec.blocks.filter((b) => b.kind === 'metrics');
  // Герой обложки — ВТОРОЕ число, если оно есть: первым модель почти всегда ставит счётчик
  // источников, а он про нашу кухню, а не про тему документа.
  const hero = mets[0]?.pairs?.[1] ?? mets[0]?.pairs?.[0];

  let out = `<header class="cover grain"><div class="i"><div>`
    + `<div class="caps k">${esc(meta)}</div><h1>${esc(cover?.title ?? spec.title)}</h1>`
    + (cover?.text ? `<div class="sd">${esc(cover.text)}</div>` : '') + '</div>'
    + (hero ? `<div><div class="no num">${esc(hero.value)}</div><div class="caps nol">${esc(hero.label)}</div></div>` : '<div></div>')
    + '</div></header>';

  if (mets[0]?.pairs?.length) {
    out += '<div class="strip">' + mets[0].pairs.map((p) =>
      `<div class="c"><b class="num">${esc(p.value)}</b><span>${esc(p.label)}</span></div>`).join('') + '</div>';
  }

  let seenText = false;
  const main = spec.blocks.map((b) => {
    const first = b.kind === 'text' && !seenText;
    if (b.kind === 'text') seenText = true;
    return mainBlock(b, first);
  }).join('\n');

  // ⚠️ Списки и источники уходят НА ПОЛЕ, а не в основную колонку: на пяти тысячах знаков
  // сплошной текст читается тяжело, и выноски сбоку — единственное, что даёт глазу опору,
  // не разрывая изложение.
  let side = '';
  for (const b of spec.blocks) {
    if (b.kind === 'list') {
      side += `<div class="blk"><div class="caps k">${esc(b.title || 'Коротко')}</div><ul>`
        + (b.items ?? []).map((x) => `<li>${esc(x)}</li>`).join('') + '</ul></div>';
    } else if (b.kind === 'sources') {
      side += `<div class="blk"><div class="caps k">${esc(b.title || 'Источники')}</div>`
        + (b.pairs ?? []).map((p) => `<div class="sd">${esc(p.label)}<em>${esc(p.value)}</em></div>`).join('') + '</div>';
    }
  }
  return out + `<div class="body"><main class="main">${main}</main><aside class="side">${side}</aside></div>`;
}
