import { useEffect, useState } from 'react';
import { DEFAULT_INSIGHTS, type InsightsConfig, type InsightsState } from '../../shared/pageInsights';

export function usePageInsights(visible: boolean) {
  const [config, setConfig] = useState<InsightsConfig>(DEFAULT_INSIGHTS);
  const [state, setState] = useState<InsightsState | null>(null);
  useEffect(() => {
    let alive = true, received = false;
    const offConfig = window.aiPanel.onPageInsightsConfig(value => { received = true; setConfig(value); });
    const offState = window.aiPanel.onPageInsights(setState);
    void window.aiPanel.pageInsightsConfig().then(value => { if (alive && !received) setConfig(value); });
    return () => { alive = false; offConfig(); offState(); };
  }, []);
  useEffect(() => {
    window.aiPanel.watchPageInsights(visible);
    return () => window.aiPanel.watchPageInsights(false);
  }, [visible]);
  const update = async (patch: Partial<InsightsConfig>) => { setConfig(await window.aiPanel.setPageInsightsConfig(patch)); };
  return { config, state, update };
}
