// Правая AI-панель — Заход 1: пустой каркас (заголовок + плейсхолдер), без AI-логики.
// Позиция/размер/открытие-закрытие целиком в main (AiPanelManager.ts) — эта страница просто
// рисует «парящую» glass-карточку на весь свой вьюпорт, без роста/скролла как у поповера.
// Настоящий сквозной backdrop-blur контента ЗА панелью недостижим (нативный оверлей не видит
// пиксели чужого WebContentsView под собой) — здесь glass-ЭФФЕКТ в пределах своего слоя
// (полупрозрачность + var(--glass-filter) + тень + скругления), см. задачу/CLAUDE.md.
import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { Sparkles, X } from 'lucide-react';
import './styles/global.css';

declare global {
  interface Window {
    aiPanel: { close: () => void }
  }
}

// Прозрачный запас слева под CSS box-shadow «парящей» карточки — держать в синхроне с
// SHADOW_MARGIN в electron/AiPanelManager.ts (тот выделяет под него ровно столько же места
// в bounds WebContentsView). Справа/сверху/снизу паддинга нет — панель флаш к тулбару/окну.
const SHADOW_MARGIN = 24;

function AiPanel() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') window.aiPanel.close(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div style={{ paddingLeft: SHADOW_MARGIN, boxSizing: 'border-box', width: '100%', height: '100vh' }}>
      <div style={{
        width: '100%', height: '100%', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column',
        background: 'var(--glass-fill-strong)',
        backdropFilter: 'var(--glass-filter)',
        WebkitBackdropFilter: 'var(--glass-filter)',
        // Скругления только со стороны контента (слева) — справа/сверху/снизу панель флаш
        // к окну/тулбару, там углов не видно.
        borderRadius: 'var(--radius-card) 0 0 var(--radius-card)',
        boxShadow: 'var(--shadow-pop)',
        border: '1px solid var(--glass-edge)',
        fontFamily: 'var(--font-sans)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: 'var(--pad-card)',
          borderBottom: '1px solid var(--divider)',
          flexShrink: 0,
        }}>
          <Sparkles size={16} style={{ color: 'var(--accent)' }} />
          <span style={{ flex: 1, fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text-strong)' }}>
            AI
          </span>
          <button
            onClick={() => window.aiPanel.close()}
            title="Закрыть (Esc)"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 22, height: 22, flexShrink: 0,
              background: 'none', border: 'none', borderRadius: 'calc(var(--radius-card) / 2)',
              color: 'var(--text-muted)', cursor: 'pointer', padding: 0,
            }}
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
        {/* Заглушка — содержимое появится в следующих заходах. */}
        <div style={{ flex: 1 }} />
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AiPanel />
  </React.StrictMode>,
);
