import { useEffect, useMemo, useRef, useState } from 'react';
import { Tile, type WidgetProps } from './widgets';
import {
  GEN_TOKEN_VARS, wrapGenSrcdoc, clampGenStorage, type GenFactId,
} from '../../../shared/genWidget';
import { loadGenRecord, loadGenState, saveGenState, subscribeGenStore } from '../../newtab/genStore';

// Свой виджет: рамка стола наша, внутренности — одностраничник в песочнице.
// sandbox без allow-same-origin: скрипт не видит window.oblako родителя.

export function GenWidget({
  fill, overImage, hero, genId,
}: WidgetProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
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

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame || !genId) return;
    const sendFacts = () => {
      frame.contentWindow?.postMessage({ type: 'oblako-gen-facts', facts, assets: {} }, '*');
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
  }, [genId, facts]);

  return (
    <Tile surface toned fill={fill} overImage={overImage} hero={hero} padding={0}>
      {srcDoc ? (
        <iframe
          ref={frameRef}
          title="Свой виджет"
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: 'transparent' }}
        />
      ) : (
        <div style={{
          padding: 16, fontSize: 'var(--fs-sm)', color: 'var(--text-faint)',
        }}>
          Виджет ещё не собран
        </div>
      )}
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

async function collectFacts(wanted: GenFactId[]): Promise<Record<string, number | string>> {
  const need = new Set(wanted.length ? wanted : ['openTabs', 'sessionBlocks', 'taskCount'] as GenFactId[]);
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
