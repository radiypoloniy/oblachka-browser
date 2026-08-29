import { Download } from 'lucide-react';
import { sp, pad, RADIUS, TEXT, DISPLAY, MEASURE } from '../../styles/system';
import { btnTone, CapsLabel } from '../settings/kit';
import { normalizeDoc, type DocBlock, type DocSpec } from '../../../shared/notebookDoc';
import { docToHtml } from './docExport';

/**
 * Документ Студии: девять типов блоков, каждый рисуется своим куском разметки.
 *
 * ⚠️ Разметку делаем МЫ, модель только выбрала последовательность блоков и наполнила их текстом
 * (разбор — в shared/notebookDoc.ts). Отсюда и «красиво»: не потому, что модель хорошо
 * сверстала, а потому, что верстали мы — теми же токенами, что весь браузер.
 */
export function DocumentView({ json }: { json: string }) {
  let doc: DocSpec | null = null;
  try { doc = normalizeDoc(JSON.parse(json)); } catch { doc = null; }
  if (!doc) {
    return <div style={{ ...TEXT.body, color: 'var(--danger-500)', padding: pad(4, 6) }}>Документ не разобрался.</div>;
  }
  const spec = doc;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: sp(2), padding: pad(3, 6),
        borderBottom: '1px solid var(--divider)', flex: 'none',
      }}>
        <CapsLabel style={{ marginBottom: 0, flex: 1 }}>{spec.blocks.length} блоков</CapsLabel>
        {/* ⚠️ Выгрузка — САМОДОСТАТОЧНЫЙ файл со стилями инлайном: док уезжает человеку, у
            которого нашего браузера нет, и ссылка на наши токены там ничего не значит. */}
        <button onClick={() => void saveDoc(spec)} style={{ ...btnTone, display: 'inline-flex', alignItems: 'center', gap: sp(2) }}>
          <Download size={15} /> Сохранить .html
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: pad(6) }}>
        <div style={{ maxWidth: 620, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: sp(4) }}>
          {spec.blocks.map((b, i) => <Block key={i} block={b} />)}
        </div>
      </div>
    </div>
  );
}

async function saveDoc(spec: DocSpec): Promise<void> {
  await window.oblako.saveNotebookDoc(spec.title, docToHtml(spec));
}

function Block({ block }: { block: DocBlock }) {
  switch (block.kind) {
    case 'cover':
      return (
        <div style={{
          borderRadius: RADIUS.box, padding: pad(4, 4), position: 'relative', overflow: 'hidden',
          background: 'var(--section-tone, var(--accent))', color: 'var(--section-ink, var(--on-accent))',
        }}>
          <div style={{ ...DISPLAY, fontSize: 24, fontWeight: 700, letterSpacing: '-0.03em' }}>{block.title}</div>
          {block.text && <div style={{ ...TEXT.caption, color: 'inherit', opacity: 0.78, marginTop: sp(1) }}>{block.text}</div>}
        </div>
      );
    case 'heading':
      return <h3 style={{ ...TEXT.section, margin: 0 }}>{block.title}</h3>;
    case 'text':
      return <p style={{ ...TEXT.body, margin: 0, maxWidth: MEASURE }}>{block.text}</p>;
    case 'quote':
      return (
        <blockquote style={{
          margin: 0, paddingLeft: sp(3), borderLeft: '3px solid var(--section-tone, var(--accent))',
          ...TEXT.body, fontWeight: 600, color: 'var(--text-strong)', maxWidth: MEASURE,
        }}>{block.text}</blockquote>
      );
    case 'list':
      return (
        <ul style={{ margin: 0, paddingLeft: sp(4), ...TEXT.body, maxWidth: MEASURE }}>
          {block.items?.map((it, i) => <li key={i} style={{ marginBottom: sp(1) }}>{it}</li>)}
        </ul>
      );
    case 'metrics':
      return (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(block.pairs?.length ?? 1, 4)}, 1fr)`, gap: sp(2) }}>
          {block.pairs?.map((p, i) => (
            <div key={i} style={{ background: 'var(--surface-sunken)', borderRadius: RADIUS.box, padding: pad(3) }}>
              <div style={{ ...DISPLAY, fontSize: 22, fontWeight: 700, color: 'var(--section-tone, var(--accent))' }}>{p.value}</div>
              <div style={{ ...TEXT.caption }}>{p.label}</div>
            </div>
          ))}
        </div>
      );
    case 'table':
    case 'compare':
      return (
        <div style={{ borderRadius: RADIUS.box, overflow: 'hidden', border: '1px solid var(--divider)' }}>
          {block.pairs?.map((p, i) => (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: sp(3),
              padding: pad(2, 3), borderBottom: i === (block.pairs!.length - 1) ? 'none' : '1px solid var(--divider-soft, var(--divider))',
            }}>
              <span style={{ ...TEXT.caption, color: 'var(--text-muted)' }}>{p.label}</span>
              <span style={{ ...TEXT.body }}>{p.value}</span>
            </div>
          ))}
        </div>
      );
    case 'sources':
      return (
        <div>
          <CapsLabel>{block.title || 'Источники'}</CapsLabel>
          {block.pairs?.map((p, i) => (
            <div key={i} style={{ ...TEXT.caption, marginBottom: sp(1) }}>
              <span style={{ color: 'var(--text-body)' }}>{p.label}</span>
              {p.value && <span style={{ fontFamily: 'var(--font-mono)' }}> · {p.value}</span>}
            </div>
          ))}
        </div>
      );
  }
}
