import type { DocBlock, DocSpec } from '../../../../shared/notebookDoc';
import { C, esc } from './shell';

// Шаблон «Отчёт»: одна колонка, оглавление, источники в подвале.
//
// ⚠️ Это шаблон ПО УМОЛЧАНИЮ, и выбран он не по красоте, а по надёжности: единственный из трёх,
// который не подводит ни на какой длине и ни на каком наполнении. Нет чисел — просто нет блока;
// нет разделов — просто нет оглавления; печатается на A4 без сюрпризов.

export const CSS = `
/* ⚠️ Ширина АДАПТИВНАЯ, а не 760 фиксом. Документ открывают целой вкладкой, и на широком
   экране узкая колонка посреди серого поля читается как недоделка. Но и растягивать абзац
   во всю ширину нельзя — строка длиннее ~75 знаков теряется на возврате. Поэтому широкой
   становится СТРАНИЦА (обложка, оглавление, числа, таблицы), а мера чтения остаётся у
   абзацев: min() у листа плюс max-width в ch у текста. */
.sheet{max-width:min(1080px,100%);box-shadow:0 1px 2px rgba(20,20,30,.06),0 12px 40px rgba(20,20,30,.07)}
.cover{background:${C.tea};color:${C.cream};padding:clamp(24px,4vw,38px) clamp(20px,4vw,40px)}
/* ⚠️ Класс .caps красит текст в ${C.faint} — серый по светлому. На тоновой подложке это и
   давало «текст сливается»: серое по тёмно-зелёному. Цвет наследуется от плашки. */
.cover .caps,.cover .k{color:inherit;opacity:.78}
.cover h1{font-size:clamp(24px,3.4vw,34px);font-weight:700;letter-spacing:-.03em;line-height:1.12;
  margin-top:10px;max-width:22ch}
.cover p{margin:12px 0 0;font-size:14px;opacity:.9;max-width:58ch;line-height:1.5}
/* Полоса фактов на обложке — та же роль, что у hero в шапке настроек: главное число сразу. */
.facts{display:flex;flex-wrap:wrap;gap:0 28px;margin-top:20px;padding-top:16px;
  border-top:1px solid rgba(242,237,225,.22)}
.facts div{display:flex;flex-direction:column;gap:3px}
.facts b{font-size:17px;font-weight:700;letter-spacing:-.02em;line-height:1}
.facts span{font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;opacity:.7;
  font-family:"JetBrains Mono",ui-monospace,monospace}
.toc{padding:18px clamp(20px,4vw,40px);background:${C.sunken};display:flex;flex-wrap:wrap;gap:7px}
.toc .k{width:100%;margin-bottom:4px}
/* Чипами, а не подчёркнутыми ссылками: подчёркивания в ряд читались серыми плашками. */
.toc a{font-size:12.5px;color:${C.body};text-decoration:none;background:${C.paper};
  border:1px solid ${C.line};border-radius:999px;padding:5px 12px;line-height:1}
.body{padding:clamp(26px,4vw,40px) clamp(20px,4vw,40px) 44px}
.body h2{font-size:17px;font-weight:600;color:${C.ink};margin:34px 0 10px;scroll-margin-top:12px;
  padding-top:14px;border-top:1px solid ${C.lineSoft}}
.body>h2:first-child{margin-top:0;padding-top:0;border-top:none}
/* Мера чтения — на ТЕКСТЕ, а не на странице: таблицы и числа занимают всю ширину. */
.body p{font-size:15px;line-height:1.65;max-width:72ch}
blockquote{margin:20px 0;padding:14px 0 14px 18px;border-left:3px solid ${C.tea};
  font-size:16px;font-weight:600;color:${C.ink};max-width:70ch;line-height:1.45}
ul{margin:0 0 18px;padding-left:22px;font-size:15px;line-height:1.6;max-width:70ch}
li{margin-bottom:8px}
.mets{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:0 0 22px}
.met{background:${C.sunken};border-radius:14px;padding:16px 17px}
.met b{display:block;font-size:26px;font-weight:700;color:${C.tea};letter-spacing:-.03em;line-height:1}
.met span{display:block;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:${C.faint};
  margin-top:8px;font-family:"JetBrains Mono",ui-monospace,monospace}
.tab{border:1px solid ${C.line};border-radius:14px;overflow:hidden;margin:0 0 22px}
.tab .r{display:grid;grid-template-columns:minmax(120px,28%) 1fr;gap:18px;padding:13px 16px;
  border-bottom:1px solid ${C.lineSoft};font-size:14px;line-height:1.5}
.tab .r:last-child{border-bottom:none}
.tab .r span:first-child{color:${C.faint}}
.src{margin-top:36px;padding-top:18px;border-top:1px solid ${C.line};font-size:13px;color:${C.faint}}
.src .r{margin-bottom:5px}
@media (max-width:620px){.tab .r{grid-template-columns:1fr;gap:4px}}
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
  // ⚠️ Факты на обложке — та же роль, что у крупного числа в шапке настроек: документ
  // сразу говорит свой размер. Считаем МЫ, у модели ничего не спрашиваем.
  const chars = spec.blocks.reduce((n, b) => n + (b.text?.length ?? 0) + (b.title?.length ?? 0), 0);
  const mins = Math.max(1, Math.round(chars / 1100));   // ~1100 знаков в минуту чтения
  const facts = [
    { v: String(heads.length), l: heads.length === 1 ? 'раздел' : 'разделов' },
    { v: chars.toLocaleString('ru-RU'), l: 'знаков' },
    { v: `${mins} мин`, l: 'чтения' },
  ];
  let out = `<header class="cover grain"><div><div class="caps k">${esc(meta)}</div>`
    + `<h1>${esc(cover?.title ?? spec.title)}</h1>`
    + (cover?.text ? `<p>${esc(cover.text)}</p>` : '')
    + '<div class="facts">'
    + facts.map((f) => `<div><b class="num">${esc(f.v)}</b><span>${esc(f.l)}</span></div>`).join('')
    + '</div></div></header>';
  // ⚠️ Оглавление строит ШАБЛОН, а не модель: заголовки разделов у неё уже есть, и просить
  // её собрать список второй раз — лишние токены и лишний способ разъехаться с документом.
  // Порог в три раздела: на двух оглавление длиннее пользы.
  if (heads.length > 2) {
    out += '<nav class="toc"><span class="caps k">В документе</span>'
      + heads.map((x) => `<a href="#h${x.i}">${esc(x.b.title)}</a>`).join('') + '</nav>';
  }
  return out + '<main class="body">' + spec.blocks.map(block).join('\n') + '</main>';
}
