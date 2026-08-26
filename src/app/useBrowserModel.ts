import { useCallback, useEffect, useState } from 'react';
import type { SidebarNode, SyncState, TabState } from '../../shared/ipc';
import { clampSplitRatio } from '../../shared/layout';
import { findActiveSplitPairNode } from '../../shared/nodeTree';

const HUB_ID = 'hub';

/**
 * Модель браузера, как её видит чром: вкладки, дерево сайдбара, активная вкладка и доля сплита —
 * плюс всё, что из них выводится, и действия, которые их меняют.
 *
 * ⚠️ Владелец всего этого — MAIN. Здесь только копия для отрисовки: она приходит одним атомарным
 * сообщением и никогда не правится «на опережение». Действия ниже просят main, а не меняют
 * модель — исключение ровно одно и оговорено у select/newTab.
 *
 * ⚠️ Вызывать ПЕРВЫМ среди хуков App: от activeIncognito зависит тема, от activeId — замер области
 * контента, от tabs/nodes — жест сплита и группировка. Порядок эффектов при этом безразличен:
 * подписка ниже ничего не меняет синхронно, она только заводит канал.
 */
export function useBrowserModel() {
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [sidebarNodes, setSidebarNodes] = useState<SidebarNode[]>([]);
  const [activeId, setActiveId] = useState(HUB_ID);
  const [splitRatio, setSplitRatioState] = useState(0.5);
  // Есть ли в main снимок для отката «навести порядок» — приезжает тем же сообщением, что и
  // дерево, потому что меняется ровно вместе с ним (см. useTabOrganizer, который это читает).
  const [hasOrganizeSnapshot, setHasOrganizeSnapshot] = useState(false);
  const [hasRenameSnapshot, setHasRenameSnapshot] = useState(false);

  // Атомарная подписка: tabs + nodes в одном IPC-сообщении → один рендер, нет рассинхрона.
  useEffect(() => {
    const applySync = (s: SyncState) => {
      setTabs(s.tabs);
      setSidebarNodes(s.nodes);
      setHasOrganizeSnapshot(s.hasOrganizeSnapshot);
      setHasRenameSnapshot(s.hasRenameSnapshot);
      const active = s.tabs.find((x) => x.isActive);
      if (active) setActiveId(active.id);
      // Та же пара, что реально будет показана (findActiveSplitPairNode) — не первая в дереве
      // с нужным splitSide, иначе при 2+ парах ratio восстанавливался бы для чужой пары.
      const activePairNode = active ? findActiveSplitPairNode(s.nodes, active.id) : null;
      if (activePairNode) setSplitRatioState(clampSplitRatio(activePairNode.ratio));
    };
    let mounted = true;
    window.oblako.getSyncState().then((s) => { if (mounted) applySync(s); });
    const unsub = window.oblako.onSyncChanged((s) => { if (mounted) applySync(s); });
    return () => { mounted = false; unsub(); };
  }, []);

  const active = tabs.find((t) => t.id === activeId);
  // Активна ли приватная вкладка — тогда весь chrome (острова, тулбар, титлбар) уходит в тёмный
  // «инкогнито»-режим (как отдельное окно инкогнито в Chrome, но у нас — по активной вкладке).
  const activeIncognito = active?.incognito ?? false;
  const isHub = active?.isHub ?? true;
  const tabError = active?.tabError ?? null;
  // kind — заход на псевдо-вкладки (История/Настройки, см. shared/ipc.ts::TabState.kind):
  // отдельно от isHub (тот трогать рискованно, читается ~15+ мест) — только для нового рендер-пути.
  const kind = active?.kind ?? 'hub';

  // Split View: показываемая пара — та, что в дереве СОДЕРЖИТ activeId (findActiveSplitPairNode),
  // а не первая в tabs с нужным splitSide — при 2+ парах плоский .find() по splitSide всегда
  // попадал бы на первую по порядку пару, а не на реально активную (см. shared/nodeTree.ts).
  // При «припаркованном» split (смотрим другую вкладку вне пары) — узел не найден, isSplit=false,
  // но splitSide у обеих вкладок той пары не null → сайдбар показывает Columns2-индикатор.
  const activeSplitPairNode = findActiveSplitPairNode(sidebarNodes, activeId);
  const splitLeft  = activeSplitPairNode ? tabs.find((t) => t.id === activeSplitPairNode.leftTabId) : undefined;
  const splitRight = activeSplitPairNode ? tabs.find((t) => t.id === activeSplitPairNode.rightTabId) : undefined;
  const isSplit = !!splitLeft && !!splitRight;

  // ⚠️ select/newTab ставят activeId у себя, не дожидаясь ответа main, — единственное место, где
  // модель забегает вперёд. Так переключение вкладки отзывается мгновенно; сразу за этим приедет
  // синхронизация и подтвердит то же значение. Расхождение невозможно: main активирует именно то,
  // о чём его попросили, а если вкладки уже нет — следующий же снимок поправит activeId.
  const select = useCallback((id: string) => { setActiveId(id); window.oblako.activateTab(id); }, []);
  const newTab = useCallback(() => { setActiveId(HUB_ID); window.oblako.activateTab(HUB_ID); }, []);
  const close  = useCallback((id: string) => { window.oblako.closeTab(id); }, []);

  // Псевдо-вкладка (История/Настройки/Загрузки): main её заводит и возвращает id, мы на неё
  // переключаемся. Раньше эта пара строк была выписана в шести местах — по одной на каждую
  // кнопку и горячую клавишу.
  const openSpecial = useCallback(async (k: 'history' | 'settings' | 'downloads') => {
    setActiveId(await window.oblako.createSpecialTab(k));
  }, []);

  // Вход в сплит всегда начинается с ровной половины: доля прошлой пары к новой отношения не
  // имеет. Пара строк была выписана дважды — из сайдбара и из дропа вкладки на область контента
  // (dragged = right, activeId = left). side — край, за который тянули: вкладка встаёт именно
  // туда, куда её вели (см. TabDropResult).
  const enterSplit = useCallback((tabId: string, side?: 'left' | 'right') => {
    setSplitRatioState(0.5);
    void window.oblako.enterSplit(tabId, side);
  }, []);

  // Живая доля во время перетаскивания делителя: локально — чтобы рамка ехала за курсором, в
  // main — чтобы туда же ехали страницы. Зажим общий с main (shared/layout.ts).
  const setSplitRatio = useCallback((ratio: number) => {
    const clamped = clampSplitRatio(ratio);
    setSplitRatioState(clamped);
    void window.oblako.setSplitRatio(clamped);
  }, []);

  // Адресная строка: на хабе новый адрес заводит вкладку, на странице — уводит текущую.
  const submit = useCallback(async (input: string) => {
    if (isHub) setActiveId(await window.oblako.createTab(input));
    else window.oblako.navigate(activeId, input);
  }, [isHub, activeId]);

  return {
    tabs, sidebarNodes, activeId, splitRatio,
    hasOrganizeSnapshot, hasRenameSnapshot,
    active, activeIncognito, isHub, tabError, kind,
    splitLeft, splitRight, isSplit,
    select, newTab, close, submit, openSpecial, enterSplit, setSplitRatio,
  };
}
