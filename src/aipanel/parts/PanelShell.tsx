import type { CSSProperties, ReactNode } from 'react'
import { X } from 'lucide-react'
import { SHELL_MARGIN } from '../../../shared/layout'

// Воздух вокруг карточки — bounds самой WebContentsView его не выделяют (см.
// AiPanelManager.ts::computeBounds — flush), это чистый CSS-padding внутри вью, и заодно зона
// под CSS box-shadow — WebContentsView обрезает всё, что рисуется за границей.
//
// Все 4 стороны сведены к SHELL_MARGIN не для единообразия ради единообразия, а из geometry:
// AI-view занимает ровно диапазон [TOOLBAR_HEIGHT..низ окна] (computeBounds), и этот же диапазон
// по высоте занимает aiPanelContainerRef в App.tsx (flex-строка сразу под тулбаром высотой
// TOOLBAR_HEIGHT, без своего margin) — тот самый ряд, где живёт contentRef/split-остров.
// Единственное, что внутри этого совпадающего диапазона отступает верх/низ contentRef от его
// границ — это marginTop/marginBottom: var(--gutter-shell) на самом contentRef (App.tsx). Чтобы
// верх/низ AI-карточки легли на одну линию с верхом/низом split-острова, паддинг карточки должен
// быть НЕ произвольным (было 14/26 с оптической подгонкой под старый попап-дизайн), а тем же
// SHELL_MARGIN — старые 14/26 расходились со split-островом на +2px сверху и +14px снизу.

/**
 * Остров панели: внешний воздух вокруг вью и сама карточка.
 *
 * ⚠️ ОДИН на обе панели — полную (чат + приложения) и облегчённую (только приложения, лёгкое
 * окно). Геометрия здесь не косметика: верх и низ карточки обязаны лечь на одну линию со
 * split-островом в App.tsx, и вторая копия этих чисел разъехалась бы с первой на первой же
 * правке отступов.
 */
export function PanelShell({ wallpaper, children }: {
  /** Заливка обоями всего острова — только в режиме «Приложения» (см. wallpaperBackground). */
  wallpaper?: CSSProperties | null
  children: ReactNode
}) {
  return (
    <div className="ai-panel-root" style={{
      // Верх/низ = SHELL_MARGIN — совпадает с верхом/низом split-острова (см. комментарий выше).
      paddingTop: SHELL_MARGIN,
      paddingBottom: SHELL_MARGIN,
      // Слева — 0: зазор до split-контента теперь целиком у DOM-хэндла в App.tsx (ISLAND_GAP),
      // карточка вплотную к левому краю своей вью. Справа — SHELL_MARGIN: тот же отступ, что у
      // сайдбара от края окна (симметрия «остров — край окна»).
      paddingLeft: 0,
      paddingRight: SHELL_MARGIN,
      boxSizing: 'border-box', width: '100%', height: '100vh',
    }}>
      <div style={{
        width: '100%', height: '100%', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: 'var(--surface-solid)',
        // Режим «Приложения»: весь остров целиком заливается обоями (фикс-холст с кропом при
        // ресайзе — см. wallpaperBackground), шапка с переключателем просто парит поверх.
        ...(wallpaper ?? null),
        // var(--radius-island) — заметно круглее var(--radius-card): остров, а не карточка.
        borderRadius: 'var(--radius-island)',
        // НЕ var(--shadow-overlay) — тот рассчитан на щедрый симметричный SHADOW_MARGIN=40
        // (suggestdropdown.tsx/translatepopover.tsx), а тут padding теперь 0/12/12/12
        // (см. paddingLeft/Top/Right/Bottom выше — заход про зазоры и SHELL_MARGIN ужал его).
        // shadow-overlay при offset:10/blur:28 требует до 38px запаса на сторону — с 12px
        // (и 0 слева) она обрезалась WebContentsView в жёсткий угловатый блок вместо мягкой
        // тени. Своя маленькая асимметричная тень, подогнанная под фактический паддинг:
        // offsetX:5/blur:5 — 0 слева (карточка и так вплотную к хэндлу, там нечему растворяться)
        // и 10 справа (запас 2px); offsetY:2/blur:5 — 3 сверху и 7 снизу (запас 9/5px).
        boxShadow: '5px 2px 5px rgba(40,30,80,0.20)',
        fontFamily: 'var(--font-sans)',
      }}>
        {children}
      </div>
    </div>
  )
}

/** Крестик в шапке. Тот же и там, где рядом переключатель режимов, и там, где он один. */
export function PanelCloseButton() {
  return (
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
  )
}
