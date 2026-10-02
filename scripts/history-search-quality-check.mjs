// Тот же настоящий SQLite-стенд; режим проверки не перезаписывает сохранённые отчёты.
process.argv.push('--check');
await import('./history-search-quality-bench.mjs');
console.log('ok качество поиска: 18 вопросов, сохранённые кандидаты и 12 полезных фрагментов для AI');
