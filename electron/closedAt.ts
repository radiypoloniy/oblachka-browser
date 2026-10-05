import { performance } from 'node:perf_hooks';

// Общие часы вкладок и окон: доли миллисекунды сохраняют порядок быстрых закрытий.
export function closedAtNow(): number {
  return performance.timeOrigin + performance.now();
}
