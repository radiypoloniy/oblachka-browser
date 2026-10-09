import { useEffect, useState } from 'react';
import { EMPTY_CONTEXTS, type AiContextsState } from '../../shared/aiContexts';

/**
 * Наборы контекста для меню плашки — только чтение. Править их можно лишь в настройках: панель
 * узкая, а набор — это абзацы инструкций, которые в ней не отредактировать по-человечески.
 */
export function useAiContexts(): AiContextsState {
  const [state, setState] = useState<AiContextsState>(EMPTY_CONTEXTS)
  useEffect(() => window.aiPanel.onAiContexts(setState), [])
  return state
}
