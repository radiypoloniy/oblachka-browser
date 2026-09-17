import type { UiLanguage } from './uiLanguage';
import { CORE } from './uiCatalogCore';
import { SETTINGS } from './uiCatalogSettings';
import { HELP } from './uiCatalogHelp';
import { CHROME } from './uiCatalogChrome';
import { MORE } from './uiCatalogMore';
import { REST } from './uiCatalogRest';
import { LAUNCH } from './uiCatalogLaunch';

const EN: Record<string, string> = { ...CORE, ...SETTINGS, ...HELP, ...CHROME, ...MORE, ...REST, ...LAUNCH };

export function translate(language: UiLanguage, source: string): string {
  if (language !== 'en') return source;
  // JSX часто ломает длинное описание переносом и отступом; ключ в каталоге — одна строка.
  const hit = EN[source] ?? EN[source.replace(/\s+/g, ' ').trim()];
  return hit ?? source;
}

export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ''));
}
