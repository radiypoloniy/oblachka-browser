import { app, net } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { BUILTIN_BANGS, isValidBangKey, isValidBangTemplate } from '../shared/bangs';
import type { BangDef } from '../shared/bangs';

// Хранилище бэнгов омнибокса (см. shared/bangs.ts — типы, встроенный набор, разбор строки).
//
// Три источника, приоритет сверху вниз:
//   1. пользовательские (bangs.json) — их правит человек, они всегда главнее;
//   2. встроенные (BUILTIN_BANGS) — короткий курируемый набор в коде;
//   3. импортированные из DuckDuckGo (bangs-ddg.json) — необязательный большой список.
// Порядок именно такой: заведя свой «!g», пользователь обязан получить свой, а не наш; но и
// наши двадцать проверенных не должны тонуть под тринадцатью тысячами импортированных.
//
// ⚠️ Импортированный список грузится ЛЕНИВО — только когда ключ не нашёлся среди первых двух
// источников. Это принципиально: файл бывает на ~13 000 записей, и читать его при старте
// значило бы вернуть на главный поток ровно ту работу, которую мы оттуда убирали.

const DDG_BANGS_URL = 'https://duckduckgo.com/bang.js';
// Потолок на импорт — защита от неожиданно распухшего ответа: файл приходит из сети и
// разбирается в память главного процесса.
const MAX_IMPORTED = 20_000;

// Формат записи в bang.js: t — триггер, s — имя, u — шаблон с плейсхолдером {{{s}}}.
interface DdgBangRaw { t?: unknown; s?: unknown; u?: unknown }

// Домен из шаблона — для поиска по адресу («wildberries» находит цель, названную «WB»).
function hostOf(template: string): string {
  try { return new URL(template).hostname.replace(/^www\./i, '').toLowerCase(); } catch { return ''; }
}

export interface ImportBangsResult {
  ok: boolean;
  imported: number;
  error: string | null;
}

export class BangStore {
  readonly #userPath: string;
  readonly #importedPath: string;
  #user: BangDef[] = [];
  // null — ещё не пытались читать с диска (ленивая загрузка, см. шапку).
  #imported: Map<string, BangDef> | null = null;
  #builtin = new Map<string, BangDef>();

  constructor() {
    const userData = app.getPath('userData');
    this.#userPath = path.join(userData, 'bangs.json');
    this.#importedPath = path.join(userData, 'bangs-ddg.json');
    for (const b of BUILTIN_BANGS) this.#builtin.set(b.key, b);
    this.#loadUser();
  }

  // Пользовательские бэнги для UI настроек. Встроенные отдаются отдельным списком (см. ниже) —
  // мешать их в одну кучу нельзя: удалить встроенный нельзя, а UI должен это показывать.
  listUser(): BangDef[] {
    return this.#user.map((b) => ({ ...b }));
  }

  listBuiltin(): BangDef[] {
    return BUILTIN_BANGS.map((b) => ({ ...b }));
  }

