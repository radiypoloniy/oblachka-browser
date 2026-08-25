import type React from 'react';

/**
 * Пометка «уже открыта» в строке подсказки омнибокса.
 *
 * ⚠️ Она КЛИКАБЕЛЬНАЯ, и в этом весь смысл. Строка подсказки всегда открывает страницу — даже
 * если та уже открыта в другой вкладке (см. composeSuggestions в shared/suggestList.ts). Прежде
 * браузер решал за человека: набранное похоже на адрес — открыть дублем, похоже на имя —
 * телепортировать к прошлой вкладке. Предсказать исход по тексту в строке было нельзя, и он
 * удивлял ровно тогда, когда его не ждали. Теперь основное действие одно, а переход — отдельное,
 * видимое и необязательное.
 *
 * ⚠️ `onMouseDown`, а не `onClick`: выбор в этой вью регистрируется до потенциального ухода
 * фокуса у омнибокса — тем же приёмом живёт и клик по самой строке.
 *
 * ⚠️ `stopPropagation` обязателен: без него сработает и обработчик строки, то есть человек
 * получит И дубль, И переход одним нажатием.
 */
export function OpenTabBadge({ onGo }: { onGo: () => void }): React.ReactElement {
  return (
    <span
      onMouseDown={(e) => { e.stopPropagation(); onGo(); }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--accent-soft)';
        e.currentTarget.style.color = 'var(--accent)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--surface-sunken)';
        e.currentTarget.style.color = 'var(--text-muted)';
      }}
      title="Перейти на уже открытую вкладку"
      style={{
        flex: 'none', display: 'inline-flex', alignItems: 'center',
        padding: '3px 9px', borderRadius: 'var(--radius-pill)',
        background: 'var(--surface-sunken)', color: 'var(--text-muted)',
        fontSize: 'var(--fs-xs)', fontWeight: 500, whiteSpace: 'nowrap',
        transition: 'background 0.12s, color 0.12s',
      }}
    >
      уже открыта
    </span>
  );
}
