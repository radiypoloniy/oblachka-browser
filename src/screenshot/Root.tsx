// Корень карточки снимка: IPC, автоскрытие, переключение в редактор.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ShotCard } from './Card';
import { decorate } from './decorate';
import { ShotEditor } from './Editor';

const AUTO_HIDE_MS = 10_000;
const AFTER_SAVE_MS = 2600;

export function ScreenshotRoot(): ReactNode {
  const [mode, setMode] = useState<'card' | 'edit'>('card');
  const [raw, setRaw] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [life, setLife] = useState<{ ms: number; at: number } | null>(null);

  const shotRef = useRef<string | null>(null);
  const savedRef = useRef<string | null>(null);
  const busyRef = useRef(false);
  const hoverRef = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  const scheduleHide = useCallback(function schedule(ms: number): void {
    if (modeRef.current === 'edit') return;
    setLife({ ms, at: Date.now() });
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (hoverRef.current) { schedule(1500); return; }
      if (modeRef.current === 'edit') return;
      window.screenshotOverlay.close();
    }, ms);
  }, []);

  const stopHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = null;
    setLife(null);
  }, []);

  const doSave = useCallback(async (url?: string) => {
    const cur = url ?? shotRef.current;
    if (!cur || savedRef.current || busyRef.current) return;
    busyRef.current = true;
    const file = await window.screenshotOverlay.save(cur);
    busyRef.current = false;
    if (file) {
      savedRef.current = file;
      setSaved(file);
      scheduleHide(AFTER_SAVE_MS);
    } else {
      setFailed(true);
      scheduleHide(AUTO_HIDE_MS);
    }
  }, [scheduleHide]);

  const enterCard = useCallback(() => {
    setMode('card');
    window.screenshotOverlay.setMode('card');
    scheduleHide(AUTO_HIDE_MS);
  }, [scheduleHide]);

  const applyRaw = useCallback((nextRaw: string, thenSave: boolean) => {
    setRaw(nextRaw);
    void decorate(nextRaw).then((url) => {
      shotRef.current = url;
      setShot(url);
      enterCard();
      if (thenSave) void doSave(url);
    });
  }, [doSave, enterCard]);

  useEffect(() => {
    const unsubShot = window.screenshotOverlay.onShot((incoming) => {
      savedRef.current = null;
      busyRef.current = false;
      setSaved(null);
      setFailed(false);
      setCopied(false);
      setRaw(incoming);
      setMode('card');
      window.screenshotOverlay.setMode('card');
      void decorate(incoming).then((url) => {
        shotRef.current = url;
        setShot(url);
        scheduleHide(AUTO_HIDE_MS);
      });
    });
    const unsubSave = window.screenshotOverlay.onSaveRequest(() => { void doSave(); });
    return () => { unsubShot(); unsubSave(); };
  }, [doSave, scheduleHide]);

  useEffect(() => {
    if (mode !== 'card' || !shot) return;
    const el = cardRef.current;
    if (!el) return;
    const report = () => window.screenshotOverlay.reportHeight(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode, shot]);

  if (mode === 'edit' && raw) {
    return (
      <ShotEditor
        raw={raw}
        onDone={(next) => applyRaw(next, false)}
        onSave={(next) => applyRaw(next, true)}
        onCancel={enterCard}
      />
    );
  }

  if (!shot) return null;

  return (
    <ShotCard
      shot={shot}
      saved={saved}
      failed={failed}
      copied={copied}
      life={life}
      cardRef={cardRef}
      onHover={(over) => { hoverRef.current = over; }}
      onCopy={() => {
        window.screenshotOverlay.copy(shot);
        setCopied(true);
        scheduleHide(AFTER_SAVE_MS);
      }}
      onSave={() => { void doSave(); }}
      onEdit={() => {
        if (savedRef.current) return;
        stopHide();
        setMode('edit');
        window.screenshotOverlay.setMode('edit');
      }}
      onClose={() => window.screenshotOverlay.close()}
      onReveal={(file) => window.screenshotOverlay.reveal(file)}
    />
  );
}
