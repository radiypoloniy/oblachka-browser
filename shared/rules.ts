// Правила-автоматизации: «ссылки с хабра открывай в отдельной группе», «на банках включай VPN».
//
// ⚠️ ГЛАВНОЕ УСТРОЙСТВО: модель участвует РОВНО ОДИН РАЗ — переводит фразу человека в правило из
// ЭТОГО закрытого каталога. Дальше правило исполняет обычный код, без единого обращения к модели.
// Поэтому файл — чистые данные и проверки, без импортов electron: он одинаково нужен main
// (исполнение), renderer (экран правил) и разборщику фразы, и его можно прогнать простым node.
//
// ⚠️ КАТАЛОГ МАЛЕНЬКИЙ И БЕЗОПАСНЫЙ — это не заготовка «на вырост». Здесь нет и не должно быть
// действий «удалить», «отправить», «купить», «закрыть вкладки»: правило рождается из фразы,
// разобранной маленькой моделью, и цена ошибки разбора обязана оставаться нулевой. Всё, что тут
// есть, человек может отменить одним движением руки, и ни одно действие не трогает чужие данные.
//
// ⚠️ Каталог — ещё и ГРАНИЦА ДОВЕРИЯ: validateRule() принимает только то, что перечислено ниже.
// Ответ модели проходит через неё целиком, поэтому «модель придумала своё действие» физически
// не может стать правилом.

// ── Триггеры ────────────────────────────────────────────────────────────────

export type RuleTriggerKind =
  | 'site'       // открыта страница на этом домене (и его поддоменах)
  | 'link-from'; // страница ОТКРЫТА ссылкой с этого домена (сама она может быть где угодно)

export interface RuleTrigger {
  kind: RuleTriggerKind;
  domain: string; // нормализованный, без схемы и www
}

// ── Действия ────────────────────────────────────────────────────────────────

export type RuleActionKind =
  | 'group'       // положить вкладку в группу с заданным именем (создать, если её нет)
  | 'pin'         // закрепить вкладку
  | 'adblock-off' // не трогать этот сайт адблоком (домен в исключения)
  | 'vpn-on';     // включить VPN и перезагрузить страницу

export interface RuleAction {
  kind: RuleActionKind;
  groupName?: string; // только у 'group'
}

export interface AutomationRule {
  id: string;
  enabled: boolean;
  // Фраза, которую человек продиктовал. Хранится не из сентиментальности: в списке правил она
  // объясняет, ЗАЧЕМ правило заведено, лучше любой сгенерированной подписи.
  phrase: string;
  trigger: RuleTrigger;
  action: RuleAction;
  createdAt: number;
}

// Больше человек всё равно не удержит в голове, а каждое правило — проверка на каждой навигации.
export const RULES_MAX = 50;
export const GROUP_NAME_MAX = 24;

// ── Каталог для промпта и для карточки подтверждения ────────────────────────
// Один источник правды: и модель видит этот список, и человек читает те же слова в карточке.
// Расходиться им нельзя — иначе человек утверждает не то, что будет исполнено.

export interface TriggerSpec {
  kind: RuleTriggerKind;
  /** Как объяснить триггер модели (по-английски — см. правило промптов в CLAUDE.md). */
  hint: string;
  /** Как показать человеку. */
  describe: (domain: string) => string;
}

export interface ActionSpec {
  kind: RuleActionKind;
  hint: string;
  needsGroupName?: boolean;
  describe: (a: RuleAction) => string;
  /** Честная оговорка под карточкой — там, где действие делает не совсем то, что кажется. */
  caveat?: string;
}

export const TRIGGERS: TriggerSpec[] = [
  {
    kind: 'site',
    // ⚠️ Подсказки двух триггеров нарочно противопоставлены («страница НА сайте» против
    // «страница НЕ на сайте»): без явного противопоставления модель отправляла «ссылки с хабра»
    // в site — оба варианта звучали для неё одинаково подходяще (замер, см. RuleParser.ts).
    hint: 'the page being opened is ON that website',
    describe: (d) => `когда открываю страницу на ${d}`,
  },
  {
    kind: 'link-from',
    hint: 'the user follows a link FROM that website to another page (the opened page is NOT on that website)',
    describe: (d) => `когда перехожу по ссылке с ${d}`,
  },
];

export const ACTIONS: ActionSpec[] = [
  {
    kind: 'group',
    hint: 'put the tab into a tab group with a given name',
    needsGroupName: true,
    describe: (a) => `класть вкладку в группу «${a.groupName ?? ''}»`,
  },
  { kind: 'pin', hint: 'pin the tab', describe: () => 'закреплять вкладку' },
  {
    kind: 'adblock-off',
    hint: 'stop blocking ads on that website',
    describe: () => 'не блокировать рекламу на этом сайте',
  },
  {
    kind: 'vpn-on',
    hint: 'turn the VPN on',
    describe: () => 'включать VPN и перезагружать страницу',
    // ⚠️ Не мелкий шрифт ради приличия: первый запрос к сайту уходит РАНЬШЕ, чем правило успевает
    // сработать, — иначе человек считал бы, что зашёл на банк уже под VPN. Перезагрузка нужна
    // именно поэтому: содержимое приезжает через туннель, но самого факта обращения не вернуть.
    caveat: 'Первый запрос уже ушёл без VPN — страница перезагрузится через туннель.',
  },
];

