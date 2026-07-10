import { embeddingService } from './EmbeddingService'
import type { EmbedRequestPayload, EmbedResponsePayload } from '../../shared/ipc'

// Отвечает на embed:request от main (см. electron/EmbedClient.ts) реальным embeddingService —
// тем же синглтоном/воркером, что и AI-группировка вкладок (Sidebar.tsx). Общий канал: сегодня
// им пользуется индексатор истории, позже — семантический поиск (блок 6). Эта функция не знает
// и не должна знать, зачем понадобился вектор — это решает вызывающая сторона в main.
export function startEmbedRequestBridge(): () => void {
  return window.oblako.onEmbedRequest(async (req: EmbedRequestPayload) => {
    try {
      if (req.modelVersionOnly) {
        window.oblako.sendEmbedResponse({
          requestId: req.requestId,
          ok: true,
          vector: new Float32Array(0),
          dims: 0,
          modelVersion: embeddingService.getModelVersion(),
        })
        return
      }
      const [vector] = await embeddingService.embed([req.text])
      const res: EmbedResponsePayload = {
        requestId: req.requestId,
        ok: true,
        vector: vector!,
        dims: vector!.length,
        modelVersion: embeddingService.getModelVersion(),
      }
      window.oblako.sendEmbedResponse(res)
    } catch (e) {
      window.oblako.sendEmbedResponse({ requestId: req.requestId, ok: false, error: String(e) })
    }
  })
}
