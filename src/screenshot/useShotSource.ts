// Источник кадра: страница / окно / элемент. История — для Esc по шагам.

import { useCallback, useEffect, useRef, useState } from 'react';
import { cropReady, fracOverlapsView, parseViewportFrac, viewportFracToShot } from '../../shared/screenshotMarkup';
import { compositeLayers, cropShot, loadShot } from './paint';
import type { ShotSource } from './SourceSeg';

type Snap = { working: string; source: ShotSource; page: string; win: string | null };

export function useShotSource(pageRaw: string): {
  source: ShotSource;
  working: string;
  capturing: boolean;
  failed: boolean;
  bake: (next: string) => void;
  choose: (next: ShotSource) => void;
  pickElement: () => void;
  undo: () => boolean;
} {
  const [source, setSource] = useState<ShotSource>('page');
  const [working, setWorking] = useState(pageRaw);
  const [capturing, setCapturing] = useState(false);
  const [failed, setFailed] = useState(false);
  const pageRef = useRef(pageRaw);
  const windowRef = useRef<string | null>(null);
  const sourceRef = useRef(source);
  const hist = useRef<Snap[]>([{ working: pageRaw, source: 'page', page: pageRaw, win: null }]);
  const lock = useRef(false);
  sourceRef.current = source;

  const show = useCallback((snap: Snap) => {
    pageRef.current = snap.page;
    windowRef.current = snap.win;
    sourceRef.current = snap.source;
    setSource(snap.source);
    setWorking(snap.working);
  }, []);

  const commit = useCallback((snap: Snap) => {
    hist.current.push(snap);
    show(snap);
  }, [show]);

  useEffect(() => {
    const init: Snap = { working: pageRaw, source: 'page', page: pageRaw, win: null };
    hist.current = [init];
    show(init);
    setFailed(false);
  }, [pageRaw, show]);

  const bake = useCallback((next: string) => {
    const src = sourceRef.current;
    const page = src === 'page' ? next : pageRef.current;
    const win = src === 'window' ? next : windowRef.current;
    commit({ working: next, source: src, page, win });
  }, [commit]);

  const undo = useCallback((): boolean => {
    if (hist.current.length <= 1) return false;
    hist.current.pop();
    show(hist.current[hist.current.length - 1]!);
    return true;
  }, [show]);

  const choose = useCallback((next: ShotSource) => {
    if (lock.current) return;
    setFailed(false);
    if (next === 'page') {
      if (sourceRef.current === 'page') return;
      commit({ working: pageRef.current, source: 'page', page: pageRef.current, win: windowRef.current });
      return;
    }
    if (sourceRef.current === 'window') return;
    if (windowRef.current) {
      commit({ working: windowRef.current, source: 'window', page: pageRef.current, win: windowRef.current });
      return;
    }
    lock.current = true;
    setCapturing(true);
    void window.screenshotOverlay.captureWindow()
      .then(async (layers) => {
        if (!layers) { setFailed(true); return; }
        const url = await compositeLayers(layers.width, layers.height, layers.layers);
        if (!url) { setFailed(true); return; }
        commit({ working: url, source: 'window', page: pageRef.current, win: url });
      })
      .catch(() => { setFailed(true); })
      .finally(() => { lock.current = false; setCapturing(false); });
  }, [commit]);

  const pickElement = useCallback(() => {
    if (lock.current) return;
    lock.current = true;
    setFailed(false);
    setCapturing(true);
    void window.screenshotOverlay.pickElement()
      .then(async (picked) => {
        if (!picked) return;
        const frac = parseViewportFrac(picked.frac);
        if (!frac || !fracOverlapsView(frac)) return;
        const img = await loadShot(picked.raw);
        const r = viewportFracToShot(frac, { width: img.naturalWidth, height: img.naturalHeight });
        if (!cropReady(r)) return;
        const url = await cropShot(picked.raw, r);
        commit({ working: url, source: 'page', page: url, win: windowRef.current });
      })
      .catch(() => { /* Esc / вкладка умерла */ })
      .finally(() => { lock.current = false; setCapturing(false); });
  }, [commit]);

  return { source, working, capturing, failed, bake, choose, pickElement, undo };
}
