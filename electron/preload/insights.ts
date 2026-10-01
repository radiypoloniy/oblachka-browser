import { ipcRenderer } from 'electron';
import { INSIGHTS, type InsightsApi, type InsightsConfig, type InsightsState } from '../../shared/pageInsights';

export const insightsBridge: InsightsApi = {
  pageInsightsConfig: () => ipcRenderer.invoke(INSIGHTS.config),
  setPageInsightsConfig: (patch) => ipcRenderer.invoke(INSIGHTS.set, patch),
  onPageInsightsConfig: (cb) => {
    const h = (_event: unknown, config: InsightsConfig) => cb(config);
    ipcRenderer.on(INSIGHTS.changed, h);
    return () => { ipcRenderer.removeListener(INSIGHTS.changed, h); };
  },
};
export const insightsPanelBridge = {
  ...insightsBridge,
  watchPageInsights: (visible: boolean) => ipcRenderer.send(INSIGHTS.watch, visible),
  runPageInsights: () => ipcRenderer.send(INSIGHTS.run),
  showInsightSource: (index: number) => ipcRenderer.send(INSIGHTS.source, index),
  onPageInsights: (cb: (state: InsightsState) => void) => {
    const h = (_event: unknown, state: InsightsState) => cb(state);
    ipcRenderer.on(INSIGHTS.state, h);
    return () => { ipcRenderer.removeListener(INSIGHTS.state, h); };
  },
};
