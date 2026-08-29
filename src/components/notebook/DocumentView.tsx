import { useMemo, useState } from 'react';
import { Download, ExternalLink } from 'lucide-react';
import { sp, pad, RADIUS, TEXT } from '../../styles/system';
import { btnTone, btnGhost, CapsLabel } from '../settings/kit';
import { normalizeDoc, type DocSpec } from '../../../shared/notebookDoc';
import { docToHtml, docChars, isTemplateFit, DOC_TEMPLATES, type DocTemplate } from './doc';

const KEY = 'oblako-notebook-doc-template';

/**
 * Документ Студии: один и тот же разбор, три шаблона на выбор.
 *
 * ⚠️ Предпросмотр показывает РОВНО ТОТ ЖЕ html, который сохранится и откроется вкладкой —
 * шаблон рисует одну строку, а не две реализации (разбор — в doc/shell.ts). Поэтому здесь
 * iframe, а не React-вёрстка: другой реализации просто нет, и разъехаться нечему.
 *
 * ⚠️ sandbox пустой строкой — максимально строгий: ни скриптов, ни форм, ни навигации.
 * Текст в документе пришёл от модели по материалам ЧУЖИХ страниц, и хотя он весь экранирован
 * (esc в doc/shell.ts), полагаться на одну линию обороны здесь незачем.
 */
export function DocumentView({ json }: { json: string }) {
  const spec = useMemo<DocSpec | null>(() => {
    try { return normalizeDoc(JSON.parse(json)); } catch { return null; }
  }, [json]);

  const [tpl, setTpl] = useState<DocTemplate>(() => {
    const saved = localStorage.getItem(KEY);
    return DOC_TEMPLATES.some((t) => t.id === saved) ? saved as DocTemplate : 'report';
  });

  const html = useMemo(() => spec ? docToHtml(spec, tpl) : '', [spec, tpl]);

  if (!spec) {
    return <div style={{ ...TEXT.body, color: 'var(--danger-500)', padding: pad(4, 6) }}>Документ не разобрался.</div>;
  }

  // Шаблон, который не выдержит этот материал, не предлагаем — но и не прячем совсем:
  // приглушённая пилюля с подсказкой честнее исчезнувшей кнопки (см. isTemplateFit).
  const pick = (id: DocTemplate) => { setTpl(id); localStorage.setItem(KEY, id); };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      {/* ⚠️ Две строки, а не одна. В одну ряд пилюль, счётчик и две кнопки не помещались и
          переносились как попало — выбор шаблона терялся среди них настолько, что человек его
          не заметил вовсе («нет выбора какой стиль нужен»). Теперь у выбора своя строка со
          своей подписью, а действия — своей. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: sp(3), padding: pad(3, 6), paddingBottom: sp(2),
        flex: 'none', flexWrap: 'wrap',
      }}>
        <CapsLabel style={{ marginBottom: 0 }}>Шаблон</CapsLabel>
        <div style={{ display: 'flex', gap: sp(1) }}>
          {DOC_TEMPLATES.map((t) => {
            const fit = isTemplateFit(spec, t.id);
            const on = tpl === t.id;
            return (
              <button key={t.id} onClick={() => pick(t.id)}
                title={fit ? t.hint : `${t.hint} — на этом материале развалится`}
                style={{
                  border: '1px solid', borderColor: on ? 'transparent' : 'var(--divider-strong)',
                  background: on ? 'var(--section-tone)' : 'transparent',
                  color: on ? 'var(--section-ink)' : 'var(--text-body)',
                  opacity: fit || on ? 1 : 0.45,
                  padding: pad(2, 3), borderRadius: RADIUS.pill, cursor: 'default',
                  fontSize: 'var(--fs-sm)', fontWeight: 600,
                }}>
                {t.label}
              </button>
            );
          })}
        </div>
        <span style={{ flex: 1 }} />
        <CapsLabel style={{ marginBottom: 0 }}>
          {spec.blocks.length} блоков · {docChars(spec).toLocaleString('ru-RU')} знаков
        </CapsLabel>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: sp(2), padding: pad(1, 6), paddingTop: 0, paddingBottom: sp(3),
        borderBottom: '1px solid var(--divider)', flex: 'none', flexWrap: 'wrap',
      }}>
        <span style={{ ...TEXT.caption, color: 'var(--text-faint)', flex: 1, minWidth: 0 }}>
          {DOC_TEMPLATES.find((t) => t.id === tpl)?.hint}
        </span>
        {/* ⚠️ «Открыть» стоит ПЕРЕД «Сохранить» и оформлена главной: посмотреть документ целиком
            хочется чаще, чем положить его файлом на диск, а в модалке он всегда подрезан. */}
        <button onClick={() => void window.oblako.openStudioDoc(spec.title, html)}
          style={{ ...btnTone, display: 'inline-flex', alignItems: 'center', gap: sp(2) }}>
          <ExternalLink size={15} /> Открыть в новой вкладке
        </button>
        <button onClick={() => void window.oblako.saveNotebookDoc(spec.title, html)}
          style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: sp(2) }}>
          <Download size={15} /> Сохранить
        </button>
      </div>

      <iframe
        title={spec.title} srcDoc={html} sandbox=""
        style={{ flex: 1, minHeight: 420, width: '100%', border: 'none', background: 'var(--surface-sunken)' }}
      />
    </div>
  );
}
