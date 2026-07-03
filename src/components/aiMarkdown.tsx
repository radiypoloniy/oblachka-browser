// Общие react-markdown компоненты для ЛЮБОГО текста, сгенерированного Qwen (перевод/AI-действия
// в поповере, ответы чата в AI-панели) — единственное место с этими стилями, чтобы markdown-вёрстка
// не расходилась между поповером и панелью. Перенесено из translatepopover.tsx без изменений.
import type { Components } from 'react-markdown';

// Qwen может ответить с разметкой (**жирный**, списки, изредка заголовки) — react-markdown рендерит
// её в реальные элементы (не dangerouslySetInnerHTML: без risk'а инъекции чужого HTML). Перевод
// обычно просто сплошной текст без синтаксиса — тогда это один <p> с теми же стилями, что были
// раньше у обычного <span>, визуально не отличить. Base-стили (fs-md/lh-body/text-strong) — тут,
// а не в родителе, т.к. react-markdown сам оборачивает контент в блочные теги (p/ul/li/h1…).
export const markdownComponents: Components = {
  p: ({ children }) => (
    <p style={{
      margin: '0 0 6px', fontSize: 'var(--fs-md)', lineHeight: 'var(--lh-body)',
      color: 'var(--text-strong)', fontWeight: 500, wordBreak: 'break-word',
    }}>
      {children}
    </p>
  ),
  strong: ({ children }) => <strong style={{ fontWeight: 700 }}>{children}</strong>,
  ul: ({ children }) => <ul style={{ margin: '0 0 6px', paddingLeft: 18 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '0 0 6px', paddingLeft: 18 }}>{children}</ol>,
  li: ({ children }) => (
    <li style={{
      fontSize: 'var(--fs-md)', lineHeight: 'var(--lh-body)', color: 'var(--text-strong)', marginBottom: 2,
    }}>
      {children}
    </li>
  ),
  // h1-h6 — попадаются редко (модель не просят делать заголовки), но карточки узкие (340-360px):
  // реальные размеры h1/h2 браузера смотрелись бы абсурдно. Один скромный стиль на все уровни.
  h1: ({ children }) => <strong style={{ display: 'block', fontSize: 'var(--fs-md)', margin: '0 0 4px' }}>{children}</strong>,
  h2: ({ children }) => <strong style={{ display: 'block', fontSize: 'var(--fs-md)', margin: '0 0 4px' }}>{children}</strong>,
  h3: ({ children }) => <strong style={{ display: 'block', fontSize: 'var(--fs-md)', margin: '0 0 4px' }}>{children}</strong>,
}
