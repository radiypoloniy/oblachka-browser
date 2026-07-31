// Поисковик по умолчанию меняется из ДВУХ мест хрома: капсула в омнибоксе на хабе (Toolbar.tsx)
// и раздел настроек «Браузер» (settings/DefaultSearchBlock.tsx). Источник истины — main
// (SettingsManager), здесь только оповещение «значение сменилось»: оба места живут в ОДНОМ
// renderer'е и видны одновременно (настройки открыты — тулбар над ними никуда не делся), поэтому
// без сигнала одно из них показывало бы устаревший выбор до перемонтирования.
// Приём тот же, что у настроек новой вкладки (src/newtab/settings.ts).
import type { SearchEngineId } from '../shared/searchEngines';

const EVENT = 'oblako:search-engine-changed';

export function setDefaultSearchEngine(id: SearchEngineId): void {
  void window.oblako.setSearchEngine(id);
  window.dispatchEvent(new CustomEvent<SearchEngineId>(EVENT, { detail: id }));
}

export function subscribeDefaultSearchEngine(cb: (id: SearchEngineId) => void): () => void {
  const handler = (e: Event) => cb((e as CustomEvent<SearchEngineId>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
