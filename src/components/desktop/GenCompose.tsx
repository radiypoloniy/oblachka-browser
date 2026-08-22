import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { CellSize, DesktopItem, DesktopLayout } from '../../newtab/desktop';
import { pickGenFacts, wantsGenPhoto } from '../../../shared/genWidget';
import { saveGenRecord, deleteGenRecord, listGenLibrary, loadGenRecord, subscribeGenStore } from '../../newtab/genStore';
import { GenWidget } from './GenWidget';
import { RADIUS, TEXT, motion, pad, sp } from '../../styles/system';
import type { GenParseOutcome } from '../../../shared/ipc';

const DRAFT_ID = 'gen-draft';

/** Высота превью черновика: ниже плитка перестаёт быть похожа на себя же на столе. */
const PREVIEW_H = 140;

export default function GenCompose({
  onPlace,
  already,
}: {
  onPlace: (item: Omit<DesktopItem, 'id'>) => void;
  already?: (widget: string) => boolean;
}) {
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Extract<GenParseOutcome, { ok: true }> | null>(null);

  useEffect(() => () => { deleteGenRecord(DRAFT_ID); }, []);

  async function assemble() {
    const p = phrase.trim();
    if (p.length < 3 || busy) return;
    setBusy(true);
    setError('');
    setDraft(null);
    try {
      const res = await window.oblako.parseGenWidget(p);
      if (!res.ok) {
        setError(res.reason === 'model-error'
          ? (res.error || 'Модель не ответила. Нужна скачанная локальная модель.')
          : 'Не собрал. Попробуйте другими словами или поставьте готовый виджет.');
        return;
      }
      if (res.kind === 'gen') {
        saveGenRecord(DRAFT_ID, {
          html: res.html,
          facts: pickGenFacts(res.facts),
          mode: res.mode,
          photo: res.assetPhoto || wantsGenPhoto(p, res.html, false),
          phrase: p,
          title: res.title,
          size: res.size,
        });
      }
      setDraft(res);
    } catch {
      setError('Не удалось обратиться к модели');
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    if (!draft) return;
    if (draft.kind === 'builtin') {
      if (already?.(draft.widget)) {
        setError('Этот виджет уже на столе');
        return;
      }
      onPlace({ kind: 'widget', widget: draft.widget, size: draft.size });
      setDraft(null);
      setPhrase('');
      return;
    }
    const genId = `g${Date.now().toString(36)}`;
    saveGenRecord(genId, {
      html: draft.html,
      facts: pickGenFacts(draft.facts),
      mode: draft.mode,
      photo: draft.assetPhoto || wantsGenPhoto(phrase, draft.html, false),
      phrase,
      title: draft.title,
      size: draft.size,
    });
    deleteGenRecord(DRAFT_ID);
    onPlace({
      kind: 'widget', widget: 'gen', genId, size: draft.size as CellSize, title: draft.title,
    });
    setDraft(null);
    setPhrase('');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(3) }}>
      <div style={{ ...TEXT.caption }}>
        Опишите виджет своими словами. Модель соберёт одностраничник, поставите вы.
      </div>
      <textarea
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
        rows={2}
        placeholder="Помодоро, фоторамка, сколько вкладок открыто…"
        style={{
          width: '100%', resize: 'vertical', minHeight: sp(8) * 2,
          padding: pad(2, 3), borderRadius: RADIUS.control,
          border: '1px solid var(--divider-strong)', background: 'var(--surface)',
          ...TEXT.body, fontFamily: 'inherit', boxSizing: 'border-box', outline: 'none',
        }}
      />
      <button
        type="button"
        onClick={() => void assemble()}
        disabled={busy || phrase.trim().length < 3}
        style={{
          alignSelf: 'flex-start', padding: pad(2, 4), border: 'none', cursor: 'default',
          borderRadius: RADIUS.pill, background: 'var(--accent)', color: 'var(--on-accent)',
          ...TEXT.body, fontWeight: 600, opacity: busy ? 0.6 : 1,
          transition: motion.hover('opacity', 'background'),
        }}
      >
        {busy ? 'Собираю…' : 'Собрать'}
      </button>
      {error && <div style={{ ...TEXT.body, color: 'var(--danger-500)' }}>{error}</div>}
      {draft && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: sp(2),
          padding: sp(3), borderRadius: RADIUS.box, border: '1px solid var(--divider)',
        }}>
          {draft.kind === 'builtin' && (
            <div style={{ ...TEXT.body, fontWeight: 600, color: 'var(--text-strong)' }}>
              Готовый виджет: {draft.widget}
            </div>
          )}
          {draft.kind === 'gen' && (
            <div style={{ height: PREVIEW_H, borderRadius: RADIUS.control, overflow: 'hidden' }}>
              <GenWidget
                size={draft.size} box={{ width: 240, height: PREVIEW_H }} tiles={[]}
                onOpen={() => { /* превью */ }} city="" genId={DRAFT_ID}
              />
            </div>
          )}
          {draft.kind === 'gen' && draft.assetPhoto && (
            <div style={{ ...TEXT.caption }}>
              После постановки нажмите на плитку и выберите фото.
            </div>
          )}
          <div style={{ display: 'flex', gap: sp(2) }}>
            <button type="button" onClick={confirm} style={{
              padding: pad(2, 4), border: 'none', cursor: 'default',
              borderRadius: RADIUS.pill, background: 'var(--accent)', color: 'var(--on-accent)',
              ...TEXT.body, fontWeight: 600, transition: motion.hover('background'),
            }}>Поставить</button>
            <button type="button" onClick={() => { setDraft(null); deleteGenRecord(DRAFT_ID); }} style={{
              padding: pad(2, 4), border: '1px solid var(--divider-strong)', cursor: 'default',
              borderRadius: RADIUS.pill, background: 'transparent', color: 'var(--text-body)',
              ...TEXT.body, transition: motion.hover('background', 'color'),
            }}>Отмена</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function GenShelf({
  layout,
  onPlace,
  onForget,
}: {
  layout: DesktopLayout;
  onPlace: (item: Omit<DesktopItem, 'id'>) => void;
  onForget: (genId: string) => void;
}) {
  const [lib, setLib] = useState(listGenLibrary);
  const [busyId, setBusyId] = useState<string | null>(null);
  useEffect(() => subscribeGenStore(() => setLib(listGenLibrary())), []);
  if (lib.length === 0) return null;
  const onDesk = new Set(layout.items.map((i) => i.genId).filter((x): x is string => !!x));

  async function rebuild(id: string) {
    const rec = loadGenRecord(id);
    const p = rec?.phrase?.trim();
    if (!p || busyId) return;
    setBusyId(id);
    try {
      const res = await window.oblako.parseGenWidget(p);
      if (res.ok && res.kind === 'gen') {
        saveGenRecord(id, {
          html: res.html,
          facts: pickGenFacts(res.facts),
          mode: res.mode,
          photo: res.assetPhoto || wantsGenPhoto(p, res.html, false),
          phrase: p,
          title: res.title,
          size: res.size,
        });
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2), paddingTop: sp(1) }}>
      {lib.map((it) => {
        const placed = onDesk.has(it.id);
        return (
          <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: sp(2) }}>
            <span style={{
              flex: 1, minWidth: 0, ...TEXT.body,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{it.title}</span>
            {placed ? (
              <button type="button" disabled={busyId === it.id} onClick={() => void rebuild(it.id)} style={ghostBtn}>
                {busyId === it.id ? '…' : 'Пересобрать'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onPlace({
                  kind: 'widget', widget: 'gen', genId: it.id, size: it.size, title: it.title,
                })}
                style={ghostBtn}
              >
                На стол
              </button>
            )}
            <button type="button" onClick={() => onForget(it.id)} title="Забыть" style={ghostBtn}>×</button>
          </div>
        );
      })}
    </div>
  );
}

const ghostBtn: CSSProperties = {
  flex: 'none', padding: pad(1, 2), border: '1px solid var(--divider-strong)', cursor: 'default',
  borderRadius: RADIUS.pill, background: 'transparent', color: 'var(--text-body)',
  ...TEXT.caption, transition: motion.hover('background', 'color'),
};
