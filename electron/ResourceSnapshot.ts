import { app, webContents } from 'electron';
import os from 'node:os';
import { allContexts } from './WindowRegistry';
import { getInferencePid } from './inference/InferenceHost';
import { getLoadedModelId } from './TranslationService';
import * as Hardware from './HardwareInfo';
import type { ResourceKind, ResourceProcess, ResourceSnapshot } from '../shared/ipc';

// Снимок «куда уходит память» для диспетчера задач (Shift+Esc).
//
// ⚠️ Зачем вообще. До этого браузер знал о своей памяти РОВНО ОДНО число — сумму `getAppMetrics()`
// в `TabManager.#appWorkingSetBytes()`. Из него нельзя узнать ни на что уходит, ни сколько стоит
// вкладка; из-за этого политика давления выселяла самых ДАВНИХ, а не самых дорогих.
//
// ⚠️ Главное число — **Private Bytes**, а не Working Set, и это не вкусовщина. Working Set включает
// разделяемые страницы и файловый кэш (в том числе mmap-нутый файл модели), поэтому сумма по
// процессам их задваивает: замер 31.08.2026 дал 2268 МБ private против 3133 МБ working set на
// одном и том же состоянии. Плюс падение working set ничего не стоит — страницы просто вытеснили.
// Working Set показываем рядом, чтобы разницу было видно, а не приходилось верить на слово.
//
// ⚠️ Ничего не кэшируем и никакого таймера здесь нет: снимок собирается по запросу окна диспетчера.
// Пока окно закрыто, считать нечего.

/** Наши страницы, которые не являются вкладками человека. Ключ — файл, значение — как назвать. */
const CHROME_PAGES: Record<string, string> = {
  'index.html': 'Интерфейс окна',
  'aipanel.html': 'AI-панель',
  'sitepopover.html': 'Карточка сайта',
  'downloadspopover.html': 'Загрузки',
  'dropzones.html': 'Зоны перетаскивания',
  'clipboardpopover.html': 'Буфер обмена',
  'permissionpopover.html': 'Разрешения',
  'passwordpopover.html': 'Пароли',
  'autofillpopover.html': 'Автозаполнение',
  'searchpopover.html': 'Поиск',
  'translatepopover.html': 'Перевод',
  'suggestdropdown.html': 'Подсказки омнибокса',
  'screenshot.html': 'Снимок вкладки',
  'taskmanager.html': 'Диспетчер задач',
};

function pageOf(url: string): string | null {
  if (!url.startsWith('oblako-chrome://')) return null;
  const file = url.split('?')[0]!.split('#')[0]!.split('/').pop() ?? '';
  return CHROME_PAGES[file] ?? (file || null);
}

/** Домен для подписи строки вкладки — адрес целиком в таблицу не влезает и не нужен. */
function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname || u.protocol.replace(':', '');
  } catch {
    return url.slice(0, 40);
  }
}

