// Общие данные поиска, но вкладки всегда принадлежат окну открытого поповера.
import { applyBangTemplate, bangHomeUrl, isValidBangTemplate, parseBangCandidate } from '../../shared/bangs';
import type { QuickHit, SearchTarget } from '../../shared/ipc';
import { setOnQuickOpen, setOnQuickQuery, setOnSearchRun } from '../SearchPopoverManager';
import { contextForWindow } from '../WindowRegistry';
import type { TabManager } from '../TabManager';
import type { WindowDeps } from './deps';

export function wireQuickSearch(deps: WindowDeps): void {
  const { bangs, bookmarks, history, searchTargets } = deps;
  setOnSearchRun(({ query, target, sameTab }, owner) => {
    const tabs = contextForWindow(owner)?.tabs;
    if (!tabs) return;
    // Бэнг в строке главнее выбранного чипа и разбирается ЗДЕСЬ, а не в поповере: BangStore
    // видит все три источника (свои, встроенные, импортированные), а второй парсер в вью
    // неминуемо разъехался бы с этим. Раньше строка уходила в шаблон цели как есть — и
    // «!wb Xiaomi» честно искалось в гугле вместе с самим «!wb».
    const bang = resolvePopoverBang(query);
    const effectiveTarget = bang?.target ?? target;
    const effectiveQuery = bang?.query ?? query;
    // Шаблон приходит из вью поповера. Она наша (не веб-страница), но проверка обязательна:
    // навигация по неподтверждённому шаблону — ровно то, от чего защищается импорт бэнгов.
    if (!isValidBangTemplate(effectiveTarget.template)) return;
    // «!wb» без запроса — на главную сайта, как в омнибоксе: цель названа, искать нечего.
    const url = effectiveQuery
      ? applyBangTemplate(effectiveTarget.template, effectiveQuery)
      : bangHomeUrl({ key: '', name: '', template: effectiveTarget.template });
    searchTargets.noteUse(effectiveTarget.template); // частые цели поднимаются в полосе чипов
    if (sameTab) tabs.navigate(tabs.getActiveId(), url);
    else tabs.createTab(url);
  });
  // Поиск по своим данным для того же поповера: открытые вкладки, история, закладки.
  // Всё синхронное и дешёвое — LIKE по истории и фильтр по памяти: запрос идёт на каждое
  // нажатие клавиши, тяжёлому умному поиску (FTS5 + переранжирование Qwen, HistorySearch.ts)
  // здесь не место, он живёт в панели истории, где его ждут дольше 100 мс.
  setOnQuickQuery((text, owner) => {
    // Бэнг разбираем на КАЖДЫЙ ввод, чтобы поповер показал цель сразу, как её назвали, а не
    // только после Enter: иначе набравший «!wb» не понимает, услышали его или нет.
    const bang = resolvePopoverBang(text);
    const effective = bang?.query ?? text;
    return {
      hits: quickHits(effective, contextForWindow(owner)?.tabs),
      bangTarget: bang?.target ?? null,
      strippedQuery: effective,
    };
  });
  // Разбор бэнга из строки поповера: null — бэнга нет (обычный запрос).
  function resolvePopoverBang(text: string): { target: SearchTarget; query: string } | null {
    const parsed = parseBangCandidate(text);
    if (!parsed) return null;
    const bang = bangs.find(parsed.key);
    if (!bang) return null; // неизвестный ключ бэнгом не считается — как и в омнибоксе
    return {
      target: {
        id: `bang:${bang.key}`, name: bang.name, kind: 'bang',
        template: bang.template, bangKey: bang.key,
      },
      query: parsed.query,
    };
  }
  function quickHits(text: string, tabs: TabManager | undefined): QuickHit[] {
    const q = text.trim().toLowerCase();
    if (q.length < 2 || !tabs) return [];
    const hits: QuickHit[] = [];
    const seen = new Set<string>();
    const add = (h: QuickHit): void => {
      const key = h.kind === 'tab' ? `tab:${h.tabId}` : h.url;
      if (seen.has(key)) return;
      seen.add(key);
      hits.push(h);
    };
    const matches = (title: string, url: string): boolean =>
      title.toLowerCase().includes(q) || url.toLowerCase().includes(q);
    // Открытые вкладки — первыми: «где я это уже видел» чаще всего означает «оно ещё открыто»,
    // и переключение дешевле открытия копии. Инкогнито из выдачи исключаем: приватная вкладка
    // не должна всплывать в общем поиске.
    for (const t of tabs.snapshot()) {
      if (hits.length >= 3) break;
      if (t.isHub || t.incognito || !t.url) continue;
      if (matches(t.title, t.url)) {
        add({ kind: 'tab', tabId: t.id, url: t.url, title: t.title || t.url, faviconUrl: t.faviconUrl });
      }
    }
    for (const b of bookmarks().list()) {
      if (hits.length >= 6) break;
      if (matches(b.title ?? '', b.url)) {
        add({ kind: 'bookmark', url: b.url, title: b.title || b.url });
      }
    }
    for (const h of history().search(text.trim())) {
      if (hits.length >= 9) break;
      add({ kind: 'history', url: h.url, title: h.title || h.url });
    }
    return hits;
  }
  setOnQuickOpen((hit, owner) => {
    const tabs = contextForWindow(owner)?.tabs;
    if (!tabs) return;
    // Вкладка уже открыта — переключаемся на неё, а не плодим копию. Если её успели закрыть
    // между показом и выбором, открываем адрес заново: пустой клик хуже лишней вкладки.
    if (hit.kind === 'tab' && hit.tabId && tabs.snapshot().some((t) => t.id === hit.tabId)) {
      tabs.activate(hit.tabId);
      return;
    }
    tabs.createTab(hit.url);
  });
}
