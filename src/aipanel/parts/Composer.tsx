import { Send, Globe } from 'lucide-react';
import { ModelChip } from '../../components/ai/ModelChip';

/**
 * Поле ввода панели. Enter отправляет, Shift+Enter переносит строку.
 *
 * ⚠️ ДВА РЯДА, а не один, и это починка живого дефекта, а не украшение. Метка модели стояла в
 * одной строке с полем и отнимала у него ширину: «Написать сообщение…» переносилось на вторую
 * строку, а высота поля рассчитана на одну — плейсхолдер обрезало по нижнему краю. Поле обязано
 * получать всю ширину; управление живёт под ним, там же, где его ждёт рука.
 *
 * ⚠️ Кнопка отправки — единственный акцентный элемент здесь, как и просит цветовой закон. Глобус
 * исключение по смыслу, а не по цвету: это НЕ send-действие, а залипающий тоггл состояния,
 * поэтому активным он светится обводкой и фоном, а сам ничего не отправляет.
 */
export function Composer({
  input, setInput, onSend, onKeyDown, onFocus, sending,
  searxngConfigured, webGroundingActive, onGlobeClick,
}: {
  input: string
  setInput: (v: string) => void
  onSend: () => void
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  onFocus: () => void
  sending: boolean
  searxngConfigured: boolean
  webGroundingActive: boolean
  onGlobeClick: () => void
}) {
  const idle = sending || !input.trim();
  return (
    <div style={{ padding: 'var(--pad-island)', flexShrink: 0 }}>
      {/* Белая парящая карточка вместо серой заливки прямо на textarea — тот же стиль, что у поля
          ввода в Hub.tsx, переиспользован буквально (surface-solid + glass-edge + shadow-card +
          radius-island), не изобретали новый. */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 2,
        padding: '10px 12px',
        background: 'var(--surface-solid)',
        borderRadius: 'var(--radius-island)', boxShadow: 'var(--shadow-card)',
        border: '1px solid var(--glass-edge)',
      }}>
        <textarea
          className="ai-composer-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          // Встали в поле — main начинает греть модель (с отсрочкой, см. WARMUP_DEFER_MS).
          // Раньше это делало само открытие панели, и человек, зашедший за калькулятором,
          // платил ~900 мс подвисания main ни за что.
          onFocus={onFocus}
          placeholder="Написать сообщение…"
          rows={1}
          style={{
            width: '100%', resize: 'none', maxHeight: 96,
            border: 'none', outline: 'none',
            background: 'transparent', padding: '4px 2px',
            fontSize: 'var(--fs-md)', fontFamily: 'var(--font-sans)',
            color: 'var(--text-strong)',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={onGlobeClick}
            title={
              !searxngConfigured
                ? 'Веб-поиск не настроен — открыть настройки'
                : webGroundingActive
                  ? 'Веб-поиск включён — нажмите, чтобы выключить'
                  : 'Включить веб-поиск (SearXNG)'
            }
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 30, height: 30, flexShrink: 0,
              background: webGroundingActive ? 'var(--accent-soft)' : 'transparent',
              border: webGroundingActive ? '1.5px solid var(--accent)' : '1.5px solid transparent',
              borderRadius: '50%',
              color: webGroundingActive ? 'var(--accent)' : 'var(--text-muted)',
              cursor: 'pointer', padding: 0,
            }}
          >
            <Globe size={16} strokeWidth={2} />
          </button>
          <ModelChip />
          <button
            onClick={onSend}
            disabled={idle}
            title="Отправить"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 30, height: 30, flexShrink: 0, marginLeft: 'auto',
              background: 'var(--accent)', border: 'none', borderRadius: '50%',
              color: 'var(--text-on-accent)',
              cursor: idle ? 'default' : 'pointer',
              opacity: idle ? 0.45 : 1,
              padding: 0,
            }}
          >
            <Send size={15} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  );
}
