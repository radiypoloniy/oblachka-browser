import type React from 'react';
import { Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { markdownComponents } from '../../components/aiMarkdown';
import { ChatFiles } from '../../components/ai/ChatFiles';
import { DISPLAY_ROW, TEXT } from '../../styles/system';
import type { ChatMessage } from '../contract';
import type { ModelErrorCode } from '../../../shared/ipc';
import { describeChatError } from './describeChatError';
/**
 * Лента сообщений: своё, ответ модели, стрим по ходу генерации и состояния занятости.
 *
 * ⚠️ minHeight:0 у контейнера обязателен, иначе flex не даёт себе сжаться и лента выдавливает
 * поле ввода за обрез панели.
 */
export function MessageList({
  listRef, messages, streamedText, sending, factChecking, webSearching, error, errorCode, modelState,
}: {
  listRef: React.RefObject<HTMLDivElement>;
  messages: ChatMessage[];
  streamedText: string;
  sending: boolean;
  factChecking: boolean;
  webSearching: boolean;
  error: string | null;
  errorCode: ModelErrorCode | null;
  modelState: { label: string | null; loaded: boolean } | null;
}) {
  return (
  <div ref={listRef} style={{
    flex: 1, minHeight: 0, overflowY: 'auto',
    display: 'flex', flexDirection: 'column', gap: 10,
    padding: `10px var(--pad-island) var(--pad-island)`,
  }}>
    {/* ⚠️ Приглашение прижато К НИЗУ (marginTop:auto), а не висит вверху пустой ленты:
        иначе между ним и действиями у поля ввода зияет дыра во весь экран, и это читается
        как поломка. Оно отвечает на единственное, чего про панель не знают: страница уже
        прочитана, спрашивать можно словами. */}
    {messages.length === 0 && !sending && (
      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ ...DISPLAY_ROW, fontSize: 19, color: 'var(--text-strong)' }}>
          Спросите о странице
        </span>
        <span style={{ ...TEXT.caption, color: 'var(--text-muted)' }}>
          {modelState && !modelState.label
            ? 'Модели нет — скачайте её в настройках, и панель начнёт отвечать.'
            : modelState && !modelState.loaded
              ? 'Текст уже прочитан. Первый ответ дольше — модель поднимается.'
              : 'Текст уже прочитан — спрашивайте своими словами или возьмите готовое действие ниже.'}
        </span>
      </div>
    )}

    {messages.map((m, i) => (
      // Ответ модели — БЕЗ подложки и во всю ширину: так он выглядит в любом чат-боте,
      // и так его удобнее читать. Пузырь остаётся только у реплики пользователя —
      // он короткий и его роль в том, чтобы отделиться от ответа (ср. Hub.tsx).
      <div key={i} style={{
        alignSelf: m.role === 'user' ? 'flex-end' : 'stretch',
        maxWidth: m.role === 'user' ? '82%' : '100%',
        padding: m.role === 'user' ? '8px 12px' : '2px 0',
        borderRadius: m.role === 'user' ? 14 : 0,
        background: m.role === 'user' ? 'var(--accent)' : 'transparent',
        color: m.role === 'user' ? 'var(--text-on-accent)' : 'var(--text-strong)',
        overflowWrap: 'anywhere',
      }}>
        {m.role === 'assistant' ? (
          <>
            {/* ⚠️ Метка маршрута — ЕДИНСТВЕННЫЙ способ отличить облачный ответ от локального, и
                поэтому она у КАЖДОГО ответа, а не одна на панель: в одной беседе соседние ответы
                могут прийти от разных моделей — человек переключил или случился откат.
                ⚠️ Показывается только когда есть подключения: без них ответ всегда локальный, и
                метка сообщала бы ноль, занимая строку в каждом ответе. */}
            {m.via && <RouteMark via={m.via} />}
            <ReactMarkdown components={markdownComponents}>{m.text}</ReactMarkdown>
            {m.files && <ChatFiles files={m.files} />}
          </>
        ) : (
          <span style={{
            fontSize: 'var(--fs-md)', lineHeight: 'var(--lh-body)',
            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          }}>
            {m.text}
          </span>
        )}
      </div>
    ))}

    {/* «Печатающееся» сообщение ассистента — тот же markdown-рендер до и после финализации
        (react-markdown нормально переживает промежуточный незакрытый синтаксис), что и
        в поповере. */}
    {sending && (
      // ⚠️ Ровно та же геометрия, что у ГОТОВОГО ответа выше: без подложки, во всю ширину,
      // те же отступы. Раньше здесь был серый пузырь на 82% ширины, и в момент завершения
      // генерации ответ прыгал — менял ширину, отступы, скругление и фон разом. Читалось
      // так, будто подложка «спадает» с готового ответа. Правило простое: печатающийся
      // ответ и завершённый — это один и тот же ответ, отличаться им нечем.
      <div style={{
        alignSelf: 'stretch', maxWidth: '100%',
        padding: '2px 0', borderRadius: 0,
        background: 'transparent', color: 'var(--text-strong)',
        overflowWrap: 'anywhere',
      }}>
        {streamedText.length > 0 ? (
          <ReactMarkdown components={markdownComponents}>{streamedText}</ReactMarkdown>
        ) : factChecking ? (
          // Явный индикатор, отличный от «мгновенного» «…» локальных кнопок — Gemini с
          // Search Grounding занимает заметно дольше и не стримит частями, «…» тут читался
          // бы как зависание и мог спровоцировать повторный клик.
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 'var(--fs-sm)', color: 'var(--text-faint)',
          }}>
            <Loader2 size={13} style={{ animation: 'oblako-spin 1s linear infinite' }} />
            Анализирую источники…
          </span>
        ) : webSearching ? (
          // Та же дыра, что чинит factChecking выше: до первого чанка от Qwen main ещё ждёт
          // ответа от SearXNG — без явного текста «…» читался бы как зависание.
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 'var(--fs-sm)', color: 'var(--text-faint)',
          }}>
            <Loader2 size={13} style={{ animation: 'oblako-spin 1s linear infinite' }} />
            Ищу в интернете…
          </span>
        ) : (
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>…</span>
        )}
      </div>
    )}

    {error && (() => {
      const { heading, detail, showModelButton } = describeChatError(error, errorCode)
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 8,
          padding: '10px 12px',
          borderRadius: 'var(--radius-chip)',
          background: 'color-mix(in srgb, var(--danger-500) 10%, var(--surface-solid))',
          border: '1px solid color-mix(in srgb, var(--danger-500) 30%, transparent)',
        }}>
          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
            {heading}
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', lineHeight: 'var(--lh-body)' }}>
            {detail}
          </div>
          {showModelButton && (
            <button
              onClick={() => window.aiPanel.openSettings('ai')}
              style={{
                alignSelf: 'flex-start',
                padding: '5px 12px', borderRadius: 'var(--radius-chip)', border: 'none',
                background: 'var(--accent)', color: 'var(--on-accent)',
                fontSize: 'var(--fs-xs)', fontWeight: 600, cursor: 'pointer',
              }}
            >
              Выбрать модель
            </button>
          )}
        </div>
      )
    })()}
  </div>
  );
}

/**
 * Откуда пришёл ответ: точка и имя модели.
 *
 * ⚠️ СМЫСЛ НЕСЁТ И ФОРМА, а не только цвет: «здесь» — залитая точка, «облако» — кольцо. Два
 * оттенка на шести пикселях различит не каждый глаз и не каждый монитор, а заливка против контура
 * читается всегда.
 *
 * ⚠️ Ollama на localhost — это «здесь». Решает не тип подключения, а адрес: текст не покидает
 * машину, и красить его как облако значило бы соврать.
 */
function RouteMark({ via }: { via: { label: string; local: boolean } }) {
  const color = via.local ? 'var(--dot-local)' : 'var(--dot-cloud)';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4,
      fontSize: 'var(--fs-xxs, 11px)', color: 'var(--text-faint)',
      fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase',
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: '50%', flex: 'none',
        background: via.local ? color : 'transparent',
        border: via.local ? 'none' : `1.5px solid ${color}`,
      }} />
      {via.label}
    </div>
  );
}
