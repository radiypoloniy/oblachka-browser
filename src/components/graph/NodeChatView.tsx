import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Send, Trash2 } from 'lucide-react';
import type { GraphChatMessage } from '../../../shared/graph';
import { markdownComponents } from '../aiMarkdown';

// Диалог узла в раскрытом виде. Переписка живёт в main (electron/GraphChat.ts), сюда
// приезжает списком и стримом — компонент только рисует и отправляет.
//
// Оформление списано с чата AI-панели (src/aipanel.tsx) буквально, а не «в том же духе»:
// пузырь пользователя — акцентный с белым текстом, ответ модели без подложки во всю ширину,
// поле ввода — белая парящая карточка с круглой кнопкой отправки. Диалог в графе и диалог
// на странице должны быть одним и тем же элементом, а не двумя похожими.

export default function NodeChatView({ graphId, nodeId }: { graphId: number; nodeId: string }) {
  const [messages, setMessages] = useState<GraphChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    void window.oblako.listGraphChat(graphId, nodeId).then((m) => { if (alive) setMessages(m); });
    return () => { alive = false; };
  }, [graphId, nodeId]);

  useEffect(() => {
    const offChunk = window.oblako.onGraphChatChunk((p) => {
      if (p.graphId !== graphId || p.nodeId !== nodeId) return;
      setStreaming((s) => s + p.text);
    });
    const offDone = window.oblako.onGraphChatDone((p) => {
      if (p.graphId !== graphId || p.nodeId !== nodeId) return;
      setBusy(false);
      setStreaming('');
      setError(p.ok ? null : p.error ?? 'Не получилось');
      // Перечитываем из базы, а неклеим локально: там уже лежит и вопрос, и ответ
      // ровно в том виде, в каком они переживут перезапуск.
      void window.oblako.listGraphChat(graphId, nodeId).then(setMessages);
    });
    return () => { offChunk(); offDone(); };
  }, [graphId, nodeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, streaming]);

  const send = () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    setError(null);
    setStreaming('');
    setBusy(true);
    // Показываем свою реплику сразу: ждать, пока main перечитает базу, — значит на секунду
    // видеть пустой чат после нажатия Enter.
    setMessages((m) => [...m, { at: Date.now(), role: 'user', text }]);
    window.oblako.sendGraphChat(graphId, nodeId, text);
  };

  const clear = async () => {
    if (busy) return;
    await window.oblako.clearGraphChat(graphId, nodeId);
    setMessages([]);
    setStreaming('');
    setError(null);
  };

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div style={{ maxWidth: 780, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {messages.length === 0 && !streaming && (
            <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text-muted)', lineHeight: 'var(--lh-body)' }}>
              Материал, пришедший на вход, модель увидит с первым же вопросом.
              Последний её ответ станет выходом узла и пойдёт дальше по графу.
            </div>
          )}

          {messages.map((m, i) => (m.role === 'user'
            ? (
              <div key={i} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div
                  style={{
                    maxWidth: '82%', padding: '8px 12px', borderRadius: 14,
                    background: 'var(--accent)', color: 'var(--text-on-accent)',
                    fontSize: 'var(--fs-md)', lineHeight: 'var(--lh-body)',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}
                >
                  {m.text}
                </div>
              </div>
            )
            : (
              <div key={i} style={{ fontSize: 'var(--fs-md)', lineHeight: 'var(--lh-body)', color: 'var(--text-strong)' }}>
                <ReactMarkdown components={markdownComponents}>{m.text}</ReactMarkdown>
              </div>
            )))}

          {streaming && (
            <div style={{ fontSize: 'var(--fs-md)', lineHeight: 'var(--lh-body)', color: 'var(--text-strong)' }}>
              <ReactMarkdown components={markdownComponents}>{streaming}</ReactMarkdown>
            </div>
          )}
          {busy && !streaming && (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Модель думает…</div>
          )}
          {error && (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--danger-500)' }}>{error}</div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      <div style={{ flex: 'none', maxWidth: 780, width: '100%', margin: '0 auto' }}>
        <div
          style={{
            display: 'flex', alignItems: 'flex-end', gap: 8, padding: '12px 14px',
            background: 'var(--surface-solid)', borderRadius: 'var(--radius-island)',
            boxShadow: 'var(--shadow-card)', border: '1px solid var(--glass-edge)',
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter отправляет, Shift+Enter переносит строку — как в любом чате.
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            }}
            placeholder="Написать сообщение…"
            rows={1}
            style={{
              flex: 1, resize: 'none', maxHeight: 96,
              border: 'none', outline: 'none', background: 'transparent',
              padding: '8px 12px', fontSize: 'var(--fs-md)', fontFamily: 'var(--font-sans)',
              color: 'var(--text-strong)',
            }}
          />
          <button
            type="button" onClick={clear} disabled={busy || messages.length === 0}
            title="Очистить переписку"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 34, height: 34, flexShrink: 0, padding: 0,
              background: 'transparent', border: 'none', borderRadius: '50%',
              color: 'var(--text-muted)',
              cursor: busy || messages.length === 0 ? 'default' : 'pointer',
              opacity: busy || messages.length === 0 ? 0.45 : 1,
            }}
          >
            <Trash2 size={15} strokeWidth={2} />
          </button>
          <button
            type="button" onClick={send} disabled={!input.trim() || busy}
            title="Отправить"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 34, height: 34, flexShrink: 0, padding: 0,
              background: 'var(--accent)', border: 'none', borderRadius: '50%',
              color: 'var(--text-on-accent)',
              cursor: !input.trim() || busy ? 'default' : 'pointer',
              opacity: !input.trim() || busy ? 0.45 : 1,
            }}
          >
            <Send size={15} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}