  // Сколько бэнгов импортировано. Читает только размер файла-справочника, если он ещё не
  // подгружен — UI настроек показывает это число, но не обязан ради него тянуть весь список.
  importedCount(): number {
    if (this.#imported) return this.#imported.size;
    try {
      const raw = fs.readFileSync(this.#importedPath, 'utf8');
      const arr = JSON.parse(raw) as unknown;
      return Array.isArray(arr) ? arr.length : 0;
    } catch { return 0; }
  }

  // Разрешение ключа — горячий путь (зовётся на каждую навигацию из омнибокса).
  find(key: string): BangDef | null {
    const k = key.toLowerCase();
    const own = this.#user.find((b) => b.key === k);
    if (own) return own;
    const builtin = this.#builtin.get(k);
    if (builtin) return builtin;
    return this.#ensureImported().get(k) ?? null;
  }

  // Подсказки по префиксу — для будущего дропдауна и для UI. Импортированные сюда НЕ идут:
  // подсказывать из тринадцати тысяч бессмысленно, а читать файл ради каждой буквы — дорого.
  suggest(prefix: string, limit = 8): BangDef[] {
    const p = prefix.toLowerCase();
    const out: BangDef[] = [];
    const seen = new Set<string>();
    for (const b of [...this.#user, ...BUILTIN_BANGS]) {
      if (seen.has(b.key) || !b.key.startsWith(p)) continue;
      seen.add(b.key);
      out.push({ ...b });
      if (out.length >= limit) break;
    }
    return out;
  }

  // Поиск по ВСЕМ трём источникам — для выбора цели в настройках. В отличие от suggest() выше
  // импортированные сюда входят: там подсказка по префиксу ключа на горячем пути ввода, а здесь
  // человек осознанно ищет среди тринадцати тысяч, и не найти в них Wildberries было бы странно.
  //
  // ⚠️ Импортированные подтягиваются с диска только при НЕПУСТОМ запросе — пустой отдаёт то, что
  // и так в памяти, и ленивая загрузка (см. шапку) остаётся ленивой, пока человек не начал искать.
  // Перебор ~13 000 записей на запрос — обычный проход по массиву строк, дешевле одного кадра.
  searchAll(query: string, limit: number): { bang: BangDef; source: 'user' | 'builtin' | 'imported' }[] {
    const q = query.trim().toLowerCase().replace(/^!/, '');
    const pools: { list: Iterable<BangDef>; source: 'user' | 'builtin' | 'imported' }[] = [
      { list: this.#user, source: 'user' },
      { list: BUILTIN_BANGS, source: 'builtin' },
    ];
    if (q) pools.push({ list: this.#ensureImported().values(), source: 'imported' });

    const out: { bang: BangDef; source: 'user' | 'builtin' | 'imported' }[] = [];
    const seen = new Set<string>();
    // Два прохода на источник: сначала точные/начальные совпадения, потом вхождения. Иначе
    // «ozon» тонул бы в двадцати ozon-подобных именах, пришедших по алфавиту раньше.
    for (const pass of [0, 1]) {
      for (const { list, source } of pools) {
        for (const b of list) {
          if (out.length >= limit) return out;
          if (seen.has(b.key)) continue;
          const name = b.name.toLowerCase();
          const strong = !q || b.key === q || name.startsWith(q) || b.key.startsWith(q);
          const weak = q ? name.includes(q) || hostOf(b.template).includes(q) : false;
          if (pass === 0 ? !strong : !weak) continue;
          seen.add(b.key);
          out.push({ bang: { ...b }, source });
        }
      }
      if (!q) break; // пустой запрос — второго прохода нет, всё уже отдано первым
    }
    return out;
  }

  // Добавить/заменить пользовательский бэнг. Возвращает причину отказа или null при успехе —
  // строкой, а не throw: это ответ на пользовательский ввод, а не исключительная ситуация.
  upsertUser(bang: BangDef): string | null {
    const key = bang.key.trim().toLowerCase().replace(/^!/, '');
    if (!isValidBangKey(key)) return 'Ключ может содержать только латиницу, цифры, дефис и подчёркивание.';
    if (!isValidBangTemplate(bang.template)) return 'Шаблон должен содержать {query} и вести на http(s)-адрес.';
    const name = bang.name.trim() || key;
    const next: BangDef = { key, name, template: bang.template.trim() };
    if (bang.home && bang.home.trim()) next.home = bang.home.trim();
    const idx = this.#user.findIndex((b) => b.key === key);
    if (idx >= 0) this.#user[idx] = next; else this.#user.push(next);
    this.#writeUser();
    return null;
  }

  removeUser(key: string): void {
    const k = key.toLowerCase();
    const before = this.#user.length;
    this.#user = this.#user.filter((b) => b.key !== k);
    if (this.#user.length !== before) this.#writeUser();
  }

  // Импорт полного списка DuckDuckGo в userData по явной команде пользователя. В репозиторий
  // этот датасет не кладётся (чужой, 2.2 МБ) — только сюда, на диск конкретного пользователя.
  // net.fetch, а не глобальный fetch: тот не уважает session.setProxy и ходил бы мимо VPN
  // (тот же аргумент, что в AdBlockManager).
  async importDuckDuckGoBangs(): Promise<ImportBangsResult> {
    try {
      const res = await net.fetch(DDG_BANGS_URL);
      if (!res.ok) return { ok: false, imported: 0, error: `Сервер ответил ${res.status}` };
      const data = (await res.json()) as unknown;
      if (!Array.isArray(data)) return { ok: false, imported: 0, error: 'Неожиданный формат ответа' };

      const out: BangDef[] = [];
      for (const item of data as DdgBangRaw[]) {
        if (out.length >= MAX_IMPORTED) break;
        const t = typeof item?.t === 'string' ? item.t.toLowerCase() : '';
        const u = typeof item?.u === 'string' ? item.u : '';
        if (!t || !u || !isValidBangKey(t)) continue;
        // У DDG плейсхолдер {{{s}}} — приводим к нашему единому формату.
        const template = u.replace(/\{\{\{s\}\}\}/g, '{query}');
        if (!isValidBangTemplate(template)) continue;
        out.push({ key: t, name: typeof item?.s === 'string' && item.s ? item.s : t, template });
      }
      if (out.length === 0) return { ok: false, imported: 0, error: 'В ответе не нашлось ни одного пригодного бэнга' };

      this.#writeJson(this.#importedPath, out);
      this.#imported = new Map(out.map((b) => [b.key, b]));
      return { ok: true, imported: out.length, error: null };
    } catch (e) {
      return { ok: false, imported: 0, error: (e as Error).message };
    }
  }

  clearImported(): void {
    try { fs.rmSync(this.#importedPath, { force: true }); } catch { /* уже нет — и хорошо */ }
    this.#imported = new Map();
  }

  // ── Приватное ──────────────────────────────────────────────────────────────

  #ensureImported(): Map<string, BangDef> {
    if (this.#imported) return this.#imported;
    this.#imported = new Map();
    try {
      const raw = fs.readFileSync(this.#importedPath, 'utf8');
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) {
        for (const b of arr as BangDef[]) {
          if (b && typeof b.key === 'string' && typeof b.template === 'string') {
            this.#imported.set(b.key.toLowerCase(), b);
          }
        }
      }
    } catch { /* файла нет или он битый — импортированных бэнгов просто не будет */ }
    return this.#imported;
  }

  #loadUser(): void {
    try {
      const arr = JSON.parse(fs.readFileSync(this.#userPath, 'utf8')) as unknown;
      if (!Array.isArray(arr)) return;
      this.#user = (arr as BangDef[]).filter(
        (b) => b && typeof b.key === 'string' && typeof b.template === 'string' && isValidBangTemplate(b.template),
      );
    } catch { /* файла нет или битый JSON — остаёмся без пользовательских */ }
  }

  #writeUser(): void {
    this.#writeJson(this.#userPath, this.#user);
  }

  // tmp + rename — тот же приём атомарной записи, что в SettingsManager/AdBlockManager:
  // обрыв на середине не должен оставить битый файл вместо целого.
  #writeJson(target: string, data: unknown): void {
    const tmp = target + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmp, target);
    } catch (e) {
      console.error('[bangs] не удалось записать', path.basename(target), (e as Error).message);
    }
  }
}