export function triggerSpec(kind: RuleTriggerKind): TriggerSpec | null {
  return TRIGGERS.find((t) => t.kind === kind) ?? null;
}
export function actionSpec(kind: RuleActionKind): ActionSpec | null {
  return ACTIONS.find((a) => a.kind === kind) ?? null;
}

// ── Домены ──────────────────────────────────────────────────────────────────

// ⚠️ Принимает и голый домен, и полный адрес: фразу диктует человек, а «хабр» он может назвать
// как habr.com, https://habr.com/ru/all/ или www.habr.com — для правила это одно и то же место.
export function normalizeRuleDomain(raw: string): string | null {
  let s = (raw || '').trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ''); // схема
  s = s.replace(/^[^/@]*@/, '');                 // логин:пароль@
  s = s.split(/[/?#]/)[0] ?? '';                 // путь/запрос/якорь
  s = s.replace(/:\d+$/, '');                    // порт
  s = s.replace(/^www\./, '');
  s = s.replace(/\.$/, '');                      // корневая точка FQDN
  // Домен, а не произвольная строка: буквы/цифры/дефис, минимум одна точка, разумная длина.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) || s.length > 253) return null;
  return s;
}

/**
 * Имя группы по умолчанию из домена: habr.com → «Habr».
 *
 * ⚠️ Нужно там, где человек попросил «класть в отдельную группу», не назвав её. Замер стенда:
 * на фразу «ссылки с habr.com открывай в отдельной группе» модель отвечает совершенно верно
 * (link-from / habr.com / group) и честно ставит прочерк вместо имени — а правило отбраковывалось
 * целиком, потому что имя пустое. Отказ вместо разумного умолчания: человек видел «не понял
 * фразу» на образцово разобранной фразе.
 */
export function groupNameFromDomain(domain: string): string {
  const label = (domain || '').split('.')[0] ?? '';
  if (!label) return '';
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Совпадает ли хост с доменом правила — сам домен и любые его поддомены. */
export function hostMatchesDomain(host: string, domain: string): boolean {
  const h = normalizeRuleDomain(host);
  if (!h || !domain) return false;
  return h === domain || h.endsWith(`.${domain}`);
}

/** Хост из адреса. Пустая строка — адрес не про сайт (about:, файл, пустая вкладка). */
export function hostOfUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

// ── Валидация: единственная дверь, через которую правило попадает в систему ──

/**
 * Приводит произвольный объект (ответ модели, запись с диска, аргумент из renderer) к правилу
 * или отказывает. ⚠️ Отказ — нормальный исход и он БЕЗ исключения: сюда приходит в том числе
 * выдумка маленькой модели, и падать на ней нельзя.
 */
export function validateRule(input: unknown, opts?: { id?: string }): AutomationRule | null {
  if (!input || typeof input !== 'object') return null;
  const r = input as Record<string, unknown>;

  const trigger = r.trigger as Record<string, unknown> | undefined;
  const action = r.action as Record<string, unknown> | undefined;
  if (!trigger || !action) return null;

  const tKind = trigger.kind;
  const aKind = action.kind;
  if (typeof tKind !== 'string' || typeof aKind !== 'string') return null;
  const tSpec = triggerSpec(tKind as RuleTriggerKind);
  const aSpec = actionSpec(aKind as RuleActionKind);
  if (!tSpec || !aSpec) return null;

  const domain = normalizeRuleDomain(typeof trigger.domain === 'string' ? trigger.domain : '');
  if (!domain) return null;

  const validated: RuleAction = { kind: aSpec.kind };
  if (aSpec.needsGroupName) {
    const name = typeof action.groupName === 'string' ? action.groupName.trim() : '';
    // Имя группы обязательно и не пустое: группа без имени не отличима от любой другой, и
    // правило начало бы сваливать страницы в случайную существующую.
    if (!name) return null;
    validated.groupName = name.slice(0, GROUP_NAME_MAX);
  }

  const phrase = typeof r.phrase === 'string' ? r.phrase.trim().slice(0, 200) : '';
  const createdAt = typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : Date.now();
  const id = opts?.id ?? (typeof r.id === 'string' && r.id ? r.id : '');
  if (!id) return null;

  return {
    id,
    // Выключенным правило бывает только если так записано явно: новое правило человек только что
    // утвердил, и включать его отдельным движением было бы издевательством.
    enabled: r.enabled !== false,
    phrase,
    trigger: { kind: tSpec.kind, domain },
    action: validated,
    createdAt,
  };
}

/** Строка для карточки подтверждения и для списка правил. Одна на оба места — см. выше. */
export function describeRule(rule: AutomationRule): string {
  const t = triggerSpec(rule.trigger.kind);
  const a = actionSpec(rule.action.kind);
  if (!t || !a) return '';
  const head = t.describe(rule.trigger.domain);
  return `${head.charAt(0).toUpperCase()}${head.slice(1)} — ${a.describe(rule.action)}`;
}

/** Два правила «про одно и то же» — чтобы не заводить дубль на повторную фразу. */
export function sameRule(a: AutomationRule, b: AutomationRule): boolean {
  return a.trigger.kind === b.trigger.kind
    && a.trigger.domain === b.trigger.domain
    && a.action.kind === b.action.kind
    && (a.action.groupName ?? '') === (b.action.groupName ?? '');
}
