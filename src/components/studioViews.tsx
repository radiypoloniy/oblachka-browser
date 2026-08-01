import { useEffect, useRef, useState } from 'react';
import { Transformer } from 'markmap-lib';
import { Markmap } from 'markmap-view';
import { ListChecks, X } from 'lucide-react';

// Детерминированные рендереры материалов «Студии». Модель отдаёт ТОЛЬКО структуру/текст,
// картинку рисуют эти либы локально — принцип не менялся с блокнота.
//
// Вынесены сюда из Notebook.tsx, потому что их рисуют уже двое: модалка блокнота и узлы-
// артефакты граф-воркспейса (src/components/graph/GraphNodeCard.tsx). Высота параметром:
// в модалке она вьюпортная, в карточке узла — во всю доступную высоту карточки.

const MODAL_MINDMAP_HEIGHT = 'min(70vh, 560px)';
const MODAL_INFOGRAPHIC_HEIGHT = 'min(72vh, 580px)';

// Майндкарта: markdown-аутлайн модели → дерево (markmap-lib) → интерактивный SVG (markmap-view).
export function MindmapView({ markdown, height }: { markdown: string; height?: string }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !markdown.trim()) return;
    const { root } = new Transformer().transform(markdown);
    const mm = Markmap.create(svg, { duration: 200, spacingVertical: 8 }, root);
    // fit после отрисовки — иначе дерево может выйти за пределы вьюпорта SVG.
    void mm.fit();
    return () => mm.destroy();
  }, [markdown]);
  return <svg ref={svgRef} style={{ width: '100%', height: height ?? MODAL_MINDMAP_HEIGHT, display: 'block' }} />;
}

// Инфографика: JSON от модели (уже провалидирован normalizeInfographic в main) → своя вёрстка.
//
// Раньше рисовал движок @antv/infographic по декларативному синтаксису, и вёрстка ломалась
// об него постоянно: у шаблонов фиксированная ширина полей, длинное значение наезжало на
// описание, а заголовок — сам на себя. Промптом это не лечилось, только ужиманием текста до
// четырёх символов. Своя раскладка потоковая: наезжать нечему, длинный текст переносится,
// всё живёт на токенах темы и работает в тёмной так же, как в светлой.
interface InfographicItem { label: string; value: string; desc: string }
interface CompareItem { name: string; specs: Record<string, string> }

// Направление «лучше» знаем только для очевидных параметров. Для всего остального лидера НЕ
// помечаем: у «Экран 6.9 дюймов» больше — не обязательно лучше, и врать подсветкой хуже,
// чем не подсвечивать вовсе.
const LOWER_IS_BETTER = /цена|стоимость|price|вес|масса|weight/i;
const HIGHER_IS_BETTER = /[ёе]мкост|аккумул|батаре|battery|память|memory|ram|частот|герц|hz|разрешен|мегапиксел|камер|рейтинг|скорост|мощност/i;

