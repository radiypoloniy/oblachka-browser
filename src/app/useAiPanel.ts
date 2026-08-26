import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

// Заход 3 — AI-хаб: поповер стал правым доком, который тянется как split.
// ⚠️ Клампы дублируют electron/AiPanelManager.ts (главный источник истины — там; здесь только
// живой визуальный превью во время драга, до подтверждения основным процессом).
const AI_PANEL_WIDTH_MIN = 300;
const AI_PANEL_WIDTH_MAX = 640;

/**
 * Правый AI-док: открыт ли, какой ширины и как эту ширину тянут за делитель.
 * Три куска одной темы, которые до разбора лежали в трёх концах App.tsx.
 */
export function useAiPanel() {
  // ⚠️ Источник истины для open — MAIN, а не локальный тоггл: крестик и Escape внутри самой
  // панели тоже меняют состояние, и о них чром узнаёт только push-ом
  // (см. AiPanelManager.ts::setOpenState). Тот же принцип, что у остальных push-состояний.
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [aiPanelWidth, setAiPanelWidthState] = useState(360);
  const [isAiPanelDragging, setIsAiPanelDragging] = useState(false);

  // Персистентная ширина — читаем один раз при маунте (как hubMode/searchEngine в Settings.tsx),
  // дальше живёт в локальном стейте и обновляется во время драга.
  useEffect(() => {
    void window.oblako.getAiPanelWidth().then(setAiPanelWidthState);
  }, []);

  useEffect(() => {
    const unsub = window.oblako.onAiPanelStateChanged(setAiPanelOpen);
    return () => unsub();
  }, []);

  // ⚠️ Та же схема pointer capture, что у разделителя сплита в App.tsx, только ширина считается
  // от ПРАВОГО края контейнера (тянем левый край дока влево/вправо), а не ratio от левого.
  // Контейнер — тот же самый div, что содержит и contentRef, и этот разделитель, и spacer дока
  // (см. JSX): его правая граница совпадает с правым краем окна-контента.
  const aiPanelContainerRef = useRef<HTMLDivElement>(null);

  const handleAiDividerPointerDown = useCallback((e: ReactPointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setIsAiPanelDragging(true);
  }, []);

  const handleAiDividerPointerMove = useCallback((e: ReactPointerEvent) => {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    const container = aiPanelContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const width = Math.max(AI_PANEL_WIDTH_MIN, Math.min(AI_PANEL_WIDTH_MAX, rect.right - e.clientX));
    setAiPanelWidthState(width);
    window.oblako.resizeAiPanel(width);
  }, []);

  const handleAiDividerPointerUp = useCallback((_e: ReactPointerEvent) => {
    setIsAiPanelDragging(false);
  }, []);

  // Открыть/закрыть просит main: он же и ответит push-ом выше, поэтому своего setState тут нет.
  const toggleAiPanel = useCallback(() => { void window.oblako.toggleAiPanel(); }, []);

  return {
    aiPanelOpen, aiPanelWidth, isAiPanelDragging,
    aiPanelContainerRef, toggleAiPanel,
    handleAiDividerPointerDown, handleAiDividerPointerMove, handleAiDividerPointerUp,
  };
}
