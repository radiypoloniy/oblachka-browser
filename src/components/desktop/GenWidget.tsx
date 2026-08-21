import { useEffect, useMemo, useRef, useState } from 'react';
import { Tile, TileCaption, type WidgetProps } from './widgets';
import { DISPLAY } from '../../styles/system';
import {
  GEN_TOKEN_VARS, wrapGenSrcdoc, clampGenStorage, wantsGenPhoto, type GenFactId,
} from '../../../shared/genWidget';
import { loadGenRecord, loadGenState, saveGenState, storeGenPhoto, subscribeGenStore } from '../../newtab/genStore';
import { genFontCss } from '../../newtab/genFonts';

// Свой виджет: рамка стола наша, внутренности — одностраничник в песочнице.
// sandbox без allow-same-origin: скрипт не видит window.oblako родителя.
// Фото рисует хост на всю плитку: в iframe нет шрифтов и нет <input type=file>.

export function GenWidget({
  fill, overImage, hero, genId, box,
}: WidgetProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [rev, setRev] = useState(0);
  const [fonts, setFonts] = useState('');
  useEffect(() => subscribeGenStore(() => setRev((n) => n + 1)), []);
  useEffect(() => { void genFontCss().then(setFonts); }, []);
  const rec = useMemo(() => (genId ? loadGenRecord(genId) : null), [genId, rev]);
  const [facts, setFacts] = useState<Record<string, number | string>>({});

  useEffect(() => {
    let alive = true;
    void collectFacts(rec?.facts ?? []).then((f) => { if (alive) setFacts(f); });
    return () => { alive = false; };
  }, [rec]);

  const photo = !!(rec && wantsGenPhoto(rec.phrase ?? '', rec.html, rec.photo === true));
  const photoData = rec?.photoData;
  const tokens = useMemo(() => {
    const t = readTokens();
    const num = Math.round(Math.min((box.width - 32) * 0.22, box.height * 0.34, 56));
    t['--gen-num'] = `${Math.max(28, num)}px`;
    return t;
  }, [rev, fill, hero, overImage, box.width, box.height]);

  const srcDoc = useMemo(() => {
    if (!rec || !genId || photo) return '';
    return wrapGenSrcdoc(rec.html, tokens, genId, fonts);
  }, [rec, tokens, genId, fonts, photo]);

  const assets = useMemo(
    () => (photoData ? { photo: photoData } : {}),
    [photoData],
  );

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
      if (data.type === 'oblako-gen-pick-photo') {
        fileRef.current?.click();
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
    if (!file || !genId) return;
    const raw = await readFileDataUrl(file);
    const ok = await storeGenPhoto(genId, raw);
    if (!ok) console.warn('[gen-widget] фото не влезло в хранилище');
  }

  const pick = (): void => { fileRef.current?.click(); };

  return (
    <Tile surface toned fill={fill} overImage={overImage} hero={hero} padding={0}>
      {photo && photoData && (
        <img
          src={photoData}
          alt=""
          onClick={pick}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', display: 'block',
          }}
        />
      )}
      {photo && !photoData && (
        <button type="button" onClick={pick} style={{
          position: 'absolute', inset: 0, border: 'none', cursor: 'default',
          background: 'transparent', color: 'inherit',
          display: 'flex', flexDirection: 'column', padding: 16, gap: 8, textAlign: 'left',
        }}>
          <TileCaption>Фото</TileCaption>
          <div style={{
            ...DISPLAY, fontSize: Math.round(Math.min(box.width * 0.14, 28)),
            fontWeight: 600, color: 'var(--text-strong)',
          }}>
            Выберите фото
          </div>
        </button>
      )}
      {!photo && srcDoc && (
        <iframe
          ref={frameRef}
          title="Свой виджет"
          sandbox="allow-scripts"
          srcDoc={srcDoc}
          style={{ width: '100%', height: '100%', border: 'none', display: 'block', background: 'transparent' }}
        />
      )}
      {!photo && !srcDoc && (
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
    if (k === '--gen-num') continue;
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