// Число из «71 391 ₽», «6,9 дюйма», «5160 мАч». Пробелы-разделители тысяч убираем, запятую
// приводим к точке. Значения с «/» («12/512 ГБ») — это две величины сразу, их не сравниваем.
function numericValue(raw: string): number | null {
  if (!raw || raw.includes('/')) return null;
  const m = raw.replace(/(\d)[\s ](?=\d{3}\b)/g, '$1').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

// Сравнение: строки — параметры, столбцы — товары. Лидера в строке считает КОД, а не модель:
// именно на ранжировании локальная 9B путалась и называла лидером сразу двоих.
function CompareView({ title, items, height }: { title: string; items: CompareItem[]; height?: string }) {
  // Порядок параметров — по первому появлению: так таблица идёт в логике источника.
  const params: string[] = [];
  for (const it of items) for (const k of Object.keys(it.specs)) if (!params.includes(k)) params.push(k);

  // Для каждой строки — индексы победителей (может не быть вовсе).
  const winners = new Map<string, Set<number>>();
  for (const p of params) {
    const lower = LOWER_IS_BETTER.test(p);
    if (!lower && !HIGHER_IS_BETTER.test(p)) continue;
    const nums = items.map((it) => numericValue(it.specs[p] ?? ''));
    if (nums.some((n) => n === null)) continue;   // хоть одно не разобрали — не сравниваем
    const vals = nums as number[];
    const best = lower ? Math.min(...vals) : Math.max(...vals);
    if (vals.every((v) => v === best)) continue;  // все равны — лидера нет
    winners.set(p, new Set(vals.map((v, i) => (v === best ? i : -1)).filter((i) => i >= 0)));
  }

  const cell: React.CSSProperties = {
    padding: '8px 12px', textAlign: 'left', verticalAlign: 'top',
    fontSize: 'var(--fs-sm)', lineHeight: 'var(--lh-body)',
    borderTop: '1px solid var(--divider)',
  };

  return (
    <div style={{ width: '100%', height: height ?? MODAL_INFOGRAPHIC_HEIGHT, overflow: 'auto', padding: '4px 2px' }}>
      {title && (
        <div
          style={{
            fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-semibold)', marginBottom: 12,
            lineHeight: 'var(--lh-snug)', letterSpacing: 'var(--ls-tight)',
            color: 'var(--text-strong)', textWrap: 'balance',
          }}
        >
          {title}
        </div>
      )}
      <table
        style={{
          borderCollapse: 'collapse', width: '100%', minWidth: 120 + items.length * 150,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        <thead>
          <tr>
            <th style={{ ...cell, borderTop: 'none', color: 'var(--text-muted)', fontWeight: 'var(--fw-medium)' }} />
            {items.map((it, i) => (
              <th
                key={i}
                style={{ ...cell, borderTop: 'none', color: 'var(--text-strong)', fontWeight: 'var(--fw-semibold)' }}
              >
                {it.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {params.map((p) => {
            const win = winners.get(p);
            return (
              <tr key={p}>
                <td style={{ ...cell, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{p}</td>
                {items.map((it, i) => {
                  const best = !!win?.has(i);
                  return (
                    <td
                      key={i}
                      style={{
                        ...cell,
                        color: best ? 'var(--accent)' : 'var(--text-strong)',
                        fontWeight: best ? 'var(--fw-semibold)' : 'var(--fw-regular)',
                      }}
                    >
                      {it.specs[p] || '—'}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function InfographicView({ syntax, height }: { syntax: string; height?: string }) {
  const parsed = (() => {
    try { return JSON.parse(syntax) as { title?: string; items?: unknown }; } catch { return null; }
  })();
  const rawItems = Array.isArray(parsed?.items) ? (parsed!.items as unknown[]) : [];

  // Форму выбирает содержимое: со specs пришло сравнение нескольких источников, без них —
  // обычная карточная сводка по одному.
  const compare = rawItems.filter((i): i is CompareItem => {
    const o = i as CompareItem;
    return !!o && typeof o.name === 'string' && !!o.specs && typeof o.specs === 'object';
  });
  if (compare.length >= 2 && compare.length === rawItems.length) {
    return <CompareView title={parsed?.title ?? ''} items={compare} height={height} />;
  }

  const data = { title: parsed?.title ?? '', items: rawItems as InfographicItem[] };

  if (!data.items.length) {
    return <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>Инфографика пуста.</div>;
  }

  return (
    <div
      style={{
        width: '100%', height: height ?? MODAL_INFOGRAPHIC_HEIGHT,
        overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16,
        padding: '4px 2px',
      }}
    >
      {data.title && (
        <div
          style={{
            fontSize: 'var(--fs-xl)', fontWeight: 'var(--fw-semibold)',
            lineHeight: 'var(--lh-snug)', letterSpacing: 'var(--ls-tight)',
            color: 'var(--text-strong)', textWrap: 'balance',
          }}
        >
          {data.title}
        </div>
      )}

      {/* auto-fit: карточки сами раскладываются в 1–3 колонки по ширине узла или модалки,
          поэтому одна и та же инфографика читается и в маленьком узле, и на весь экран. */}
      <div
        style={{
          display: 'grid', gap: 10,
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        }}
      >
        {data.items.map((item, i) => (
          <div
            key={i}
            style={{
              display: 'flex', flexDirection: 'column', gap: 4,
              padding: '12px 14px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--surface)',
              border: '1px solid var(--divider)',
              // Полоска слева — единственная декорация; акцент один на всю систему.
              borderLeft: '3px solid var(--accent)',
            }}
          >
            {item.value && (
              <div
                style={{
                  fontSize: 'var(--fs-2xl)', fontWeight: 'var(--fw-semibold)',
                  lineHeight: 1.1, letterSpacing: 'var(--ls-tight)',
                  color: 'var(--accent)', overflowWrap: 'anywhere',
                }}
              >
                {item.value}
              </div>
            )}
            {item.label && (
              <div
                style={{
                  fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-semibold)',
                  color: 'var(--text-strong)', lineHeight: 'var(--lh-snug)',
                }}
              >
                {item.label}
              </div>
            )}
            {item.desc && (
              <div
                style={{
                  fontSize: 'var(--fs-sm)', color: 'var(--text-muted)',
                  lineHeight: 'var(--lh-body)',
                }}
              >
                {item.desc}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Тест: JSON от модели ({questions:[{q,options,answer}]}, уже провалидирован в main) →
// интерактивные вопросы. По клику вариант подсвечивается: правильный — акцентом, ошибочный — красным.
interface QuizQ { q: string; options: string[]; answer: number }

export function QuizView({ json }: { json: string }) {
  const questions: QuizQ[] = (() => {
    try { return (JSON.parse(json).questions as QuizQ[]) || []; } catch { return []; }
  })();
  // Выбранный вариант по каждому вопросу (индекс), пока не отвечен — undefined.
  const [picked, setPicked] = useState<Record<number, number>>({});
  if (!questions.length) return <div style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-sm)' }}>Тест пуст.</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {questions.map((item, qi) => {
        const chosen = picked[qi];
        const answered = chosen !== undefined;
        return (
          <div key={qi} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
              {qi + 1}. {item.q}
            </div>
            {item.options.map((opt, oi) => {
              const isRight = oi === item.answer;
              const isChosen = chosen === oi;
              // Цвета проявляются только после ответа: правильный — всегда акцентом, выбранный неверный — красным.
              const border = answered && isRight ? 'var(--accent)'
                : answered && isChosen ? 'var(--danger-500)' : 'var(--divider-strong)';
              const bg = answered && isRight ? 'var(--accent-soft)'
                : answered && isChosen ? 'color-mix(in srgb, var(--danger-500) 12%, transparent)' : 'var(--surface)';
              return (
                <button key={oi} disabled={answered}
                  onClick={() => setPicked((p) => ({ ...p, [qi]: oi }))}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', width: '100%',
                    padding: '9px 12px', borderRadius: 'var(--radius-sm)', border: `1px solid ${border}`,
                    background: bg, color: 'var(--text-body)', fontSize: 'var(--fs-sm)',
                    cursor: answered ? 'default' : 'pointer',
                  }}>
                  <span style={{ flex: 1 }}>{opt}</span>
                  {answered && isRight && <ListChecks size={15} style={{ color: 'var(--accent)', flex: 'none' }} />}
                  {answered && isChosen && !isRight && <X size={15} style={{ color: 'var(--danger-500)', flex: 'none' }} />}
                </button>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
