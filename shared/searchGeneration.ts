// Разные провайдеры называют нормальное завершение по-разному. Обрезку не принимаем за ответ.
export function assertSearchGenerationComplete(stopReason: string): void {
  const complete = new Set(['stop', 'end_turn', 'stop_sequence', 'eogtoken', 'stopgenerationtrigger', 'customstoptrigger']);
  if (!complete.has(stopReason.toLowerCase())) throw new Error(`Incomplete search generation: ${stopReason}`);
}
