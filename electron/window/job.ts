import type { BrowserWindow } from 'electron';

// Закрытие владельца отменяет только его работу, не общий runtime и очередь.
export async function withWindowJob<T>(win: BrowserWindow, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const abort = new AbortController();
  const closed = () => abort.abort();
  win.once('closed', closed);
  if (win.isDestroyed()) closed();
  try { return await run(abort.signal); }
  finally { win.removeListener('closed', closed); }
}
