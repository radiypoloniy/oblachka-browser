import { useEffect, useRef, useState } from 'react';
import { Transformer } from 'markmap-lib';
import { Markmap } from 'markmap-view';
import { Infographic } from '@antv/infographic';
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

// Инфографика: декларативный синтаксис AntV Infographic от модели → SVG движком @antv/infographic.
// Чистим возможные ```-ограждения и обрезаем до строки "infographic ..." (модель иногда добавляет прозу).
export function InfographicView({ syntax, height }: { syntax: string; height?: string }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    let src = syntax.replace(/```[a-z]*\n?/gi, '').trim();
    const at = src.indexOf('infographic ');
    if (at > 0) src = src.slice(at);
    if (!src) return;
    const ig = new Infographic({ container: box, width: '100%', height: '100%' });
    ig.render(src);
    return () => ig.destroy();
  }, [syntax]);
  return <div ref={boxRef} style={{ width: '100%', height: height ?? MODAL_INFOGRAPHIC_HEIGHT }} />;
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
