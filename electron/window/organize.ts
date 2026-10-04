import type { WebContents } from 'electron';
import type { OrganizeProposal } from '../../shared/ipc';
import { suggestGroups } from '../TabOrganizer';
import { contextFromSender } from '../WindowRegistry';

export async function suggestWindowGroups(sender: WebContents): Promise<OrganizeProposal> {
  const owner = contextFromSender(sender);
  if (!owner) return { ok: true, clusters: [], modelWasCold: false };
  const abort = new AbortController();
  const closed = () => abort.abort();
  owner.win.once('closed', closed);
  try {
    return await suggestGroups(owner.tabs, abort.signal);
  } finally {
    owner.win.removeListener('closed', closed);
  }
}
