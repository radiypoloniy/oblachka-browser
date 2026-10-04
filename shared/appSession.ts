import type { AppSessionSnapshot, SavedClosedWindow, SavedNode, SavedWindow, SessionSnapshot } from './session';

const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const optionalStrings = (v: Record<string, unknown>, keys: string[]) => keys.every(k => v[k] === undefined || typeof v[k] === 'string');
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function validNodes(nodes: unknown, depth = 0): nodes is SavedNode[] {
  if (!Array.isArray(nodes) || depth > 64) return false;
  return nodes.every(n => {
    if (!record(n)) return false;
    if (n.type === 'single') return typeof n.url === 'string' && optionalStrings(n, ['key', 'title', 'faviconData', 'profileId']);
    if (n.type === 'split-pair') return typeof n.leftUrl === 'string' && typeof n.rightUrl === 'string' && finite(n.ratio)
      && optionalStrings(n, ['leftKey', 'rightKey', 'leftTitle', 'rightTitle', 'leftFaviconData', 'rightFaviconData', 'leftProfileId', 'rightProfileId', 'leftGroupId', 'rightGroupId'])
      && ['leftStackKeys', 'rightStackKeys'].every(k => { const ids = n[k]; return ids === undefined || (Array.isArray(ids) && ids.every(id => typeof id === 'string')); });
    return n.type === 'group' && typeof n.id === 'string' && typeof n.label === 'string'
      && (n.color === null || typeof n.color === 'string') && typeof n.collapsed === 'boolean' && validNodes(n.children, depth + 1);
  });
}

export function decodeWindowSnapshot(v: unknown): SessionSnapshot | null {
  if (!record(v) || !Array.isArray(v.pinnedTabs) || !validNodes(v.nodes) || !record(v.activeRef)) return null;
  if (!v.pinnedTabs.every(t => record(t) && typeof t.url === 'string' && optionalStrings(t, ['title', 'faviconData', 'profileId']))) return null;
  const r = v.activeRef;
  const index = (value: unknown) => Number.isInteger(value) && Number(value) >= 0;
  const valid = r.type === 'hub' || (r.type === 'key' && typeof r.key === 'string')
    || (r.type === 'url' && typeof r.url === 'string') || (r.type === 'pinned' && index(r.index))
    || (r.type === 'normal' && index(r.nodeIndex)) || (r.type === 'split' && index(r.nodeIndex) && (r.side === 'left' || r.side === 'right'));
  return valid ? { pinnedTabs: v.pinnedTabs as SessionSnapshot['pinnedTabs'], nodes: v.nodes, activeRef: r as SessionSnapshot['activeRef'] } : null;
}

function decodeWindow(v: unknown): SavedWindow | null {
  if (!record(v) || typeof v.id !== 'string' || !v.id || (v.maximized !== undefined && typeof v.maximized !== 'boolean')) return null;
  const snapshot = decodeWindowSnapshot(v.snapshot);
  if (!snapshot) return null;
  const result: SavedWindow = { id: v.id, snapshot };
  if (v.bounds !== undefined) {
    const b = v.bounds;
    if (!record(b) || ![b.x, b.y, b.width, b.height].every(finite) || Number(b.width) <= 0 || Number(b.height) <= 0) return null;
    result.bounds = { x: Number(b.x), y: Number(b.y), width: Number(b.width), height: Number(b.height) };
  }
  if (typeof v.maximized === 'boolean') result.maximized = v.maximized;
  return result;
}

export function decodeAppSession(v: unknown): AppSessionSnapshot | null {
  if (!record(v) || v.version !== 6 || typeof v.savedAt !== 'string' || !Array.isArray(v.windows) || !Array.isArray(v.closedWindows)) return null;
  const ids = new Set<string>();
  const windows: SavedWindow[] = [];
  const closedWindows: SavedClosedWindow[] = [];
  for (const value of v.windows) {
    const w = decodeWindow(value);
    if (!w || ids.has(w.id)) return null;
    ids.add(w.id); windows.push(w);
  }
  for (const value of v.closedWindows) {
    const w = decodeWindow(value);
    if (!w || ids.has(w.id) || !record(value) || !finite(value.closedAt)) return null;
    ids.add(w.id); closedWindows.push({ ...w, closedAt: value.closedAt });
  }
  if (v.focusedWindowId !== undefined && (typeof v.focusedWindowId !== 'string' || !windows.some(w => w.id === v.focusedWindowId))) return null;
  return { windows, closedWindows, ...(typeof v.focusedWindowId === 'string' ? { focusedWindowId: v.focusedWindowId } : {}) };
}

export function hasSavedTabs(snapshot: SessionSnapshot): boolean {
  return snapshot.pinnedTabs.length > 0 || snapshot.nodes.length > 0;
}

// Закреплённые окна не подчиняются лимиту обычной истории закрытых окон.
export function trimClosedWindows(windows: SavedClosedWindow[], limit = 20): SavedClosedWindow[] {
  let normal = 0;
  return [...windows].sort((a, b) => b.closedAt - a.closedAt).filter(w => w.snapshot.pinnedTabs.length > 0 || normal++ < limit);
}
