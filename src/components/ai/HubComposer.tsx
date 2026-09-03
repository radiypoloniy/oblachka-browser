import { Globe, MessageSquarePlus, Send } from 'lucide-react';
import type { RefObject } from 'react';
import { ModelChip } from './ModelChip';
import type { AiRole } from '../../../shared/aiRouting';

/**
 * Поле ввода чата хаба. Он же — центральная колонка блокнота: там стоит этот же AiChatView.
 *
 * ⚠️ ДВА РЯДА, а не один. Метка модели, поставленная в одну строку с полем, отнимала у него
 * ширину: плейсхолдер переносился на вторую строку, а высота поля рассчитана на одну — и его
 * обрезало по нижнему краю. Поле получает всю ширину, управление живёт под ним.
 *
 * ⚠️ Вынесено из Hub.tsx не ради красоты: AiChatView() и без того у самой границы сторожа структуры,
 * и композитор — самый обособленный её кусок (ничего, кроме своих пропсов, ему не нужно).
 */
export function HubComposer({
  fieldRef, input, setInput, onSend, streaming, onNewChat,
  searxngConfigured, webGroundingActive, onGlobeClick, role,
}: {
  /** Чья это лента: чат хаба или центральная колонка блокнота. См. ModelChip. */
  role: AiRole
  fieldRef: RefObject<HTMLTextAreaElement>
  input: string
  setInput: (v: string) => void
  onSend: () => void
  streaming: boolean
  onNewChat: () => void
  searxngConfigured: boolean
  webGroundingActive: boolean
  onGlobeClick: () => void
}) {
  const ready = input.trim() !== '' && !streaming;
  return (
    <div style={{
      flex: 'none', display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 12px',
      background: 'var(--surface-solid)', borderRadius: 'var(--radius-island)',
      boxShadow: 'var(--shadow-card)', border: '1px solid var(--glass-edge)',
    }}>
      <textarea
        ref={fieldRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
        placeholder="Напишите сообщение…"
        rows={1}
        style={{
          width: '100%', resize: 'none', border: 'none', outline: 'none', background: 'transparent',
          color: 'var(--text-strong)', fontSize: 'var(--fs-md)', fontFamily: 'inherit',
          maxHeight: 140, minHeight: 24, padding: '4px 2px',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <button
          onClick={onGlobeClick}
          title={!searxngConfigured ? 'Веб-поиск не настроен — открыть настройки' : webGroundingActive ? 'Веб-поиск включён — нажмите, чтобы выключить' : 'Включить веб-поиск (SearXNG)'}
          style={{
            flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32,
            background: webGroundingActive ? 'var(--accent-soft)' : 'transparent',
            border: webGroundingActive ? '1.5px solid var(--accent)' : '1.5px solid transparent',
            borderRadius: '50%', color: webGroundingActive ? 'var(--accent)' : 'var(--text-faint)', cursor: 'pointer', padding: 0,
          }}
        >
          <Globe size={16} strokeWidth={2} />
        </button>
        <ModelChip role={role} />
        <button
          onClick={onNewChat}
          title="Новый чат"
          style={{
            flex: 'none', marginLeft: 'auto', border: 'none', background: 'transparent', cursor: 'pointer',
            padding: 7, borderRadius: 'var(--radius-sm)', display: 'inline-flex', color: 'var(--text-faint)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-body)'; e.currentTarget.style.background = 'var(--surface-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-faint)'; e.currentTarget.style.background = 'transparent'; }}
        >
          <MessageSquarePlus size={17} />
        </button>
        <button
          onClick={onSend}
          disabled={!ready}
          title="Отправить"
          style={{
            flex: 'none', border: 'none', borderRadius: '50%', cursor: ready ? 'pointer' : 'default',
            width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: ready ? 'var(--accent)' : 'var(--surface-sunken)',
            color: ready ? 'var(--on-accent)' : 'var(--text-faint)',
          }}
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}
