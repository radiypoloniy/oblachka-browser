import { fill, translate } from '../shared/uiStrings';
import type { UiLanguage } from '../shared/uiLanguage';

let readLanguage: () => UiLanguage = () => 'ru';

export function bindUiLanguage(read: () => UiLanguage): void {
  readLanguage = read;
}

export function uiLanguage(): UiLanguage {
  return readLanguage();
}

export function t(source: string): string {
  return translate(readLanguage(), source);
}

export function tf(source: string, vars: Record<string, string | number>): string {
  return fill(t(source), vars);
}
