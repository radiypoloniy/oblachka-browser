import type React from 'react';
import { TEXT, RADIUS, sp } from '../styles/system';

// ── Пустое состояние ──────────────────────────────────────────────────────────────────────────
//
// ⚠️ Раньше в каждом разделе стояла своя центрированная строка: «Нет загрузок», «История пуста»,
// «Нет закладок». Технически верно и ровно ничего не сообщает — человек и так видит, что список
// пуст. Пустой экран это не ошибка и не дыра: это первое, что видит новый человек в разделе, и
// единственное место, где раздел может объяснить, ЗАЧЕМ он нужен, пока в нём ничего нет.
//
// ⚠️ Значок — в мягкой плашке, а не голым: одинокая иконка посреди пустоты читается как ошибка
// загрузки. Плашка превращает её в намеренный знак.
//
// Правило текста: заголовок называет состояние без извинений («Загрузок пока нет», а не «Здесь
// ничего нет»), подсказка объясняет, что появится здесь и откуда. Ни одного восклицательного
// знака и ни одной шутки — их перечитывают каждый раз, а смешно бывает один.
export function EmptyState({ icon, title, hint, action }: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  /** Кнопка или ссылка — только если человеку есть что нажать прямо сейчас. */
  action?: React.ReactNode;
}) {
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'flex-start', textAlign: 'center', paddingTop: 72, gap: sp(2),
    }}>
      <div style={{
        width: 46, height: 46, borderRadius: RADIUS.box,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--card)', color: 'var(--accent)',
      }}>
        {icon}
      </div>
      <div style={{ ...TEXT.section }}>{title}</div>
      {hint && (
        <div style={{
          ...TEXT.body, color: 'var(--text-muted)', maxWidth: '34ch', marginTop: -4,
        }}>
          {hint}
        </div>
      )}
      {action && <div style={{ marginTop: sp(1) }}>{action}</div>}
    </div>
  );
}
