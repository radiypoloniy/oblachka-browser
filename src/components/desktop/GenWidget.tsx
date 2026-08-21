import { useEffect, useMemo, useRef, useState } from 'react';
import { Tile, type WidgetProps } from './widgets';
import {
  GEN_TOKEN_VARS, wrapGenSrcdoc, clampGenStorage, type GenFactId,
} from '../../../shared/genWidget';
import { loadGenRecord, loadGenState, saveGenRecord, saveGenState, subscribeGenStore } from '../../newtab/genStore';
import { shrinkBackgroundImage } from '../../newtab/settings';

// Свой виджет: рамка стола наша, внутренности — одностраничник в песочнице.
// sandbox без allow-same-origin: скрипт не видит window.oblako родителя.

export function GenWidget({
  fill, overImage, hero, genId,
}: WidgetProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [rev, setRev] = useState(0);
  useEffect(() => subscribeGenStore(() => setRev((n) => n + 1)), []);
  const rec = useMemo(() => (genId ? loadGenRecord(genId) : null), [genId, rev]);
  const [facts, setFacts] = useState<Record<string, number | string>>({});

  useEffect(() => {
    let alive = true;
    void collectFacts(rec?.facts ?? []).then((f) => { if (alive) setFacts(f); });
    return () => { alive = false; };
  }, [rec]);

  const tokens = useMemo(() => readTokens(), [rev, fill, hero, overImage]);
  const srcDoc = useMemo(() => {
    if (!rec || !genId) return '';
    return wrapGenSrcdoc(rec.html, tokens, genId);
  }, [rec, tokens, genId]);

  const assets = useMemo(
    () => (rec?.photoData ? { photo: rec.photoData } : {}),
    [rec],
  );
  const needPhoto = !!(rec?.photo && !rec.photoData);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !genId) return;
    const sendFacts = () => {
      frame.contentWindow?.postMessage({ type: 'oblako-gen-facts', facts, assets }, '*');
    };
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow) return;
      const data = e.data as { type?: string; widgetId?: string; req?: string; value?: unknown };
      if (!data || data.widgetId !== genId) return;
      if (data.type === 'oblako-gen-ready') {
        sendFacts();
        return;
      }
      if (data.type === 'oblako-gen-storage-get' && data.req) {
        frame.contentWindow?.postMessage({
          type: 'oblako-gen-storage', req: data.req, value: loadGenState(genId),
        }, '*');
        return;
      }
      if (data.type === 'oblako-gen-storage-set') {
        saveGenState(genId, clampGenStorage(data.value));
      }
    };
    window.addEventListener('message', onMsg);
    sendFacts();
    return () => window.removeEventListener('message', onMsg);
  }, [genId, facts, assets]);

  async function onPick(file: File | undefined) {
    if (!file || !genId || !rec) return;
    const raw = await readFileDataUrl(file);
    const small = await shrinkBackgroundImage(raw).catch(() => raw);
    saveGenRecord(genId, { ...rec, photoData: small });
  }

  return (
    <Tile surface toned fill={fill} overImage={overImage} hero={hero} padding={0}>
      {needPhoto ? (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          style={{
            width: '100%', height: '100%', border: 'none', cursor: 'default',
            background: 'transparent', color: 'var(--text-body)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6,
            font: 'inherit',
          }}
        >
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>Фоторамка</span>
          <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>Выберите фото</span>
        </button>
      ) : srcDoc ? (
        <iframe
          ref={frameRef}
          title="Свой виджет"
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: 'transparent' }}
        />
      ) : (
        <div style={{ padding: 16, fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
          Виджет ещё не собран
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => { void onPick(e.target.files?.[0]); e.target.value = ''; }}
      />
    </Tile>
  );
}

function readTokens(): Record<string, string> {
  const cs = getComputedStyle(document.documentElement);
  const out: Record<string, string> = {};
  for (const k of GEN_TOKEN_VARS) {
    const v = cs.getPropertyValue(k).trim();
    if (v) out[k] = v;
  }
  return out;
}

function readFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('read'));
    r.readAsDataURL(file);
  });
}

async function collectFacts(wanted: GenFactId[]): Promise<Record<string, number | string>> {
  const need = new Set(wanted);
  const out: Record<string, number | string> = {};
  try {
    if (need.has('openTabs')) {
      const tabs = await window.oblako.getAllTabs();
      out.openTabs = tabs.filter((t) => t.kind === 'page').length;
    }
  } catch { /* плитка показывает пустое */ }
  try {
    if (need.has('sessionBlocks')) {
      const s = await window.oblako.getAdBlockState();
      out.sessionBlocks = s.sessionBlockCount;
    }
  } catch { /* */ }
  if (need.has('taskCount')) {
    try {
      const raw = localStorage.getItem('oblako-desktop-tasks');
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      out.taskCount = Array.isArray(parsed)
        ? parsed.filter((t) => t && typeof t === 'object' && (t as { done?: boolean }).done !== true).length
        : 0;
    } catch { out.taskCount = 0; }
  }
  return out;
}
