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

export function InfographicView({ syntax, height }: { syntax: string; height?: string }) {
  const data = (() => {
    try {
      const parsed = JSON.parse(syntax) as { title?: string; items?: InfographicItem[] };
      return { title: parsed.title ?? '', items: Array.isArray(parsed.items) ? parsed.items : [] };
    } catch {
      return { title: '', items: [] as InfographicItem[] };
    }
  })();

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
