import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateRule, sameRule, RULES_MAX } from '../shared/rules';
import type { AutomationRule } from '../shared/rules';

// Хранилище правил-автоматизаций (см. shared/rules.ts — каталог, типы, валидация).
//
// Свой класс-хранилище, но БЕЗ SQLite: правил у человека единицы, писать нечего, кроме одного
// массива, — тот же расчёт, что у списка загрузок (`downloads.json`). Запись атомарная
// (tmp + rename): файл переписывается целиком на каждое изменение, и обрыв питания посреди
// записи не должен оставить человека с половиной правил.
//
// ⚠️ Читается ЛЕНИВО, на первое обращение: движок правил живёт в main и создаётся раньше
// `whenReady()`, а `app.getPath('userData')` до готовности приложения звать нельзя.
//
// ⚠️ Каждая запись с диска проходит `validateRule` заново, а не грузится как есть. Файл лежит в
// профиле открытым текстом, его могли править руками, а формат каталога со временем меняется —
// правило с исчезнувшим действием должно молча выпасть, а не дожить до исполнения.

export class RuleStore {
  #path: string | null = null;
  #rules: AutomationRule[] | null = null;

  #file(): string {
    if (!this.#path) this.#path = path.join(app.getPath('userData'), 'rules.json');
    return this.#path;
  }

  #load(): AutomationRule[] {
    if (this.#rules) return this.#rules;
    const out: AutomationRule[] = [];
    try {
      const raw = fs.readFileSync(this.#file(), 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const rule = validateRule(item);
          if (rule) out.push(rule);
        }
      }
    } catch {
      // Файла нет (первый запуск) или он битый — начинаем с пустого списка. Ронять запуск
      // браузера из-за необязательного файла нельзя.
    }
    this.#rules = out.slice(0, RULES_MAX);
    return this.#rules;
  }

  #save(): void {
    const file = this.#file();
    const tmp = `${file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.#rules ?? [], null, 2), 'utf-8');
      fs.renameSync(tmp, file);
    } catch (e) {
      console.warn('[rules] не удалось сохранить:', (e as Error).message);
    }
  }

  list(): AutomationRule[] {
    return this.#load().map((r) => ({ ...r, trigger: { ...r.trigger }, action: { ...r.action } }));
  }

  /** Только включённые — то, что исполняет движок. */
  active(): AutomationRule[] {
    return this.#load().filter((r) => r.enabled);
  }

  /**
   * Добавляет правило. Возвращает уже провалидированное — или null, если оно не прошло каталог,
   * упёрлось в потолок либо дублирует существующее.
   * ⚠️ Дубль не ошибка человека, а обычное дело: ту же мысль он мог сказать другими словами.
   * Молча заводить второе такое же правило нельзя — оно исполнялось бы дважды.
   */
  add(candidate: unknown): AutomationRule | null {
    const rules = this.#load();
    const rule = validateRule(candidate, { id: randomUUID() });
    if (!rule) return null;
    if (rules.length >= RULES_MAX) return null;
    if (rules.some((r) => sameRule(r, rule))) return null;
    rules.push(rule);
    this.#save();
    return rule;
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const rule = this.#load().find((r) => r.id === id);
    if (!rule) return false;
    rule.enabled = enabled;
    this.#save();
    return true;
  }

  remove(id: string): boolean {
    const rules = this.#load();
    const idx = rules.findIndex((r) => r.id === id);
    if (idx < 0) return false;
    rules.splice(idx, 1);
    this.#save();
    return true;
  }
}
