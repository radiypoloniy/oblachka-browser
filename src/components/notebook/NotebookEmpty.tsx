import { sp, pad, RADIUS, TEXT, DISPLAY, MEASURE } from '../../styles/system';
import { btnTone, btnGhost } from '../settings/kit';

/**
 * Пустой блокнот: первый экран, который видит человек.
 *
 * ⚠️ До этого здесь были три пустые колонки — то есть самая крупная AI-функция браузера
 * встречала человека ничем. Экран обязан сказать, ЧТО это и с чего начать, одной фразой и
 * дверями, а не подсказкой в углу.
 *
 * ⚠️ Тон здесь тот же, что у наполненного блокнота: цвет принадлежит разделу, а не состоянию
 * (см. SECTION_TONE в kit.tsx). Что блокнот пуст, говорит крупный 0 в шапке.
 */
export function NotebookEmpty({ onAddUrl, onAddText, onAddFiles, extra }: {
  onAddUrl: () => void;
  onAddText: () => void;
  onAddFiles: () => void;
  /** Третья дверь — «Собрать материал». Появляется только у тех, кто подключил поиск. */
  extra?: React.ReactNode;
}) {
  return (
    <div style={{
      flex: 1, minHeight: 0, display: 'grid', placeItems: 'center',
      textAlign: 'center', padding: pad(6),
    }}>
      <div style={{
        maxWidth: MEASURE, display: 'flex', flexDirection: 'column',
        alignItems: 'center', gap: sp(3),
      }}>
        <h2 style={{
          ...DISPLAY, fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em',
          margin: 0, color: 'var(--text-strong)',
        }}>
          Соберите материал — блокнот ответит по нему
        </h2>
        <p style={{ ...TEXT.body, color: 'var(--text-faint)', margin: 0 }}>
          Добавьте ссылки, документы с диска или вставьте текст. Чат будет отвечать только по
          ним, а «Студия» соберёт из них пересказ, карту, тест или документ.
        </p>
        <div style={{
          display: 'flex', gap: sp(2), flexWrap: 'wrap', justifyContent: 'center', marginTop: sp(1),
        }}>
          <button onClick={onAddUrl} style={btnTone}>Добавить ссылку</button>
          <button onClick={onAddFiles} style={btnGhost}>Выбрать документы</button>
          <button onClick={onAddText} style={btnGhost}>Вставить текст</button>
          {extra}
        </div>
      </div>
    </div>
  );
}

/** Заглушка колонки источников, пока в ней ничего нет. */
export function SourcesEmpty() {
  return (
    <div style={{
      display: 'grid', placeItems: 'center', padding: pad(6, 3), textAlign: 'center',
      borderRadius: RADIUS.box,
    }}>
      <span style={{ ...TEXT.caption, color: 'var(--text-faint)' }}>Ничего не добавлено</span>
    </div>
  );
}
