import type { AiConnectionsState } from '../../../shared/ipc';

/**
 * Мост до main для AI-частей, общих у панели и у чрома.
 *
 * ⚠️ МОСТА ДВА, и оба законны. AI-панель — отдельный WebContentsView со своим preload и своим
 * бандлом, у неё `window.aiPanel`; хаб, блокнот и граф живут в чроме, у них `window.oblako`.
 * Методы одноимённые и ходят по ОДНИМ каналам (shared/ipc), поэтому компоненту, который стоит в
 * обоих мирах, достаточно взять тот мост, что есть в этом окне.
 *
 * ⚠️ Возвращаем null, а не бросаем: компонент может оказаться в окне, где ни одного моста нет
 * (предпросмотр, тест), и падать всей панелью из-за отсутствующей метки незачем.
 */
export interface AiBridge {
  aiConnections: () => Promise<AiConnectionsState>
  setAiRoute: (role: string, connectionId: string | null) => Promise<boolean>
  onAiConnectionsChanged: (cb: (state: AiConnectionsState) => void) => () => void
  aiFileData: (id: string) => Promise<string | null>
  aiFileSave: (id: string) => Promise<boolean>
  aiTextSave: (name: string, text: string) => Promise<boolean>
}

export function aiBridge(): AiBridge | null {
  const w = window as unknown as { aiPanel?: AiBridge; oblako?: AiBridge };
  return w.aiPanel ?? w.oblako ?? null;
}
