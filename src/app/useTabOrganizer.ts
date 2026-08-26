import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClusterProposal, SidebarNode, TabState } from '../../shared/ipc';

/**
 * «Навести порядок»: предложить группы, применить, назвать вкладки по-человечески и откатить
 * любую из двух половин. Наличие снимков для отката приходит снаружи — им владеет синхронизация
 * с main, а не этот флоу.
 */
export function useTabOrganizer(opts: {
  tabs: TabState[];
  sidebarNodes: SidebarNode[];
  hasOrganizeSnapshot: boolean;
  hasRenameSnapshot: boolean;
}) {
  const { tabs, sidebarNodes, hasOrganizeSnapshot, hasRenameSnapshot } = opts;

  const [organizeState, setOrganizeState] = useState<'idle' | 'computing' | 'preview' | 'model-error'>('idle');
  const [organizeProposal, setOrganizeProposal] = useState<ClusterProposal[]>([]);
  // Сколько имён уже придумано из скольких — вторая половина «навести порядок» идёт секундами
  // на вкладку, и без счётчика она выглядит зависанием.
  const [renameProgress, setRenameProgress] = useState<{ done: number; total: number } | null>(null);
  // Баннер отката человек уже видел и закрыл (или он погас сам по таймеру). Снимок в main при
  // этом жив — но навязывать плашку до конца сеанса незачем.
  const [undoDismissed, setUndoDismissed] = useState(false);
  // Какой текст показывать в 'computing' — спрашиваем факт (getLoadedModelId()) ДО вызова
  // suggestGroups(), а не гадаем по времени: таймер на фиксированный порог однажды дал ложное
  // срабатывание (тёплый прогон уложился в 4070мс при пороге 4000мс — сообщение о загрузке начало
  // бы мелькать при уже тёплой модели). См. handleOrganize.
  const [organizeLongWait, setOrganizeLongWait] = useState(false);

  // Реф с актуальным значением — нужен для organize (читается вне рендер-цикла, при построении
  // titles для превью из ответа suggestGroups()).
  const allTabsRef = useRef(tabs);
  allTabsRef.current = tabs;

  // Количество незакреплённых, негруппированных вкладок-единиц верхнего уровня.
  // GroupNode и pinned в счёт не идут — только top-level single + split-pair.
  const organizeTabsCount = sidebarNodes.filter(
    (n) => n.type === 'single' || n.type === 'split-pair',
  ).length;

  const handleOrganize = useCallback(() => {
    if (organizeState === 'computing') return
    setOrganizeState('computing');
    // Спрашиваем факт (была ли модель загружена ДО вызова), а не гадаем по времени — см. комментарий
    // у organizeLongWait. Если модель загрузится между этим вызовом и suggestGroups() (маловероятно,
    // но возможно) — покажем длинное сообщение зря на секунду-другую, ответ придёт быстро и оно
    // само исчезнет; ложная тревога в редком случае лучше, чем мелькание в обычном.
    void window.oblako.getLoadedModelId().then((loadedId) => {
      setOrganizeLongWait(loadedId === null);
      return window.oblako.suggestGroups();
    }).then((proposal) => {
      if (!proposal.ok) { setOrganizeState('model-error'); return; }
      // suggestGroups() возвращает OrganizeCluster[] (без titles) — превью в Sidebar рисует titles
      // (см. ClusterProposal), достаём их здесь же из актуального списка вкладок.
      const tabMap = new Map(allTabsRef.current.map((x) => [x.id, x]));
      const proposals: ClusterProposal[] = proposal.clusters.map((c) => ({
        nodeIds: c.nodeIds,
        nodeTypes: c.nodeTypes,
        titles: c.nodeIds.map((id) => tabMap.get(id)?.title ?? ''),
        suggestedName: c.label,
      }));
      setOrganizeProposal(proposals);
      setOrganizeState('preview');
    }).catch(() => {
      setOrganizeState('model-error');
    });
  }, [organizeState]);

  // Прогресс массового переименования: приезжает push'ем из main по одному имени.
  useEffect(() => window.oblako.onRenameProgress((p) => {
    setRenameProgress(p.done >= p.total ? null : p);
  }), []);

  // ⚠️ Баннер отката гаснет сам. Раньше он висел, пока человек не тронет вкладки руками, —
  // то есть в спокойном сеансе бесконечно, занимая место в полосе вкладок и намекая на
  // незавершённое действие. Пятнадцать секунд — столько живёт «Отменить» у почтовых клиентов:
  // хватает передумать, но плашка не становится частью интерфейса.
  useEffect(() => {
    if (undoDismissed) return;
    if (!hasOrganizeSnapshot && !hasRenameSnapshot) return;
    if (renameProgress) return; // пока имена ещё придумываются, отсчёт не начинаем
    const t = setTimeout(() => setUndoDismissed(true), 15000);
    return () => clearTimeout(t);
  }, [hasOrganizeSnapshot, hasRenameSnapshot, renameProgress, undoDismissed]);

  const handleOrganizeApply = useCallback(() => {
    if (organizeProposal.length === 0) { setOrganizeState('idle'); return; }
    const clusters = organizeProposal.map((p) => ({
      nodeIds:   p.nodeIds,
      nodeTypes: p.nodeTypes,
      label:     p.suggestedName,
    }));
    void window.oblako.organizeApply(clusters);
    setOrganizeState('idle');
    setOrganizeProposal([]);
    // «Навести порядок» — это два действия подряд: разложить по группам и назвать по-человечески.
    // Второе запускаем сразу за первым, не спрашивая отдельно: человек уже сказал, чего хочет.
    setUndoDismissed(false);
    void window.oblako.renameAllTabs();
  }, [organizeProposal]);

  const handleOrganizeCancel = useCallback(() => {
    setOrganizeState('idle');
    setOrganizeProposal([]);
  }, []);

  // Три отката: только названия, только группы, всё разом. Порознь — потому что «навести
  // порядок» делает два разных дела, и человеку может понравиться одно, но не другое.
  const handleOrganizeRollback = useCallback(() => {
    void window.oblako.organizeRollback();
    setUndoDismissed(true);
  }, []);

  const handleRenameRollback = useCallback(() => {
    void window.oblako.rollbackRenames();
    setUndoDismissed(true);
  }, []);

  // Плашку закрыли рукой — снимок в main при этом остаётся жив.
  const dismissUndo = useCallback(() => setUndoDismissed(true), []);

  const handleRollbackAll = useCallback(() => {
    void window.oblako.rollbackRenames();
    void window.oblako.organizeRollback();
    setUndoDismissed(true);
  }, []);

  return {
    organizeTabsCount, organizeState, organizeLongWait, organizeProposal,
    renameProgress, undoDismissed, dismissUndo,
    handleOrganize, handleOrganizeApply, handleOrganizeCancel,
    handleOrganizeRollback, handleRenameRollback, handleRollbackAll,
  };
}
