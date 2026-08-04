// Исполнение правил-автоматизаций. ⚠️ Здесь НЕТ модели и не может быть: она участвовала один
// раз, когда переводила фразу человека в правило (см. RuleParser.ts, шаг 3). Дальше работает
// обычный код — детерминированно, мгновенно и одинаково на каждой навигации.
//
// ⚠️ Движок ничего не знает ни про VPN, ни про адблок, ни про устройство вкладок: всё, что он
// умеет делать, приходит извне набором `RuleCapabilities`. Так исполнение проверяется само по
// себе, а main остаётся единственным местом, где живут ссылки на настоящие менеджеры (тот же
// приём, что с `setGraphMenuBuilder` у TabManager).
import { hostMatchesDomain, hostOfUrl } from '../shared/rules';
import type { AutomationRule } from '../shared/rules';

/** Событие «вкладка пришла на адрес» — ровно то, что отдаёт TabManager.setRuleHook. */
export interface RuleEvent {
  tabId: string;
  url: string;
  /** Хост страницы, с которой пришли (предыдущий адрес вкладки либо открывшая страница). */
  fromHost: string;
  incognito: boolean;
}

/** Всё, что правило умеет сделать с миром. Реализации подставляет main. */
export interface RuleCapabilities {
  groupTab: (tabId: string, groupName: string) => void;
  pinTab: (tabId: string) => void;
  adblockOff: (domain: string) => void;
  /** Включает VPN, если он выключен. true — включили ПРЯМО СЕЙЧАС (значит нужна перезагрузка). */
  ensureVpnOn: () => Promise<boolean>;
  reloadTab: (tabId: string) => void;
}

/**
 * Применяет правила к одной навигации.
 *
 * ⚠️ Инкогнито пропускаем целиком. Не из осторожности вообще, а по конкретной причине: часть
 * действий оставляет постоянный след (домен в исключениях адблока), а приватная вкладка не
 * должна дописывать ничего в профиль — ровно то же решение, что у списка загрузок.
 * ⚠️ Не-http адреса (хаб, настройки, файлы) правила не касаются: у них нет сайта, к которому
 * могло бы относиться правило.
 */
export async function applyRules(
  rules: AutomationRule[],
  ev: RuleEvent,
  caps: RuleCapabilities,
): Promise<string[]> {
  if (ev.incognito || rules.length === 0) return [];
  const host = hostOfUrl(ev.url);
  if (!host) return [];

  const applied: string[] = [];
  // Перезагрузку по vpn-on делаем ОДИН раз в конце, даже если правил сработало несколько:
  // два reload подряд — это гонка навигаций на глазах у человека.
  let needsReload = false;

  for (const rule of rules) {
    const matched = rule.trigger.kind === 'site'
      ? hostMatchesDomain(host, rule.trigger.domain)
      : !!ev.fromHost && hostMatchesDomain(ev.fromHost, rule.trigger.domain);
    if (!matched) continue;

    try {
      switch (rule.action.kind) {
        case 'group':
          if (rule.action.groupName) caps.groupTab(ev.tabId, rule.action.groupName);
          break;
        case 'pin':
          caps.pinTab(ev.tabId);
          break;
        case 'adblock-off':
          // Домен берём СО СТРАНИЦЫ, а не из правила: у триггера «перешёл по ссылке с X» правило
          // говорит про источник перехода, а исключение адблока нужно тому сайту, где человек
          // оказался.
          caps.adblockOff(host);
          break;
        case 'vpn-on':
          if (await caps.ensureVpnOn()) needsReload = true;
          break;
      }
      applied.push(rule.id);
    } catch (e) {
      // Одно упавшее правило не отменяет остальные: они независимы, и человек, заведший три
      // правила, не должен терять два из-за третьего.
      console.warn(`[rules] правило ${rule.id} не выполнилось:`, (e as Error).message);
    }
  }

  // ⚠️ Перезагружаем ТОЛЬКО когда VPN включился этим самым срабатыванием. Иначе правило
  // зациклилось бы: перезагрузка → новая навигация → правило снова сработало → перезагрузка.
  if (needsReload) caps.reloadTab(ev.tabId);
  if (applied.length > 0) {
    console.log(`[rules] ${host}: сработало ${applied.length} (перезагрузка: ${needsReload ? 'да' : 'нет'})`);
  }
  return applied;
}
