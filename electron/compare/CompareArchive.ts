import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { getActiveProfile } from '../ProfileStore';
import { profileDataPath } from '../ProfilePaths';
import { allContexts } from '../WindowRegistry';
import { IPC } from '../../shared/ipc';
import type { CompareState } from '../../shared/tabCompare';
import { CompareArchiveStore } from './CompareArchiveStore';

let opened: { profile: string; store: CompareArchiveStore } | null = null;
export function compareArchive(): CompareArchiveStore {
  const profile = getActiveProfile().id;
  if (opened?.profile !== profile) {
    opened?.store.close(); opened = null;
    opened = { profile, store: new CompareArchiveStore(profileDataPath(profile, 'comparisons.sqlite')) };
  }
  return opened.store;
}
export function archiveChanged(): void {
  for (const ctx of allContexts()) if (!ctx.win.isDestroyed()) ctx.chromeView.webContents.send(IPC.COMPARE_ARCHIVE_CHANGED);
}
export function saveCompareSnapshot(state: CompareState): void {
  if (state.products.length < 2) return;
  try {
    const store = compareArchive(), previous = state.archiveId ? store.get(state.archiveId) : null, now = Date.now();
    const payload = { products: state.products, rows: state.rows, advice: state.advice, via: state.via, connectionId: state.connectionId };
    const canonical = (value: typeof payload) => JSON.stringify({ ...value, products: value.products.map(p => ({ ...p, tabId: '' })) });
    if (previous && canonical(payload) === canonical({ products: previous.products, rows: previous.rows, advice: previous.advice, via: previous.via, connectionId: previous.connectionId })) { state.archiveError = ''; return; }
    const id = state.archiveId ?? randomUUID();
    store.save({ version: 1, id, createdAt: previous?.createdAt ?? now, updatedAt: now,
      ...payload });
    state.archiveId = id; state.archiveError = ''; archiveChanged();
  } catch {
    state.archiveError = 'Не удалось сохранить сравнение. Этот разбор пока доступен только в открытой вкладке.';
  }
}
app.once('will-quit', () => { opened?.store.close(); opened = null; });
