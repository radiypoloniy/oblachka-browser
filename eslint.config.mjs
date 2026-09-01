// ESLint — РОВНО ДВА готовых правила, которых нет у наших собственных сторожей.
//
// ⚠️ В CLAUDE.md записано, что ESLint не ставился намеренно: четыре своих правила
// (`conventions-check`) специфичны для проекта и в ESLint потребовали бы своего плагина — тот же
// код плюс зависимость и конфиг. Это решение в силе. Здесь ставится другое: два ГОТОВЫХ правила,
// которые ловят целые классы ошибок и написать которые самим невозможно, потому что оба требуют
// разбора типов и графа хуков.
//
// ⚠️ Ничего сверх этих двух не включаем — ни `recommended`, ни стилистики. Стиль в проекте держат
// `conventions-check` (дизайн-система, границы слоёв) и `structure-check` (размеры), и второй
// источник правды по стилю означал бы спор двух сторожей на каждой правке.
//
// Что именно и зачем:
//   • react-hooks/rules-of-hooks — хук вызван условно или не из компонента. Такое `tsc` не видит
//     вовсе, а ломается оно не падением, а рассинхроном состояния между рендерами.
//   • react-hooks/exhaustive-deps — забытая зависимость эффекта. Даёт не ошибку, а ЗАМЫКАНИЕ НА
//     УСТАРЕВШЕМ значении: работает через раз и «само чинится» при следующем рендере. Ровно тот
//     класс, который мы ловили глазами при разборе Toolbar на хуки.
//   • @typescript-eslint/no-floating-promises — забытый await. В коде сотни осознанных `void p`,
//     и отличить их от забытых сейчас может только человек.
//
// Запуск: npm run lint   ·   храповик: npm test -- lint
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    // ⚠️ Сборки, зависимости и скрипты — мимо. Скрипты не типизированы проектом (гоняются голым
    // node), а dist-electron это вывод компилятора: линтовать его — линтовать самих себя.
    ignores: ['dist/**', 'dist-electron/**', 'release/**', 'node_modules/**', 'scripts/**', 'src/public/**'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    // ⚠️ Не жалуемся на «неиспользованную директиву eslint-disable». В проекте полсотни строк
    // вида `// eslint-disable-next-line @typescript-eslint/no-explicit-any` — они стоят не ради
    // ESLint (его не было), а ради правила CLAUDE.md «any и @ts-ignore объяснены комментарием»,
    // и это правило проверяет conventions-check. Для нас они документация, а не мусор.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        // Разбор типов обязателен для no-floating-promises: без него правило не знает, что
        // возвращает вызов, и молчит.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
);
