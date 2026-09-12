// Источник кадра в редакторе: страница / окно / вырез элемента с живой страницы.

import { useCallback, useEffect, useRef, useState } from 'react';
import { cropReady, parseViewportFrac, viewportFracToShot } from '../../shared/screenshotMarkup';
import { cropShot, loadShot } from './paint';
import type { ShotSource } from './SourceSeg';

export function useShotSource(pageRaw: string): {
  source: ShotSource;
  working: string;
  capturing: boolean;
  failed: boolean;
  bake: (next: string) => void;
  choose: (next: ShotSource) => void;
  pickElement: () => void;
} {
  const [source, setSource] = useState<ShotSource>('page');
  const [working, setWorking] = useState(pageRaw);
  const [capturing, setCapturing] = useState(false);
  const [failed, setFailed] = useState(false);
  const pageRef = useRef(pageRaw);
  const sourceRef = useRef(source);
  const lock = useRef(false);
  sourceRef.current = source;

  useEffect(() => {
    pageRef.current = pageRaw;
    setWorking(pageRaw);
    setSource('page');
    setFailed(false);
  }, [pageRaw]);

  const bake = useCallback((next: string) => {
    setWorking(next);
    if (sourceRef.current === 'page') pageRef.current = next;
  }, []);

  const choose = useCallback((next: ShotSource) => {
    if (lock.current) return;
    setFailed(false);
    if (next === 'page') {
      setSource('page');
      setWorking(pageRef.current);
      return;
    }
    lock.current = true;
    setCapturing(true);
    void window.screenshotOverlay.captureWindow()
      .then((url) => {
        if (!url) { setFailed(true); return; }
        setSource('window');
        setWorking(url);
      })
      .catch(() => { setFailed(true); })
      .finally(() => {
        lock.current = false;
        setCapturing(false);
      });
  }, []);

  const pickElement = useCallback(() => {
    if (lock.current) return;
    lock.current = true;
    setFailed(false);
    setCapturing(true);
    void window.screenshotOverlay.pickElement()
      .then(async (raw) => {
        const frac = parseViewportFrac(raw);
        if (!frac) return;
        const img = await loadShot(pageRef.current);
        const r = viewportFracToShot(frac, { width: img.naturalWidth, height: img.naturalHeight });
        if (!cropReady(r)) return;
        const url = await cropShot(pageRef.current, r);
        pageRef.current = url;
        setSource('page');
        setWorking(url);
      })
      .catch(() => { /* Esc / вкладка умерла — редактор как был */ })
      .finally(() => {
        lock.current = false;
        setCapturing(false);
      });
  }, []);

  return { source, working, capturing, failed, bake, choose, pickElement };
}