export async function buildResourceSnapshot(): Promise<ResourceSnapshot> {
  const metrics = app.getAppMetrics();
  const inferencePid = getInferencePid();

  // Вкладки всех окон разом: диспетчер — про приложение целиком, а не про то окно, из которого
  // его открыли.
  //
  // ⚠️ Собирается ЗДЕСЬ из публичного API менеджера (`snapshot()` + `tabIdForWebContents`), а не
  // отдельным методом внутри TabManager. Причина не в красоте: TabManager давно за порогом
  // храповика (см. structure-check), и добавлять в него взгляд на вкладки, нужный только
  // диспетчеру, значило бы растить самый большой файл проекта ради чужой задачи.
  const tabByPid = new Map<number, { tabId: string; url: string; title: string; sleeping: boolean; active: boolean }>();
  const sleepingTabs: { tabId: string; url: string; title: string }[] = [];
  for (const ctx of allContexts()) {
    const states = new Map(ctx.tabs.snapshot().map((t) => [t.id, t]));
    const seen = new Set<string>();
    // Живые вкладки узнаём через их webContents: только у него есть pid, а метрики приходят
    // именно по pid (см. шапку).
    for (const wc of webContents.getAllWebContents()) {
      if (wc.isDestroyed()) continue;
      const tabId = ctx.tabs.tabIdForWebContents(wc.id);
      if (!tabId) continue;
      const st = states.get(tabId);
      if (!st) continue;
      let pid = 0;
      try { pid = wc.getOSProcessId(); } catch { continue; }
      if (pid <= 0) continue;
      seen.add(tabId);
      tabByPid.set(pid, {
        tabId, url: st.url, title: st.title, sleeping: st.isSleeping, active: st.isActive,
      });
    }
    // Спящие процесса не имеют вовсе — их берём из снимка менеджера.
    for (const st of states.values()) {
      if (!seen.has(st.id) && st.isSleeping) {
        sleepingTabs.push({ tabId: st.id, url: st.url, title: st.title });
      }
    }
  }

  // Наши страницы, которые не вкладки: слой хрома, поповеры, само окно диспетчера.
  // ⚠️ Именно они и есть «поповеры создаются лениво и не умирают»: при закрытии вью только
  // отцепляется от дерева (removeChildView), рендерер продолжает жить и держать процесс.
  const pageByPid = new Map<number, string>();
  for (const wc of webContents.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    let pid = 0;
    try { pid = wc.getOSProcessId(); } catch { continue; }
    if (pid <= 0 || tabByPid.has(pid)) continue;
    const name = pageOf(wc.getURL());
    if (name) pageByPid.set(pid, name);
  }

  const processes: ResourceProcess[] = metrics.map((m) => {
    const pid = m.pid;
    const privateBytes = (m.memory?.privateBytes ?? 0) * 1024;
    const workingSet = (m.memory?.workingSetSize ?? 0) * 1024;
    const cpu = m.cpu?.percentCPUUsage ?? 0;

    let kind: ResourceKind = 'other';
    let title: string = m.type;
    let detail = '';
    let tabId: string | null = null;
    let sleeping = false;
    let active = false;

    const tab = tabByPid.get(pid);
    const page = pageByPid.get(pid);

    if (pid === inferencePid) {
      kind = 'model';
      title = 'Локальная модель';
      // ⚠️ Отдельная строка не ради красоты: инференс живёт в своём utilityProcess, и без него
      // цена модели растворялась бы в «служебном» вместе с сетью и звуком.
      detail = getLoadedModelId() ?? 'процесс поднят, модель не загружена';
    } else if (tab) {
      kind = 'tab';
      title = tab.title || 'Вкладка';
      detail = hostOf(tab.url);
      tabId = tab.tabId;
      sleeping = tab.sleeping;
      active = tab.active;
    } else if (page) {
      kind = page === 'Интерфейс окна' ? 'chrome' : 'popover';
      title = page;
      // ⚠️ Поповер, который ничего не показывает, всё равно держит процесс: при закрытии вью
      // только отцепляется от дерева (removeChildView), рендерер остаётся жить.
      detail = kind === 'popover' ? 'служебная панель' : 'оболочка браузера';
    } else if (m.type === 'Browser') {
      kind = 'main';
      title = 'Главный процесс';
      detail = 'окна, вкладки, адблок, базы';
    } else if (m.type === 'GPU') {
      kind = 'gpu';
      title = 'Графика';
      detail = 'отрисовка и композиция';
    } else if (m.type === 'Utility') {
      kind = 'utility';
      title = 'Служба';
      detail = (m as { name?: string; serviceName?: string }).name
        ?? (m as { serviceName?: string }).serviceName ?? 'вспомогательный процесс';
    }

    return { pid, kind, title, detail, privateBytes, workingSet, cpu, tabId, sleeping, active };
  });

  // ⚠️ Спящие вкладки добавляются СТРОКАМИ БЕЗ ПРОЦЕССА и с нулевой ценой. Прятать их нельзя:
  // «вкладка исчезла из списка» человек читает как «она закрылась», а она жива и ждёт возврата.
  for (const t of sleepingTabs) {
    processes.push({
      pid: 0, kind: 'tab', title: t.title || 'Вкладка', detail: `${hostOf(t.url)} · спит`,
      privateBytes: 0, workingSet: 0, cpu: 0, tabId: t.tabId, sleeping: true, active: false,
    });
  }

  const totals = processes.reduce(
    (s, p) => ({
      privateBytes: s.privateBytes + p.privateBytes,
      workingSet: s.workingSet + p.workingSet,
      cpu: s.cpu + p.cpu,
    }),
    { privateBytes: 0, workingSet: 0, cpu: 0 },
  );

  // ⚠️ Железо берём из кэша HardwareInfo: vramTotal и число ядер не меняются, а пересчёт зовёт
  // llama-бэкенд — на опросе раз в секунду это была бы заметная работа ради неменяющихся чисел.
  const hw = await Hardware.get().catch(() => null);

  return {
    at: Date.now(),
    processes,
    totals,
    machine: {
      ramTotalBytes: os.totalmem(),
      ramFreeBytes: os.freemem(),
      vramTotalBytes: hw?.vramTotalBytes ?? null,
      vramFreeBytes: hw?.vramFreeBytes ?? null,
      gpuBackend: hw?.gpuBackend ?? null,
    },
    loadedModelId: getLoadedModelId(),
  };
}

/** Усыпить вкладку по требованию диспетчера — в том окне, которому она принадлежит. */
export function sleepTabFromResources(tabId: string): boolean {
  for (const ctx of allContexts()) {
    if (ctx.tabs.sleepTabById(tabId)) return true;
  }
  return false;
}
