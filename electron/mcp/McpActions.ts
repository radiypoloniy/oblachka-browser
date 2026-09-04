// Действия внешнего агента: всё, что МЕНЯЕТ браузер.
//
// ⚠️ Отдельно от чтения (McpTools.ts) по той же границе, что проходит через всю область: чтение
// идёт молча по согласию, данному при подключении, а КАЖДОЕ действие отсюда проходит через
// карточку подтверждения (см. McpConfirm.ts). Пока они жили в одном файле, эта граница была
// видна только по комментарию посередине — а файл заодно перерос порог структуры.
//
// ⚠️ Белый список сайтов действует и здесь: адрес вне его для этой программы не существует, и
// «нельзя в почту» обязано означать в том числе «нельзя открыть, закрыть и сохранить».

import { BrowserWindow } from 'electron';
import { contextForWindow, mainContext } from '../WindowRegistry';
import { activeBookmarks, activeTracking } from '../ProfileData';
import { detectProduct } from '../ProductDetector';
import { domainAllowed, visibleTabs } from '../../shared/mcpPolicy';
import {
  bookmarkTargets, groupTargets, openTargets, trackTargets,
} from '../../shared/mcpArgs';
import type { GroupNode, SidebarNode } from '../../shared/ipc';
import { OUT_OF_SCOPE } from './McpTools';

/**
 * Окно, в котором действуем.
 *
 * ⚠️ То же правило, что у чтения: берём окно, куда человек смотрит. Действие «в каком-то из окон»
 * человеку объяснить нельзя.
 */
function activeContext() {
  return contextForWindow(BrowserWindow.getFocusedWindow()) ?? mainContext();
}

// ── Запись. ⚠️ Сюда попадают только после подтверждения человеком (см. McpConfirm.ts). ──

export interface McpWriteResult {
  ok: boolean;
  note: string;
}

/**
 * Сохранить страницы в закладки.
 *
 * ⚠️ Закрывает круг, который до сих пор обрывался: агент находил нужное и не мог его никуда
 * положить — «папку создать не смог, вот ссылки» (живая жалоба 04.09.2026). Найденное без места
 * хранения человек переносит руками, то есть делает ровно ту работу, ради которой звал агента.
 *
 * ⚠️ Пачкой, а не по одной: восемь находок — это восемь карточек подтверждения подряд, и на
 * третьей человек перестаёт читать, что в них написано. Одна карточка перечисляет всё (см.
 * confirmSubject в shared/mcpArgs.ts).
 *
 * ⚠️ Папка ищется/создаётся ПО ИМЕНИ (folderByName): номеров наших папок у агента нет и не будет.
 */
export function addBookmarks(
  args: Record<string, unknown>,
  domains: readonly string[] = [],
): McpWriteResult {
  const targets = bookmarkTargets(args);
  if (!targets.ok) return { ok: false, note: targets.error };
  const permitted = targets.items.filter((i) => domainAllowed(i.url, domains));
  if (permitted.length === 0) return { ok: false, note: OUT_OF_SCOPE };

  const store = activeBookmarks();
  const parentId = targets.folder ? store.folderByName(targets.folder) : null;
  // ⚠️ Папку не создали (база не открылась) — кладём в корень, а не бросаем всё: потерять место
  // хуже, чем потерять папку, и человек всё равно найдёт закладку поиском.
  let saved = 0;
  const skipped: string[] = [];
  for (const item of permitted) {
    const entry = store.add(item.url, item.title || item.url, parentId);
    if (entry) saved++;
    else skipped.push(item.url);
  }
  const where = targets.folder && parentId !== null ? ` в папку «${targets.folder}»` : '';
  const tail = skipped.length > 0 ? `, пропущено ${skipped.length} (уже были или не открылась база)` : '';
  return {
    ok: saved > 0,
    note: saved > 0
      ? `Сохранено ${saved}${where}${tail}`
      : 'Ни одной закладки сохранить не удалось.',
  };
}

/**
 * Открыть адрес новой вкладкой.
 *
 * ⚠️ Адреса проходят проверку ЗДЕСЬ ЖЕ, ещё раз (openTargets), хотя карточка подтверждения
 * показывала человеку уже проверенные. Это не дубль: между показом и выполнением лежит целый круг
 * через клиента, и повтор вызова с другим адресом обязан упереться в ту же проверку, а не в
 * память о том, что «пользователь уже согласился».
 */
