// Цели быстрого поиска (Ctrl+E) — из чего поповер предлагает выбрать, куда уходит запрос.
//
// Зачем модуль вообще есть: бэнги («!yt котики») требуют назвать цель ДО запроса — то есть
// вспомнить ключ и набрать его прежде, чем начал печатать мысль. Здесь порядок обратный:
// человек печатает запрос, а цели уже выложены, и первой стоит самая вероятная — сайт, на
// котором он сейчас. Бэнги никуда не деваются, но становятся ускорителем, а не обязанностью.
//
// Как узнаётся «этот сайт»:
//   1. адрес страницы уже похож на выдачу поиска → шаблон восстанавливается из него
//      (deriveBangFromUrl, тот же код, что предлагает завести бэнг из открытой вкладки);
//   2. иначе — ищем бэнг, чей шаблон ведёт на ТОТ ЖЕ хост: на youtube.com/watch встроенный
//      «!yt» даёт поиск по YouTube, хотя сама страница видео поиском не является.
// Импортированный список DDG (~13 000) здесь НЕ сканируется: он грузится лениво и только по
// ключу (см. BangStore) — ради подписи одного чипа поднимать его в память незачем.
import { BUILTIN_BANGS, deriveBangFromUrl, isValidBangTemplate } from '../shared/bangs';
import type { BangDef } from '../shared/bangs';
import { getSearchEngine } from '../shared/searchEngines';
import type { SearchEngineId } from '../shared/searchEngines';
import type { SearchTarget, SearchChipsConfig } from '../shared/ipc';
import type { BangStore } from './BangStore';
import type { SearchTargetStore } from './SearchTargetStore';

// Сколько целей отдаём поповеру. Полоса показывает первые несколько, остальные — под кнопкой
// «ещё» (разворот там же, в поповере). Полный набор сюда всё равно не влезет и не нужен:
// импортированный список DDG (~13 000) доступен набором «!ключ» прямо в строке запроса.
const MAX_TARGETS = 24;

function hostOf(rawUrl: string): string | null {
  try { return new URL(rawUrl).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return null; }
}

// Шаблон поисковика по умолчанию. buildUrl — функция, а не строка с {query}, поэтому получаем
// шаблон подстановкой метки и обратной заменой (тот же приём, что в deriveBangFromUrl:
// encodeURIComponent иначе съел бы сами фигурные скобки).
function engineTemplate(engineId: SearchEngineId): string {
  return getSearchEngine(engineId).buildUrl('__OBLAKO_QUERY__').replace(/__OBLAKO_QUERY__/g, '{query}');
}

export interface SearchContext {
  // Адрес активной вкладки. Пустой — хаб/пустая вкладка: цели «этот сайт» тогда просто нет.
  url: string;
  engineId: SearchEngineId;
  faviconUrl?: string | null;
  bangs: BangStore | null;
  // Сайты, на которых человек уже искал (SearchTargetStore) — заполняются сами, см. там же.
  learned: SearchTargetStore | null;
  // Чем наполнять полосу: контекстом или закреплённым набором (настройка, см. shared/ipc.ts).
  chips: SearchChipsConfig;
}

export function buildSearchTargets(ctx: SearchContext): SearchTarget[] {
  const targets: SearchTarget[] = [];
  const seenTemplates = new Set<string>();

  const push = (t: SearchTarget): void => {
    // Шаблон — единственный признак «та же цель»: один и тот же поиск, пришедший и от сайта,
    // и от бэнга, не должен занимать два чипа подряд.
    if (!isValidBangTemplate(t.template) || seenTemplates.has(t.template)) return;
    seenTemplates.add(t.template);
    targets.push(t);
  };

  const userBangs: BangDef[] = ctx.bangs?.listUser() ?? [];
  const host = hostOf(ctx.url);

  // 1. Текущий сайт — первым, это и есть смысл всей затеи. Три источника по убыванию точности:
  //    адрес прямо сейчас похож на выдачу → выученное по этому хосту → бэнг с тем же хостом.
  if (host) {
    const derived = deriveBangFromUrl(ctx.url);
    const remembered = ctx.learned?.findByHost(host) ?? null;
    const sameHostBang = [...userBangs, ...BUILTIN_BANGS].find((b) => hostOf(b.template) === host);
    const site = derived
      ? { name: derived.name, template: derived.template }
      : remembered
      ? { name: remembered.name, template: remembered.template }
      : sameHostBang
      ? { name: sameHostBang.name, template: sameHostBang.template }
      : null;
    if (site) {
      push({
        id: `site:${host}`, name: site.name, kind: 'site',
        template: site.template, faviconUrl: ctx.faviconUrl ?? null,
      });
    }
  }

  // 2. Поисковик по умолчанию — запасной вариант, который подходит всегда.
  const engine = getSearchEngine(ctx.engineId);
  push({ id: 'engine', name: engine.name, kind: 'engine', template: engineTemplate(ctx.engineId) });

  // 3. Остальная полоса. Текущий сайт и поисковик выше от режима не зависят: первый — весь
  //    смысл фичи, второй подходит к любому запросу.
  const rest: SearchTarget[] = [
    // Заведённое руками — главнее всего (тот же приоритет, что при разрешении «!ключ» в
    // BangStore). Выученное идёт ВПЕРЕДИ встроенного набора: сайты, где человек искал сам,
    // для него важнее наших двадцати курируемых, какими бы разумными те ни были.
    ...userBangs.map((b) => ({ id: `bang:${b.key}`, name: b.name, kind: 'bang' as const, template: b.template, bangKey: b.key })),
    ...(ctx.learned?.list() ?? []).map((t) => ({ id: `site:${t.host}`, name: t.name, kind: 'bang' as const, template: t.template })),
    ...BUILTIN_BANGS.map((b) => ({ id: `bang:${b.key}`, name: b.name, kind: 'bang' as const, template: b.template, bangKey: b.key })),
  ];

  if (ctx.chips.mode === 'pinned') {
    // Порядок задаёт сам список закреплений, а не наши приоритеты: человек его и составлял.
    const byId = new Map(rest.map((t) => [t.id, t]));
    for (const id of ctx.chips.pinned) {
      const t = byId.get(id);
      if (t) push(t);
    }
  } else {
    for (const t of rest) {
      if (targets.length >= MAX_TARGETS) break;
      push(t);
    }
  }

  return targets;
}
