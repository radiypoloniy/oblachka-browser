import { useEffect, useState } from 'react';
import { DEFAULT_SEARCH_ENGINE_ID } from '../../../shared/searchEngines';
import type { SearchEngineId } from '../../../shared/searchEngines';
import { subscribeDefaultSearchEngine } from '../../searchEngineSetting';

/**
 * Текущий поисковик по умолчанию — для капсулы в омнибоксе.
 *
 * Источник истины в main (SettingsManager); здесь только читаем id, а URL строится по общему
 * шаблону (shared/searchEngines.ts) — движок не хардкодим.
 *
 * ⚠️ Подписка обязательна, а не «на всякий случай»: тот же выбор есть в настройках («Браузер» →
 * «Поиск по умолчанию»), а тулбар над открытыми настройками остаётся на экране. Без подписки
 * капсула показывала бы прежний движок до перезапуска.
 */
export function useSearchEngine(): SearchEngineId {
  const [id, setId] = useState<SearchEngineId>(DEFAULT_SEARCH_ENGINE_ID);

  useEffect(() => {
    let mounted = true;
    window.oblako.getSearchEngine().then((v) => { if (mounted) setId(v); });
    const off = subscribeDefaultSearchEngine((v) => { if (mounted) setId(v); });
    return () => { mounted = false; off(); };
  }, []);

  return id;
}