export function openTab(
  args: Record<string, unknown>,
  domains: readonly string[] = [],
): McpWriteResult {
  const ctx = activeContext();
  if (!ctx) return { ok: false, note: 'No browser window is open.' };
  const targets = openTargets(args);
  if (!targets.ok) return { ok: false, note: targets.error };
  const allowed = targets.urls.filter((u) => domainAllowed(u, domains));
  if (allowed.length === 0) return { ok: false, note: OUT_OF_SCOPE };

  // ⚠️ ПАЧКА ВСЕГДА В ФОНЕ, и это не мелочь: восемь вкладок, каждая из которых выпрыгивает на
  // экран, — это не помощь, а перехват работы. Человек видит их в сайдбаре и открывает сам.
  // Одиночное открытие оставляет прежнее поведение: там `background` — осознанный аргумент.
  const many = allowed.length > 1;
  const background = many ? true : args.background === true;
  let opened = 0;
  for (const url of allowed) {
    if (ctx.tabs.createTab(url, background)) opened++;
  }
  const blocked = targets.urls.length - allowed.length;
  const tail = blocked > 0 ? `, ${blocked} вне разрешённых сайтов` : '';
  if (opened === 0) return { ok: false, note: 'The browser refused to open these addresses.' };
  return {
    ok: true,
    note: many
      ? `Открыто ${opened} вкладок в фоне${tail}`
      : `Opened ${allowed[0]}${tail}`,
  };
}

/**
 * Группа с таким именем в сайдбаре — или ничего.
 *
 * ⚠️ ПО ИМЕНИ, а не по id: наших идентификаторов у агента нет и быть не должно, он видит ровно то
 * же, что человек в сайдбаре. Регистр не важен — «Кресла» и «кресла» это одна группа, заводить
 * вторую глупо.
 *
 * ⚠️ Живёт ЗДЕСЬ, а не в TabManager: «найти группу по имени, которое назвала чужая программа» —
 * это про наш фасад наружу, а не про управление вкладками. Дерево у менеджера и так спрашивается
 * публично (sidebarNodesSnapshot).
 */
function findGroupByLabel(nodes: readonly SidebarNode[], name: string): string | null {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  const hit = nodes.find((n): n is GroupNode => n.type === 'group' && n.label.trim().toLowerCase() === want);
  return hit?.id ?? null;
}

/**
 * Поставить товары на отслеживание цены.
 *
 * ⚠️ ЭТО ЕДИНСТВЕННОЕ, ЧТО ПРОДОЛЖАЕТ РАБОТАТЬ ПОСЛЕ УХОДА АГЕНТА. Он закрыл разговор, а браузер
 * сам ходит на эти страницы неделями и сообщает человеку о падении цены. Поэтому и карточка
 * говорит об этом прямо: соглашаются не на разовое действие.
 *
 * ⚠️ Товар распознаётся НА ЖИВОЙ СТРАНИЦЕ (ProductDetector исполняет скрипт в её DOM), поэтому
 * вкладка должна быть открыта. Открывать скрытые вью на каждый адрес мы не стали: десять таких
 * вью — это десять рендереров ради фоновой задачи, а tabs_open уже умеет открывать список.
 *
 * ⚠️ Цену пишем ТОЙ ЖЕ дорогой, что кнопка «Отслеживать цену» в меню адресной строки: второй путь
 * к тому же хранилищу разъехался бы с первым на первой же правке формата сигнала.
 */
