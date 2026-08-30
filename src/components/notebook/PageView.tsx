import { useMemo, useState } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import { sp, pad, RADIUS, TEXT } from '../../styles/system';
import { btnTone, btnGhost, CapsLabel } from '../settings/kit';
import { markupTextLength, type PageSpec } from '../../../shared/docMarkup';
import { pageToHtml, PAGE_STYLES, type PageStyle } from './page';

const KEY = 'oblako-notebook-page-style';

/**
 * Страница, написанная моделью: три стиля на выбор.
 *
 * ⚠️ Предпросмотр — тот же html, который сохранится и откроется вкладкой, в iframe с sandbox="".
 * Правило то же, что у документа: один рендерер на стиль, иначе человек сохраняет не то, что
 * видел. Здесь оно вдвойне обязательно — тело писала модель, и второй его реализации быть не
 * может в принципе.
 */
export function PageView({ json }: { json: string }) {
  const page = useMemo<PageSpec | null>(() => {
    try {
      const p = JSON.parse(json) as PageSpec;
      return p && typeof p.html === 'string' ? p : null;
    } catch { return null; }
  }, [json]);

  const [style, setStyle] = useState<PageStyle>(() => {
    const saved = localStorage.getItem(KEY);
    return PAGE_STYLES.some((s) => s.id === saved) ? saved as PageStyle : 'polosa';
  });

  const html = useMemo(() => page ? pageToHtml(page, style) : '', [page, style]);

  if (!page) {
    return <div style={{ ...TEXT.body, color: 'var(--danger-500)', padding: pad(4, 6) }}>Страница не разобралась.</div>;
  }

  const pick = (id: PageStyle) => { setStyle(id); localStorage.setItem(KEY, id); };
  const hint = PAGE_STYLES.find((s) => s.id === style)?.hint;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: sp(3), padding: pad(3, 6), paddingBottom: sp(2),
        flex: 'none', flexWrap: 'wrap',
      }}>
        <CapsLabel style={{ marginBottom: 0 }}>Стиль</CapsLabel>
        <div style={{ display: 'flex', gap: sp(1) }}>
          {PAGE_STYLES.map((s) => {
            const on = style === s.id;
            return (
              <button key={s.id} onClick={() => pick(s.id)} title={s.hint}
                style={{
                  border: '1px solid', borderColor: on ? 'transparent' : 'var(--divider-strong)',
                  background: on ? 'var(--section-tone)' : 'transparent',
                  color: on ? 'var(--section-ink)' : 'var(--text-body)',
                  padding: pad(2, 3), borderRadius: RADIUS.pill, cursor: 'default',
                  fontSize: 'var(--fs-sm)', fontWeight: 600,
                }}>
                {s.label}
              </button>
            );
          })}
        </div>
        <span style={{ flex: 1 }} />
        <CapsLabel style={{ marginBottom: 0 }}>
          {markupTextLength(page.html).toLocaleString('ru-RU')} знаков
          {page.stats.length > 0 && ` · ${page.stats.length} чисел`}
        </CapsLabel>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: sp(2), padding: pad(1, 6), paddingTop: 0,
        paddingBottom: sp(3), borderBottom: '1px solid var(--divider)', flex: 'none', flexWrap: 'wrap',
      }}>
        <span style={{ ...TEXT.caption, color: 'var(--text-faint)', flex: 1, minWidth: 0 }}>{hint}</span>
        {/* ⚠️ «Открыть» главной: страница тянется по ширине окна, и в модалке этого не видно. */}
        <button onClick={() => void window.oblako.openStudioDoc(page.title, html)}
          style={{ ...btnTone, display: 'inline-flex', alignItems: 'center', gap: sp(2) }}>
          <ExternalLink size={15} /> Открыть в новой вкладке
        </button>
        <button onClick={() => void window.oblako.saveNotebookDoc(page.title, html)}
          style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: sp(2) }}>
          <Download size={15} /> Сохранить
        </button>
      </div>

      <iframe
        title={page.title} srcDoc={html} sandbox=""
        style={{ flex: 1, minHeight: 460, width: '100%', border: 'none', background: 'var(--surface-sunken)' }}
      />
    </div>
  );
}
