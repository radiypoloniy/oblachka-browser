import type { DocSpec } from '../../../../shared/notebookDoc';
import { C, esc } from './shell';

// Шаблон «Конспект»: каждый блок — карточка, читается кусками и в любом порядке.
//
// ⚠️ Карточки сгруппированы ПО РАЗДЕЛАМ, а не свалены одной сеткой. На четырёх блоках разницы
// нет, на девятнадцати без группировки получается стена, в которой невозможно найти место, где
// ты остановился, — и шаблон перестаёт делать ровно то, ради чего он есть.
//
// ⚠️ Длинный абзац в карточке не живёт: это шаблон для короткой выжимки. Пилюля гаснет на
// длинных документах (см. index.ts, isTemplateFit) — не запрет, а честный отказ предлагать
// то, что развалится.

export const CSS = `
.sheet{max-width:900px}
.top{padding:26px 28px 0;display:flex;align-items:flex-end;gap:20px;flex-wrap:wrap}
.top h1{font-size:26px;font-weight:800;letter-spacing:-.035em;line-height:1.12;color:${C.ink};
  margin:6px 0 0;font-family:"Unbounded","Golos Text",system-ui,sans-serif}
.top .sd{font-size:13px;color:${C.faint};margin:8px 0 0;max-width:60ch}
.chip{font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:5px 11px;
  border-radius:999px;background:rgba(31,94,82,.12);color:${C.tea};white-space:nowrap;
  font-family:"JetBrains Mono",ui-monospace,monospace}
.sec{padding:22px 28px 0}
.sec .h{display:flex;align-items:center;gap:10px;margin-bottom:12px}
.sec .h::after{content:'';flex:1;height:1px;background:${C.line}}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(215px,1fr));gap:12px}
.card{border-radius:16px;padding:16px 17px;background:${C.sunken};display:flex;
  flex-direction:column;gap:7px;break-inside:avoid}
.card b{font-size:14px;font-weight:600;color:${C.ink};line-height:1.32}
.card p{font-size:12.5px;line-height:1.55;margin:0}
.card ul{margin:0;padding-left:16px}
.card li{font-size:12.5px;line-height:1.5;margin-bottom:5px}
.card .r{display:flex;gap:8px;font-size:12px;line-height:1.45;margin-bottom:5px}
.card .r span:first-child{color:${C.faint};min-width:78px;flex:none}
.wide{grid-column:1/-1}
.tone{background:${C.tea};color:${C.cream}}
.tone b,.tone p{color:inherit}
.tone .caps{color:inherit;opacity:.72}
.big b{font-size:30px;font-weight:800;letter-spacing:-.035em;line-height:1;color:${C.tea};
  font-family:"Unbounded","Golos Text",system-ui,sans-serif}
.quote{background:transparent;border:2px solid ${C.ink}}
.quote b{font-size:15px;font-weight:700;letter-spacing:-.02em;line-height:1.3;
  font-family:"Unbounded","Golos Text",system-ui,sans-serif}
.pad{padding-bottom:28px}
`;

export function body(spec: DocSpec, meta: string): string {
  const cover = spec.blocks.find((b) => b.kind === 'cover');
  const chip = spec.blocks.find((b) => b.kind === 'metrics')?.pairs?.[0];

  let out = '<header class="top"><div style="flex:1;min-width:240px">'
    + `<div class="caps">${esc(meta)}</div><h1>${esc(cover?.title ?? spec.title)}</h1>`
    + (cover?.text ? `<div class="sd">${esc(cover.text)}</div>` : '') + '</div>'
    + (chip ? `<span class="chip">${esc(chip.value)} ${esc(chip.label)}</span>` : '') + '</header>';

  // Группы: заголовок раздела открывает новую, всё до первого заголовка идёт в «Начало».
  const groups: { head: string; cards: typeof spec.blocks }[] = [];
  let cur: { head: string; cards: typeof spec.blocks } = { head: 'Начало', cards: [] };
  for (const b of spec.blocks) {
    if (b.kind === 'cover') continue;
    if (b.kind === 'heading') {
      if (cur.cards.length) groups.push(cur);
      cur = { head: b.title ?? 'Раздел', cards: [] };
      continue;
    }
    cur.cards.push(b);
  }
  if (cur.cards.length) groups.push(cur);

  groups.forEach((g, gi) => {
    out += `<section class="sec${gi === groups.length - 1 ? ' pad' : ''}">`
      + `<div class="h"><span class="caps">${esc(g.head)}</span></div><div class="grid">`;
    for (const b of g.cards) {
      switch (b.kind) {
        case 'text':
          out += `<div class="card"><span class="caps">Абзац</span><p>${esc(b.text)}</p></div>`;
          break;
        case 'quote':
          out += `<div class="card quote wide"><span class="caps">Запомнить</span><b>${esc(b.text)}</b></div>`;
          break;
        case 'list':
          out += `<div class="card"><span class="caps">${esc(b.title || 'Коротко')}</span><ul>`
            + (b.items ?? []).map((x) => `<li>${esc(x)}</li>`).join('') + '</ul></div>';
          break;
        case 'metrics':
          // Число — своей карточкой на каждое: рядом друг с другом они и читаются как сводка.
          for (const p of b.pairs ?? []) {
            out += `<div class="card big"><span class="caps">${esc(p.label)}</span><b class="num">${esc(p.value)}</b></div>`;
          }
          break;
        case 'table': case 'compare':
          out += `<div class="card wide"><span class="caps">${esc(b.title || 'Сравнение')}</span>`
            + (b.pairs ?? []).map((p) => `<div class="r"><span>${esc(p.label)}</span><span>${esc(p.value)}</span></div>`).join('')
            + '</div>';
          break;
        case 'sources':
          out += `<div class="card wide"><span class="caps">${esc(b.title || 'Источники')}</span>`
            + (b.pairs ?? []).map((p) => `<div class="r"><span>${esc(p.label)}</span><span class="mono">${esc(p.value)}</span></div>`).join('')
            + '</div>';
          break;
        default: break;
      }
    }
    out += '</div></section>';
  });
  return out;
}
