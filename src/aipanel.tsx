// Правая AI-панель — Заход 1: пустой каркас (заголовок + плейсхолдер), без AI-логики.
// Позиция/размер/открытие-закрытие целиком в main (AiPanelManager.ts) — эта страница просто
// рисует «парящий остров» на весь свой вьюпорт, без роста/скролла как у поповера.
// Фон/тень — переиспользованы буквально из translatepopover.tsx (var(--surface-solid) +
// '0 10px 28px rgba(40,30,80,0.16)'), а не подобраны заново: та же WebContentsView с
// setBackgroundColor('#00000000') (см. AiPanelManager.ts) отлажена там, никакого прозрачного
// glass-фона — сплошной непрозрачный остров, иначе он сливается с холстом страницы под собой
// (тот же провал контраста, что и с полупрозрачным glass-fill в прошлой версии).
import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { Sparkles, X } from 'lucide-react';
import './styles/global.css';

declare global {
  interface Window {
    aiPanel: { close: () => void }
  }
}

// Воздух вокруг острова на все стороны — держать в синхроне с GUTTER в
// electron/AiPanelManager.ts (тот выделяет под него ровно столько же места в bounds
// WebContentsView, отсчитывая от тулбара/правого края/низа окна). Тот же паддинг заодно
// и зона под CSS box-shadow — WebContentsView обрезает всё, что рисуется за границей.
const GUTTER = 20;

// Сырые отступы сверху/снизу от границ вьюпорта равны (оба GUTTER) — но у тулбара нет своего
// фона (см. Toolbar.tsx: div без background, флаш-прозрачный поверх холста), а его кнопки/омнибокс
// центрированы внутри строки высотой 56px с ~12px пустого места сверху/снизу вокруг иконок
// (padding:7 вокруг 18px-иконки). Глаз меряет зазор от ВИДИМЫХ иконок, а не от невидимой границы
// div'а — поэтому верхний зазор читается больше нижнего при равных сырых отступах. Компенсируем
// оптически, сдвигая карточку вниз в её же фиксированном диапазоне (сам диапазон — от тулбара до
// низа окна — не меняется, см. AiPanelManager.ts): но не на все 12px тулбарной «пустоты» — часть
// её всё ещё читается как часть тулбара, не как зазор.
const VERTICAL_OPTICAL_SHIFT = 6;

function AiPanel() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') window.aiPanel.close(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div style={{
      paddingTop: GUTTER - VERTICAL_OPTICAL_SHIFT,
      paddingBottom: GUTTER + VERTICAL_OPTICAL_SHIFT,
      paddingLeft: GUTTER,
      paddingRight: GUTTER,
      boxSizing: 'border-box', width: '100%', height: '100vh',
    }}>
      <div style={{
        width: '100%', height: '100%', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--surface-solid)',
        // var(--radius-island) — заметно круглее var(--radius-card): остров, а не карточка.
        borderRadius: 'var(--radius-island)',
        boxShadow: '0 10px 28px rgba(40,30,80,0.16)',
        fontFamily: 'var(--font-sans)',
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: 'var(--pad-island)',
          flexShrink: 0,
        }}>
          <Sparkles size={18} style={{ color: 'var(--accent)' }} />
          <span style={{ flex: 1, fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text-strong)' }}>
            AI
          </span>
          <button
            onClick={() => window.aiPanel.close()}
            title="Закрыть (Esc)"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 30, height: 30, flexShrink: 0,
              background: 'var(--surface-sunken)', border: 'none', borderRadius: '50%',
              color: 'var(--text-muted)', cursor: 'pointer', padding: 0,
            }}
          >
            <X size={15} strokeWidth={2} />
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
