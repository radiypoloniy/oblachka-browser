// ── Проявление содержимого оверлея ────────────────────────────────────────────
//
// Зачем. Выпадашка омнибокса, поиск по странице и поповеры живут в собственных
// WebContentsView, а нативную вью анимировать нельзя: показ — это setVisible(true), и она
// возникает щелчком. CSS до неё не дотягивается (тот же закон, из-за которого окна
// веб-приложений в графе не ездят с зумом холста).
//
// Обход простой: вью пусть появляется мгновенно, но в первый кадр её содержимое ПРОЗРАЧНО.
// Щелчка никто не видит — видно только проявление за 140 мс. Анимируем `opacity` и
// `transform`, то есть работу компоновщика: вёрстка не пересчитывается, кадры не теряются.
//
// ⚠️ Триггер — visibilitychange, а НЕ монтирование React. Вью при скрытии не уничтожается
// (переписка, введённый текст и позиция должны переживать сворачивание), поэтому компонент
// монтируется один раз, а показов бывают сотни. Скрытая вью честно сообщает `document.hidden`.
//
// Стиль держим здесь же, а не в общем css: у каждой точки входа своя сборка и свой html,
// и одна строчка импорта надёжнее шести правок в разных местах.

const STYLE_ID = 'oblako-overlay-reveal';
const CLASS = 'oblako-reveal';

const CSS = `
@keyframes ${CLASS}-in {
  from { opacity: 0; transform: translateY(-4px) scale(0.985); }
  to   { opacity: 1; transform: none; }
}
body.${CLASS} > * {
  animation: ${CLASS}-in var(--dur-base, 180ms) var(--ease-out, cubic-bezier(0.16, 1, 0.3, 1)) both;
}
@media (prefers-reduced-motion: reduce) {
  body.${CLASS} > * { animation: none; }
}
`;

export function installOverlayReveal(): void {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  const play = (): void => {
    document.body.classList.remove(CLASS);
    // Перезапуск анимации: без принудительного пересчёта браузер считает класс тем же самым
    // и проигрывать заново отказывается.
    void document.body.offsetWidth;
    document.body.classList.add(CLASS);
  };

  if (!document.hidden) play();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) play();
  });
}