export async function trackProducts(
  args: Record<string, unknown>,
  domains: readonly string[] = [],
): Promise<McpWriteResult> {
  const ctx = activeContext();
  if (!ctx) return { ok: false, note: 'No browser window is open.' };
  const targets = trackTargets(args);
  if (!targets.ok) return { ok: false, note: targets.error };
  const allowed = targets.urls.filter((u) => domainAllowed(u, domains));
  if (allowed.length === 0) return { ok: false, note: OUT_OF_SCOPE };

  const store = activeTracking();
  const added: string[] = [];
  const already: string[] = [];
  const noPrice: string[] = [];
  const notOpen: string[] = [];

  for (const url of allowed) {
    if (store.idForUrl(url) !== null) { already.push(url); continue; }
    const wc = ctx.tabs.getWebContentsForUrl(url);
    if (!wc || wc.isDestroyed()) { notOpen.push(url); continue; }
    const signal = await detectProduct(wc);
    if (!signal) { noPrice.push(url); continue; }
    const id = store.track({
      url,
      host: hostOf(url),
      title: signal.name,
      brand: signal.brand,
      sku: signal.sku,
      gtin: signal.gtin,
      mpn: signal.mpn,
      currency: signal.currency,
      price: signal.price,
      availability: signal.availability,
    });
    if (id !== null) added.push(signal.name || url);
  }

  // ⚠️ Про каждую неудачу говорим ОТДЕЛЬНО и словами: «поставил 2 из 5» без причин агент
  // перескажет человеку как сбой, а причины у них разные и чинятся по-разному.
  const parts = [`Отслеживается ${added.length}`];
  if (already.length) parts.push(`${already.length} уже отслеживались`);
  if (noPrice.length) parts.push(`${noPrice.length} без распознанной цены`);
  if (notOpen.length) parts.push(`${notOpen.length} не открыты во вкладках (сначала tabs_open)`);
  return { ok: added.length > 0 || already.length > 0, note: parts.join(', ') };
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

/**
 * Собрать вкладки в группу сайдбара.
 *
 * ⚠️ Заведено по прямой просьбе: складывать найденное можно не только в закладки — у сайдбара есть
 * группы, и для «разбери, что открыто» они уместнее. Закладка это «сохранить на потом», группа —
 * «прибраться сейчас».
 *
 * ⚠️ Группа ищется ПО ИМЕНИ и создаётся, если её нет: у агента нет наших идентификаторов, он
 * видит только то же, что человек в сайдбаре.
 *
 * ⚠️ Кладём ТОЛЬКО ВИДИМЫЕ снаружи вкладки (visibleTabs), даже если id прислали чужой: приватная
 * вкладка, утащенная в группу, — это не перестановка, а раскрытие того, что человек прятал.
 */
export function groupTabs(
  args: Record<string, unknown>,
  domains: readonly string[] = [],
): McpWriteResult {
  const ctx = activeContext();
  if (!ctx) return { ok: false, note: 'No browser window is open.' };
  const target = groupTargets(args);
  if (!target.ok) return { ok: false, note: target.error };

  // ⚠️ Двигать можно только то, что этой программе вообще видно: вкладка вне белого списка для
  // неё не существует, и утащить её в группу она не должна даже зная id.
  const visible = new Set(
    visibleTabs(ctx.tabs.snapshot()).filter((t) => domainAllowed(t.url, domains)).map((t) => t.id),
  );
  const ids = target.tabIds.filter((id) => visible.has(id));
  if (ids.length === 0) return { ok: false, note: 'No such tabs. Call tabs_list first.' };

  let groupId = findGroupByLabel(ctx.tabs.sidebarNodesSnapshot(), target.name);
  let moved = 0;
  if (groupId === null) {
    // ⚠️ Группа создаётся ИЗ ПЕРВОЙ вкладки — другого способа завести её нет (createGroup берёт
    // вкладку и оборачивает её узлом), поэтому первая уже внутри и второй раз не добавляется.
    const first = ids[0] as string;
    groupId = ctx.tabs.createGroup(first);
    if (groupId === null) return { ok: false, note: 'The browser refused to create a group.' };
    ctx.tabs.renameGroup(groupId, target.name);
    moved = 1;
  }
  for (const id of ids.slice(moved)) {
    ctx.tabs.addTabToGroup(groupId, id);
    moved++;
  }
  const skipped = target.tabIds.length - ids.length;
  return {
    ok: true,
    note: `Собрано ${moved} в группу «${target.name}»${skipped > 0 ? `, пропущено ${skipped} (таких вкладок нет)` : ''}`,
  };
}

/**
 * Переключиться на уже открытую вкладку.
 *
 * ⚠️ Переключать можно ТОЛЬКО то, что и так видно снаружи: приватная вкладка и наш интерфейс
 * недоступны и здесь. Иначе агент, знающий чужой id, вытаскивал бы на экран спрятанное.
 */
export function activateTab(rawId: unknown, domains: readonly string[] = []): McpWriteResult {
  const ctx = activeContext();
  if (!ctx) return { ok: false, note: 'No browser window is open.' };
  const id = typeof rawId === 'string' ? rawId : '';
  // ⚠️ Тот же фильтр, что у списка: вкладки вне белого списка для этой программы не существует.
  const tab = visibleTabs(ctx.tabs.snapshot())
    .filter((t) => domainAllowed(t.url, domains)).find((t) => t.id === id);
  if (!tab) return { ok: false, note: 'No such tab. Call tabs.list first.' };
  ctx.tabs.activate(id);
  return { ok: true, note: `Switched to ${tab.title || tab.url}` };
}

/** Закрыть вкладку. ⚠️ Необратимо отсюда — потому и destructiveHint, и вопрос человеку. */
export function closeTab(rawId: unknown, domains: readonly string[] = []): McpWriteResult {
  const ctx = activeContext();
  if (!ctx) return { ok: false, note: 'No browser window is open.' };
  const id = typeof rawId === 'string' ? rawId : '';
  // ⚠️ Тот же фильтр, что у списка: вкладки вне белого списка для этой программы не существует.
  const tab = visibleTabs(ctx.tabs.snapshot())
    .filter((t) => domainAllowed(t.url, domains)).find((t) => t.id === id);
  if (!tab) return { ok: false, note: 'No such tab. Call tabs.list first.' };
  ctx.tabs.closeTab(id);
  return { ok: true, note: `Closed ${tab.title || tab.url}` };
}
