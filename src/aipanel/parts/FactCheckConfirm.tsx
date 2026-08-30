
/**
 * Плашка согласия перед фактчеком.
 *
 * ⚠️ Спрашивается КАЖДЫЙ РАЗ, без «запомнить»: фактчек — единственное место панели, где текст
 * страницы уходит в облако (Gemini), и молчаливое согласие тут было бы обманом. Отдельный
 * компонент потому, что это самостоятельный разговор, а не часть ряда кнопок.
 */
export function FactCheckConfirm({ onCancel, onConfirm }: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
  <div style={{
    display: 'flex', flexDirection: 'column', gap: 8,
    margin: `0 var(--pad-island) 8px`,
    padding: '12px 14px',
    borderRadius: 'var(--radius-card)',
    background: 'var(--surface-solid)',
    border: '1px solid var(--glass-edge)',
    boxShadow: 'var(--shadow-card)',
    flexShrink: 0,
  }}>
    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-body)', lineHeight: 'var(--lh-body)', overflowWrap: 'anywhere' }}>
      Текст страницы и запрос уйдут в облако (Google Gemini) для проверки по реальным
      источникам в интернете.
    </span>
    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
      <button
        onClick={() => onCancel()}
        style={{
          padding: '5px 12px', borderRadius: 'var(--radius-chip)', border: 'none',
          background: 'transparent', color: 'var(--text-muted)',
          fontSize: 'var(--fs-xs)', fontWeight: 500, cursor: 'pointer',
        }}
      >
        Отмена
      </button>
      <button
        onClick={() => onConfirm()}
        style={{
          padding: '5px 12px', borderRadius: 'var(--radius-chip)', border: 'none',
          background: 'var(--accent)', color: 'var(--on-accent)',
          fontSize: 'var(--fs-xs)', fontWeight: 600, cursor: 'pointer',
        }}
      >
        Продолжить
      </button>
    </div>
  </div>
  );
}
