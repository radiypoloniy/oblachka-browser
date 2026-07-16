// Реестр пользовательских AI-скиллов (prompt-кнопок AI-панели) — Коммит 1: только хранение +
// пуш в renderer, без UI создания/редактирования (тот идёт отдельным коммитом, add/update/remove
// здесь уже реализованы, но пока их никто не вызывает).
//
// Образец — AiKeyStore.ts (свой файл на фичу + слушатели изменений), но БЕЗ safeStorage: скиллы —
// не секрет, обычные пользовательские данные. Формат записи на диск и атомарность — как у
// SettingsManager.ts (.tmp + rename, см. #write там же).
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface Skill {
  id: string
  label: string
  prompt: string
  icon?: string
  builtin?: boolean
  // Видимость кнопки в AI-панели — независима от builtin: позволяет спрятать встроенный скилл
  // с панели, не удаляя его (remove() для builtin по-прежнему запрещён, см. ниже). Не optional —
  // всегда присутствует в памяти, но НА ДИСКЕ может отсутствовать в старом skills.json (миграция
  // ниже, см. withVisibleDefault/loadFromDisk).
  visible: boolean
}

type Listener = (skills: Skill[]) => void;

// Дефолты — эквивалент двух prompt-кнопок, которые раньше были захардкожены в QUICK_ACTIONS
// (src/aipanel.tsx) — засеиваются на первом запуске, пока файла ещё нет на диске.
const DEFAULT_SKILLS: Skill[] = [
  { id: 'explain', label: 'Объяснить', prompt: 'Объясни простыми словами, о чём эта страница.', builtin: true, visible: true },
  { id: 'summary', label: 'Сделать саммари', prompt: 'Сделай краткое саммари этой страницы.', builtin: true, visible: true },
];

let skills: Skill[] = DEFAULT_SKILLS;
const listeners = new Set<Listener>();

function filePath(): string {
  return path.join(app.getPath('userData'), 'skills.json');
}

function isValidSkill(v: unknown): v is Skill {
  if (typeof v !== 'object' || v === null) return false;
  const s = v as Record<string, unknown>;
  return typeof s.id === 'string' && s.id.length > 0
    && typeof s.label === 'string' && s.label.trim().length > 0
    && typeof s.prompt === 'string' && s.prompt.trim().length > 0
    && (s.icon === undefined || typeof s.icon === 'string')
    && (s.builtin === undefined || typeof s.builtin === 'boolean')
    && typeof s.visible === 'boolean';
}

// Миграция (additive, back-compat) — skills.json, записанный ДО захода видимости, не содержит
// поле visible вообще. Отсутствие трактуем как «видима» (тумблер по умолчанию включён), а не как
// повреждённую запись — иначе isValidSkill() отбраковала бы весь старый файл на loadFromDisk()
// и молча подменила его дефолтами, что для пользователя выглядело бы как потеря своих скиллов.
// Возвращает исходное значение, если объект уже валиден/не объект — isValidSkill сам разберётся.
function withVisibleDefault(v: unknown): unknown {
  if (typeof v !== 'object' || v === null) return v;
  const s = v as Record<string, unknown>;
  return typeof s.visible === 'boolean' ? s : { ...s, visible: true };
}

// Вызывается один раз при старте (см. main.ts — рядом с aiKeyStore.loadFromDisk()). В отличие от
// AiKeyStore fs здесь не требует app.isReady(), но держим тот же явный момент загрузки, что и
// остальные *Store — не побочный эффект импорта модуля.
export function loadFromDisk(): void {
  try {
    const raw = fs.readFileSync(filePath(), 'utf8');
    const data = JSON.parse(raw) as unknown;
    if (Array.isArray(data) && data.length > 0) {
      const normalized = data.map(withVisibleDefault);
      if (normalized.every(isValidSkill)) {
        skills = normalized;
        // Что-то было домигрировано (visible отсутствовал) — подтягиваем схему на диске сразу,
        // не дожидаясь первого CRUD-действия пользователя (иначе старый формат мог бы пролежать
        // на диске сколь угодно долго без единого доказательства, что миграция вообще применилась).
        if (normalized.some((s, i) => s !== data[i])) write();
        return;
      }
    }
    console.error('[SkillsStore] skills.json повреждён/неверного формата — используются дефолты');
  } catch {
    // Файла нет — первый запуск, ниже засеиваем дефолтами и сразу пишем на диск.
  }
  skills = DEFAULT_SKILLS;
  write();
}

export function list(): Skill[] {
  return [...skills];
}

// Валидация: label/prompt непустые, id уникален. Пользовательские скиллы всегда builtin:false и
// visible:true, независимо от того, что передали (видимость правится отдельно через update()).
export function add(skill: { id: string; label: string; prompt: string; icon?: string }): boolean {
  const candidate: Skill = { ...skill, builtin: false, visible: true };
  if (!isValidSkill(candidate)) return false;
  if (skills.some((s) => s.id === candidate.id)) return false;
  skills = [...skills, candidate];
  write();
  notify();
  return true;
}

// visible — тумблер видимости в AI-панели, доступен для ЛЮБОГО скилла, в т.ч. builtin (это и есть
// способ спрятать встроенный с панели, не удаляя его — remove() ниже для builtin остаётся под
// запретом). 'builtin' сознательно не входит в Pick — правится не через этот путь.
export function update(id: string, patch: Partial<Pick<Skill, 'label' | 'prompt' | 'icon' | 'visible'>>): boolean {
  const idx = skills.findIndex((s) => s.id === id);
  if (idx === -1) return false;
  const next: Skill = { ...skills[idx], ...patch };
  if (!isValidSkill(next)) return false;
  skills = skills.map((s, i) => (i === idx ? next : s));
  write();
  notify();
  return true;
}

// Встроенные скиллы (builtin:true) не удаляются — иначе пользователь мог бы остаться без
// единой prompt-кнопки, а редактор (следующий коммит) на это не рассчитан.
export function remove(id: string): boolean {
  const target = skills.find((s) => s.id === id);
  if (!target || target.builtin) return false;
  skills = skills.filter((s) => s.id !== id);
  write();
  notify();
  return true;
}

export function onSkillsChanged(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify(): void {
  const snapshot = list();
  for (const cb of listeners) cb(snapshot);
}

function write(): void {
  const filePathValue = filePath();
  const tmpPath = filePathValue + '.tmp';
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(skills, null, 2), 'utf8');
    fs.renameSync(tmpPath, filePathValue);
  } catch (e) {
    console.error('[SkillsStore] не удалось записать skills.json:', e);
  }
}
