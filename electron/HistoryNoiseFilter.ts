// Совместимый вход к фильтру шума истории. Сама политика — shared/historyIndex.ts
// (прогон npm test -- history-index). Не дублировать списки паттернов здесь.
export { isNoisyForEmbedding, classifyHistoryNoise } from '../shared/historyIndex';
