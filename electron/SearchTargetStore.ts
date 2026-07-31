// Выученные цели поиска: сайты, на которых человек уже искал, — чтобы «этот сайт» в поповере
// Ctrl+E работал не только на распознанной странице выдачи, но и на любой странице того сайта.
//
// Как учится: на каждой навигации (не в инкогнито — туда колбэк вообще не приходит, см.
// TabManager) адрес прогоняется через deriveBangFromUrl. Если он похож на выдачу поиска —
// хост запоминается вместе с шаблоном. То есть один поиск на сайте делает этот сайт целью
// навсегда, и ничего настраивать не нужно.
//
// ⚠️ Что попадает на диск: хост и ШАБЛОН адреса — сам запрос заменён на {query} и не хранится
// никогда. Но прочие параметры того адреса сохраняются как есть (они часто обязательны: язык,
// раздел каталога, тип поиска), поэтому файл наследует тот же профиль риска, что и история
// посещений, где полные адреса лежат и подавно. Эвристика «побеждает самый короткий шаблон»
// (см. #upsert) со временем сама вымывает лишние параметры.
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseTld } from 'tldts-experimental';
import { deriveBangFromUrl, isValidBangTemplate } from '../shared/bangs';

// Потолок на число сайтов: список живёт в памяти и целиком уходит в поповер при показе.
// Вытесняем реже всего используемые — цель фичи в частотном, а не в полноте.
const MAX_TARGETS = 200;
const SAVE_DEBOUNCE_MS = 1500;

export interface LearnedTarget {
  host: string;
  name: string;
  template: string;
  hits: number;
  lastAt: number;
}

// Имя цели человеку — по РЕГИСТРИРУЕМОМУ домену, а не по первой метке хоста. deriveBangFromUrl
// берёт именно первую метку (для «завести бэнг из вкладки» это разумно: ключ должен быть
// коротким), но в полосе чипов так рождался мусор — en.wikipedia.org и ru.wikipedia.org
// подписывались «En» и «Ru», что не значит ничего.
function displayName(host: string): string {
  const domain = parseTld(host).domainWithoutSuffix ?? host.split('.')[0] ?? host;
  return domain.charAt(0).toUpperCase() + domain.slice(1);
}

// Ключ схлопывания в полосе чипов: en/ru/de-википедии — один сайт, а не пять целей подряд.
// В самом хранилище записи остаются пер-хостовыми: на ru.wikipedia.org чип «этот сайт» обязан
// искать по РУССКОЙ википедии, а не по той, которой пользовались чаще.
function siteKey(host: string): string {
  return parseTld(host).domain ?? host;
}

export class SearchTargetStore {
  readonly #path: string;
  // null — с диска ещё не читали. Ленивая загрузка по образцу импортированных бэнгов
  // (BangStore): на старте браузера этот файл никому не нужен, первым его спросит либо
  // первая навигация, либо первый Ctrl+E.
  #map: Map<string, LearnedTarget> | null = null;
  #saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.#path = path.join(app.getPath('userData'), 'search-targets.json');
  }

  #load(): Map<string, LearnedTarget> {
    if (this.#map) return this.#map;
    const map = new Map<string, LearnedTarget>();
    try {
      const raw = JSON.parse(fs.readFileSync(this.#path, 'utf8')) as unknown;
      if (Array.isArray(raw)) {
        for (const it of raw) {
          const t = it as Partial<LearnedTarget>;
          if (typeof t.host !== 'string' || typeof t.template !== 'string') continue;
          // Валидация на чтении, а не только на записи: файл лежит в userData и мог быть
          // отредактирован руками, а шаблон отсюда уходит прямо в навигацию.
          if (!isValidBangTemplate(t.template)) continue;
          map.set(t.host, {
            host: t.host,
            name: typeof t.name === 'string' && t.name ? t.name : t.host,
            template: t.template,
            hits: typeof t.hits === 'number' && t.hits > 0 ? t.hits : 1,
            lastAt: typeof t.lastAt === 'number' ? t.lastAt : 0,
          });
        }
      }
    } catch { /* файла ещё нет или он битый — начинаем с пустого */ }
    this.#map = map;
    return map;
  }

  #scheduleSave(): void {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      const map = this.#map;
      if (!map) return;
      try {
        fs.writeFileSync(this.#path, JSON.stringify([...map.values()], null, 2), 'utf8');
      } catch (e) { console.warn('[SearchTargets] не удалось сохранить:', e); }
    }, SAVE_DEBOUNCE_MS);
  }

  // Вытеснение при переполнении: сначала по числу использований, при равенстве — по давности.
  #evictIfNeeded(map: Map<string, LearnedTarget>): void {
    if (map.size <= MAX_TARGETS) return;
    const sorted = [...map.values()].sort((a, b) => (a.hits - b.hits) || (a.lastAt - b.lastAt));
    for (const t of sorted.slice(0, map.size - MAX_TARGETS)) map.delete(t.host);
  }

  // Навигация → возможно, новая цель. Вызывается на КАЖДУЮ навигацию, поэтому дешёвая:
  // deriveBangFromUrl — чистый разбор URL, без сети и без диска.
  learnFromUrl(rawUrl: string): void {
    const derived = deriveBangFromUrl(rawUrl);
    if (!derived) return;
    let host: string;
    try { host = new URL(rawUrl).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return; }
    if (!host) return;

    const map = this.#load();
    const prev = map.get(host);
    if (prev) {
      prev.hits += 1;
      prev.lastAt = Date.now();
      // Побеждает самый КОРОТКИЙ шаблон: один и тот же поиск на сайте даёт адреса с разным
      // хвостом (страница, сортировка, фильтры), и для цели нужен самый чистый из виденных.
      if (derived.template.length < prev.template.length) prev.template = derived.template;
    } else {
      map.set(host, {
        host, name: displayName(host), template: derived.template, hits: 1, lastAt: Date.now(),
      });
      this.#evictIfNeeded(map);
    }
    this.#scheduleSave();
  }

  // Поиск, реально запущенный через поповер, — сильнее случайного захода на выдачу: ставим
  // «плюс два», чтобы часто используемые цели поднимались в полосе чипов быстрее.
  noteUse(template: string): void {
    let host: string;
    try { host = new URL(template).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return; }
    const map = this.#load();
    const t = map.get(host);
    if (!t) return;
    t.hits += 2;
    t.lastAt = Date.now();
    this.#scheduleSave();
  }

  // Цель по хосту — для чипа «этот сайт», когда адрес текущей страницы сам поиском не является.
  // Именно по точному хосту: на ru.wikipedia.org нужен поиск по русской википедии.
  findByHost(host: string): LearnedTarget | null {
    const t = this.#load().get(host);
    return t ? { ...t, name: displayName(t.host) } : null;
  }

  // Все выученные, частые вперёд, ПО ОДНОЙ на сайт. Имя пересчитываем на выдаче, а не только
  // при записи: в файле уже могли осесть записи со старым именованием по первой метке.
  list(): LearnedTarget[] {
    const sorted = [...this.#load().values()]
      .sort((a, b) => (b.hits - a.hits) || (b.lastAt - a.lastAt));
    const bySite = new Map<string, LearnedTarget>();
    for (const t of sorted) {
      const key = siteKey(t.host);
      if (bySite.has(key)) continue; // первым идёт самый используемый — он и остаётся
      bySite.set(key, { ...t, name: displayName(t.host) });
    }
    return [...bySite.values()];
  }
}
