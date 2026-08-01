import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Send, Trash2 } from 'lucide-react';
import type { GraphChatMessage } from '../../../shared/graph';
import { markdownComponents } from '../aiMarkdown';

// Диалог узла в раскрытом виде. Переписка живёт в main (electron/GraphChat.ts), сюда
// приезжает списком и стримом — компонент только рисует и отправляет.
//
// Ответ модели БЕЗ подложки, во всю ширину; пузырь только у реплики человека — тот же
// расклад, что в чате хаба и AI-панели, и так это выглядит в любом чат-боте.

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
                    maxWidth: '80%', padding: '8px 14px', borderRadius: 'var(--radius-card)',
                    background: 'var(--surface-sunken)', border: '1px solid var(--divider)',
                    color: 'var(--text-strong)', fontSize: 'var(--fs-md)',
                    lineHeight: 'var(--lh-body)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                  }}
                >
                  {m.text}
                </div>
              </div>
            )
            : (
              <div key={i} style={{ fontSize: 'var(--fs-md)', lineHeight: 'var(--lh-body)', color: 'var(--text-body)' }}>
                <ReactMarkdown components={markdownComponents}>{m.text}</ReactMarkdown>
              </div>
            )))}

          {streaming && (
            <div style={{ fontSize: 'var(--fs-md)', lineHeight: 'var(--lh-body)', color: 'var(--text-body)' }}>
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

      <div style={{ flex: 'none', maxWidth: 780, width: '100%', margin: '0 auto', display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter отправляет, Shift+Enter переносит строку — как в любом чате.
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          placeholder="Спросите что-нибудь…"
          rows={2}
          style={{
            flex: 1, boxSizing: 'border-box', resize: 'none',
            background: 'var(--surface-sunken)', border: '1px solid var(--divider)',
            borderRadius: 'var(--radius-card)', padding: '10px 12px',
            color: 'var(--text-strong)', font: 'inherit',
            fontSize: 'var(--fs-md)', fontFamily: 'var(--font-sans)', outline: 'none',
          }}
        />
        <button
          type="button" onClick={clear} disabled={busy || messages.length === 0}
          title="Очистить переписку"
          style={{
            flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 40, height: 40, borderRadius: 'var(--radius-card)',
            background: 'var(--surface-sunken)', border: '1px solid var(--divider)',
            color: 'var(--text-muted)', cursor: busy || messages.length === 0 ? 'default' : 'pointer',
          }}
        >
          <Trash2 size={15} />
        </button>
        <button
          type="button" onClick={send} disabled={!input.trim() || busy}
          title="Отправить (Enter)"
          style={{
            flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 40, height: 40, borderRadius: 'var(--radius-card)', border: 0,
            background: input.trim() && !busy ? 'var(--accent)' : 'var(--surface-sunken)',
            color: input.trim() && !busy ? 'var(--text-on-accent)' : 'var(--text-faint)',
            cursor: input.trim() && !busy ? 'pointer' : 'default',
          }}
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}
