import { Download } from 'lucide-react';
import { CAPS, RADIUS, sp, pad } from '../../styles/system';
import { aiBridge } from './bridge';
import { blockFileName, savable } from '../../../shared/aiAttachments';

/**
 * Блок кода в ответе модели — и сохранение его файлом.
 *
 * ⚠️ ЭТО И ЕСТЬ «ДОКУМЕНТ ОТ МОДЕЛИ», честно. Ни один чат-API не отдаёт ни .docx, ни .pdf, ни
 * .xlsx: наружу приходит текст. Таблица, разметка, json, svg, код — всё это уже документы, им не
 * хватает только имени и расширения. Их и выдаёт shared/aiAttachments.ts, а записывает main.
 *
 * ⚠️ Кнопка есть НЕ У ВСЯКОГО фенса. Модель то и дело берёт в него одну строку — имя команды,
 * значение поля; «сохранить» у такого фрагмента это шум, который к тому же легко нажать по ошибке.
 * Порог живёт в общей логике под проверкой, а не здесь на глаз.
 */
export function CodeBlock({ lang, text, index }: { lang: string | null; text: string; index: number }) {
  const offer = savable(lang, text);
  const name = blockFileName(lang, index);

  return (
    <div style={{
      margin: '0 0 8px', borderRadius: RADIUS.box, overflow: 'hidden',
      border: '1px solid var(--divider)', background: 'var(--surface-sunken)',
    }}>
      {(lang !== null || offer) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: sp(2), padding: pad(1, 3),
          borderBottom: '1px solid var(--divider)',
        }}>
          <span style={CAPS}>{lang ?? 'текст'}</span>
          {offer && (
            <button
              onClick={() => void aiBridge()?.aiTextSave(name, text)}
              title={`Сохранить как «${name}»`}
              style={{
                ...CAPS, marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: sp(1),
                padding: pad(1, 2), border: 'none', borderRadius: RADIUS.pill,
                background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; e.currentTarget.style.color = 'var(--text-strong)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              <Download size={12} />
              Сохранить
            </button>
          )}
        </div>
      )}
      {/* ⚠️ Своя горизонтальная прокрутка: длинная строка кода иначе растягивает пузырь сообщения,
          а за ним и всю колонку чата — в узкой панели это ломает раскладку целиком. */}
      <pre style={{
        margin: 0, padding: pad(2, 3), overflowX: 'auto',
        fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-xs)', lineHeight: 1.5,
        color: 'var(--text-strong)',
      }}>
        <code>{text}</code>
      </pre>
    </div>
  );
}
