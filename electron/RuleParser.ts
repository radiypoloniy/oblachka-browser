// Фраза человека → правило из закрытого каталога. ⚠️ Это ЕДИНСТВЕННОЕ место во всей фиче, где
// работает модель: один прогон на создание правила. Дальше правило исполняет обычный код
// (RuleEngine.ts), поэтому «модель ошиблась» здесь стоит ровно одну карточку, которую человек
// не подтвердит, — а не странное поведение браузера через неделю.
//
// ⚠️ Ответ модели НИЧЕГО не решает сам по себе: он проходит `validateRule` (закрытый каталог,
// см. shared/rules.ts), а затем показывается человеку карточкой на утверждение. Выдуманное
// действие отсекает валидация, выдуманный домен — человек.
//
// ⚠️ Формат ответа — ПОМЕЧЕННЫЕ СТРОКИ, а не JSON: на этом корпусе JSON у модели ломается
// (тот же вывод записан в CLAUDE.md и в normalizeQuiz). Каждое поле разбирается своей меткой,
// независимо от соседних.
//
// ⚠️ Инструкция по-английски при русской фразе — то же, на чём держатся перевод, поиск вкладки
// и смысловой Ctrl+F.
import { TRIGGERS, ACTIONS, validateRule, normalizeRuleDomain, groupNameFromDomain } from '../shared/rules';
import type { AutomationRule } from '../shared/rules';
import { runTabOrganizePrompt } from './TranslationService';

export type RuleParseResult =
  | { ok: true; rule: AutomationRule }
  | { ok: false; reason: 'unclear' | 'model-error'; error?: string };

// Черновиковый id: настоящий выдаст RuleStore при сохранении. Валидатор без id не работает —
// он один на все входы, а «правило без id» не бывает нигде, кроме этого промежуточного шага.
const DRAFT_ID = 'draft';

function buildPrompt(phrase: string): string {
  const triggers = TRIGGERS.map((t) => `- ${t.kind}: ${t.hint}`).join('\n');
  const actions = ACTIONS.map((a) => `- ${a.kind}: ${a.hint}`).join('\n');
  // ⚠️ В промпте НЕТ примеров настоящих доменов, и это не небрежность. Пока в инструкции стояло
  // «("хабр", "озон") → habr.com, ozon.ru», модель отвечала habr.com даже на фразу с ЯВНО
  // названным vtb.ru и на фразу, где сайта не было вовсе (замер: 2 ошибки из 8 — обе этот домен).
  // Пример в промпте работает как ответ по умолчанию, если модель не уверена.
  return (
    `A browser user describes an automation rule, in Russian: "${phrase}"\n\n` +
    `Triggers (pick exactly one):\n${triggers}\n\n` +
    `Actions (pick exactly one):\n${actions}\n\n` +
    `Rules for your answer:\n` +
    // ⚠️ Разбор русских оборотов дан явно, потому что именно на нём модель и путалась: «ссылки
    // с хабра» и «переходы с реддита» — это link-from, а модель уверенно отвечала site (замер).
    // Английской инструкции «the opened page is NOT on that website» ей не хватало.
    `- In Russian, "ссылки с САЙТА", "переходы с САЙТА", "открытое с САЙТА" mean link-from; ` +
    `"на САЙТЕ", "страницы САЙТА", "вкладки с САЙТА" mean site.\n` +
    `- DOMAIN must be the domain name of the website the user named in THIS phrase. ` +
    `If they named it in everyday Russian, write its real domain name.\n` +
    `- GROUP only matters when ACTION is group: use the name the user gave; ` +
    `if they gave none, use the website's short name. One or two words, no quotes.\n` +
    `- If the phrase names no website, or asks for something that is not in the lists above, ` +
    `answer "TRIGGER: none" and nothing else.\n\n` +
    `Answer with exactly these four lines and nothing else:\n` +
    `TRIGGER: <trigger name>\n` +
    `DOMAIN: <domain name>\n` +
    `ACTION: <action name>\n` +
    `GROUP: <group name, or - >`
  );
}

/** Значение помеченной строки. Разбираем каждую метку отдельно — соседняя может быть кривой. */
function labelled(out: string, label: string): string {
  const m = new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, 'im').exec(out);
  return (m?.[1] ?? '').trim().replace(/^["'«»]|["'«»]$/g, '').trim();
}

export async function parsePhraseToRule(phrase: string): Promise<RuleParseResult> {
  const p = phrase.trim();
  if (p.length < 5) return { ok: false, reason: 'unclear' };

  const res = await runTabOrganizePrompt(buildPrompt(p));
  if (!res.ok) {
    console.warn('[rules] модель не ответила:', res.error);
    return { ok: false, reason: 'model-error', error: res.error };
  }

  const out = res.out.trim();
  const trigger = labelled(out, 'TRIGGER').toLowerCase();
  const domain = labelled(out, 'DOMAIN');
  const action = labelled(out, 'ACTION').toLowerCase();
  const groupRaw = labelled(out, 'GROUP');
  // Прочерк — то, о чём просили в промпте для «имя не нужно»; пустая строка и «none» туда же.
  const named = /^([-–—]|none|нет)?$/i.test(groupRaw) ? '' : groupRaw;
  // ⚠️ Действию «группа» имя обязательно, но НЕ обязательно от модели: человек мог сказать
  // «в отдельную группу», не назвав её. Тогда берём имя от домена — и человек правит его в
  // карточке, поле там для этого и стоит. Раньше такой ответ отбраковывался целиком, и
  // безупречно разобранная фраза давала «не понял» (см. groupNameFromDomain).
  const domainForName = normalizeRuleDomain(domain);
  const groupName = named || (action === 'group' && domainForName ? groupNameFromDomain(domainForName) : '');

  const rule = validateRule(
    {
      phrase: p,
      trigger: { kind: trigger, domain },
      action: { kind: action, ...(groupName ? { groupName } : {}) },
      createdAt: Date.now(),
    },
    { id: DRAFT_ID },
  );

  // ⚠️ Детерминированная страховка поверх модели: если человек назвал сайт ЯВНО, домен обязан
  // быть тем самым. Это самая опасная ошибка разбора — карточка выглядит правильной, а домен в
  // ней чужой, и глазами это не ловится. Живой случай: на фразу «на сайте vtb.ru включай VPN»
  // модель отвечала habr.com (примером из промпта). Промпт исправлен, но проверка остаётся:
  // она стоит ноль и не зависит от везения модели.
  const spelled = [...p.matchAll(/[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+/gi)]
    .map((m) => normalizeRuleDomain(m[0]))
    .filter((d): d is string => !!d);
  const domainMismatch = !!rule && spelled.length > 0 && !spelled.includes(rule.trigger.domain);

  console.log(`[rules] «${p.slice(0, 50)}» → ${rule && !domainMismatch ? `${rule.trigger.kind}/${rule.trigger.domain}/${rule.action.kind}` : 'не разобрано'}${domainMismatch ? ` (домен разошёлся с фразой: ${rule?.trigger.domain} ≠ ${spelled.join('/')})` : ''}, ответ модели: ${JSON.stringify(out.slice(0, 120))}`);
  if (domainMismatch) return { ok: false, reason: 'unclear' };
  // Отказ — нормальный и частый исход: человек мог описать то, чего в каталоге нет вовсе
  // («удаляй историю по вечерам»). Честное «не понял» лучше правила, придуманного на ходу.
  if (!rule) return { ok: false, reason: 'unclear' };
  return { ok: true, rule };
}
