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
import type { SearchTarget, SearchChipsConfig, SearchChipCandidate } from '../shared/ipc';
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

// ── Выбор цели в настройках ────────────────────────────────────────────────────
// Полный список кандидатов наружу не отдаётся: со встроенными и импортированными из DDG их
// тысячи, и стеной чипов такое не показать. Наружу — только поиск и разрешение выбранных id.

// Сколько строк показываем в выдаче. Больше десяти — это уже не «выбрал глазами», а список,
// по которому опять нужен поиск.
export const CHIP_SEARCH_LIMIT = 10;

export interface ChipSources {
  bangs: BangStore | null;
  learned: SearchTargetStore | null;
}

function candidateFromBang(b: BangDef, source: 'user' | 'builtin' | 'imported'): SearchChipCandidate {
  return { id: `bang:${b.key}`, name: b.name, kind: 'bang', source, host: hostOf(b.template) ?? '', bangKey: b.key };
}

export function searchChipCandidates(query: string, src: ChipSources): SearchChipCandidate[] {
  const q = query.trim().toLowerCase();
  const out: SearchChipCandidate[] = [];
  const seen = new Set<string>();
  const add = (c: SearchChipCandidate): void => {
    // Схлопываем не только по id, но и по паре «домен + название»: один и тот же Wildberries
    // приходит и выученным сайтом, и встроенным бэнгом — в короткой выдаче это две неотличимые
    // строки. Именно домен И название, а не домен: на google.com живут и веб-поиск, и «Картинки
    // Google», и это разные цели.
    const label = `${c.host}|${c.name.toLowerCase()}`;
    if (seen.has(c.id) || seen.has(label) || out.length >= CHIP_SEARCH_LIMIT) return;
    seen.add(c.id);
    seen.add(label);
    out.push(c);
  };

  // Выученные сайты — впереди бэнгов: это места, где человек искал сам, и в коротком списке
  // они полезнее любого курируемого набора (тот же приоритет, что в полосе чипов выше).
  for (const t of src.learned?.list() ?? []) {
    if (q && !t.name.toLowerCase().includes(q) && !t.host.includes(q)) continue;
    add({ id: `site:${t.host}`, name: t.name, kind: 'site', source: 'learned', host: t.host });
  }
  for (const { bang, source } of src.bangs?.searchAll(q, CHIP_SEARCH_LIMIT) ?? []) {
    add(candidateFromBang(bang, source));
  }
  return out;
}

// Показать уже выбранное (цель по умолчанию, закреплённые) нужно, не листая тысячи целей —
// поэтому разрешение точечное, по id. Неизвестные id молча выпадают: цель могли удалить.
export function resolveChipCandidates(ids: string[], src: ChipSources): SearchChipCandidate[] {
  const out: SearchChipCandidate[] = [];
  for (const id of ids) {
    if (id.startsWith('bang:')) {
      const key = id.slice('bang:'.length);
      // find() ищет во всех трёх источниках, включая импортированные, — цель по умолчанию можно
      // выбрать и из набора DDG, и подписать её потом надо честно.
      const b = src.bangs?.find(key) ?? null;
      if (b && src.bangs) {
        const source = src.bangs.listUser().some((x) => x.key === key) ? 'user'
          : src.bangs.listBuiltin().some((x) => x.key === key) ? 'builtin'
          : 'imported';
        out.push(candidateFromBang(b, source));
      }
    } else if (id.startsWith('site:')) {
      const host = id.slice('site:'.length);
      const t = src.learned?.findByHost(host) ?? null;
      if (t) out.push({ id, name: t.name, kind: 'site', source: 'learned', host });
    }
  }
  return out;
}

// Цель, назначенную по умолчанию, надо уметь достать по id ДО того, как собрана полоса: она
// встаёт первой, а в режиме 'pinned' её вообще может не быть среди закреплённых. Источники — те
// же, что у списка кандидатов в настройках (свои бэнги → выученные сайты → встроенные);
// импортированный список DDG сюда не входит намеренно, см. шапку модуля.
function resolveTargetById(id: string, ctx: SearchContext, userBangs: BangDef[]): SearchTarget | null {
  if (id === 'engine') {
    const engine = getSearchEngine(ctx.engineId);
    return { id: 'engine', name: engine.name, kind: 'engine', template: engineTemplate(ctx.engineId) };
  }
  if (id.startsWith('bang:')) {
    const key = id.slice('bang:'.length);
    const b = userBangs.find((x) => x.key === key) ?? BUILTIN_BANGS.find((x) => x.key === key);
    return b ? { id, name: b.name, kind: 'bang', template: b.template, bangKey: b.key } : null;
  }
  if (id.startsWith('site:')) {
    const host = id.slice('site:'.length);
    const t = ctx.learned?.findByHost(host) ?? null;
    return t ? { id, name: t.name, kind: 'bang', template: t.template } : null;
  }
  return null;
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

  // 0. Цель по умолчанию, если человек её назначил (настройки → «Цели быстрого поиска»). Идёт
  //    ПЕРЕД текущим сайтом, и это осознанно: контекстная догадка хороша, пока человек не сказал
  //    иначе — а сказав, он ждёт, что Enter уйдёт туда, куда он велел, а не куда мы подумали.
  //    Поповер выбирает первый чип, так что «первой» здесь и означает «выбрана по умолчанию».
  if (ctx.chips.defaultId) {
    const def = resolveTargetById(ctx.chips.defaultId, ctx, userBangs);
    // Промах (бэнг удалили, сайт забыли) не ломает ничего: полоса просто соберётся как раньше.
    if (def) push(def);
  }

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
