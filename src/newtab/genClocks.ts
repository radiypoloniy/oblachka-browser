import { genClockLeftMs, type GenClock } from '../../shared/genWidget';
import { listGenClockIds, loadGenClock, saveGenClock } from './genStore';

// Ход таймера стола — в хроме окна, не в iframe новой вкладки.
// Ушли на сайт: DesktopScreen снимается, setInterval в песочнице умирает.
// endAt лежит на диске, здесь только сигнал, когда время вышло.

export function watchGenClocks(): () => void {
  const tick = (): void => {
    const now = Date.now();
    for (const id of listGenClockIds()) {
      const clock = loadGenClock(id);
      if (!clock || clock.endAt <= 0 || clock.beeped) continue;
      if (genClockLeftMs(clock, now) > 0) continue;
      saveGenClock(id, { ...clock, endAt: 0, leftMs: 0, beeped: true });
      genTimerBeep();
    }
  };
  const t = window.setInterval(tick, 400);
  tick();
  return () => window.clearInterval(t);
}

function genTimerBeep(): void {
  try {
    const ctx = new AudioContext();
    const offsets = [0, 0.28, 0.56];
    for (const off of offsets) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + off);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + off + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + off + 0.22);
      osc.start(ctx.currentTime + off);
      osc.stop(ctx.currentTime + off + 0.24);
    }
    window.setTimeout(() => { void ctx.close(); }, 1200);
  } catch { /* нет звука — цифра на плитке всё равно станет 0:00 */ }
}

export function startGenClock(id: string, durationMs: number, prev?: GenClock | null): void {
  const left = prev && prev.endAt === 0 && prev.leftMs > 0 ? prev.leftMs : durationMs;
  saveGenClock(id, {
    endAt: Date.now() + left,
    durationMs,
    leftMs: left,
    beeped: false,
  });
}

export function pauseGenClock(id: string, clock: GenClock): void {
  saveGenClock(id, {
    ...clock,
    endAt: 0,
    leftMs: genClockLeftMs(clock),
    beeped: false,
  });
}

export function resetGenClock(id: string, durationMs: number): void {
  saveGenClock(id, { endAt: 0, durationMs, leftMs: durationMs, beeped: false });
}
