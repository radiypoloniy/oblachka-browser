import { useEffect, useRef, useState } from 'react';
import { Check, Globe, MessageCircle, Pin, Settings2 } from 'lucide-react';
import { RADIUS, sp } from '../../styles/system';
import { PopoverRow } from '../../components/popoverKit';
import { useLanguage } from '../../i18n';
import type { AiContextsState, ChatSource } from '../../../shared/aiContexts';
import type { ChatMessage } from '../contract';
import { PageIsland } from './PageIsland';

/**
 * Плашка над лентой с выбором источника беседы: страница, закреплённый набор или пустой чат.
 *
 * ⚠️ Меню живёт ПОД плашкой, а не в шапке панели: выбор отвечает на тот же вопрос «про что
 * беседа», что и сама плашка, и человек ищет его там, куда уже смотрит.
 * ⚠️ Наборы здесь только выбираются. Править — в настройках (пункт внизу меню): набор — это
 * абзацы инструкций, и в узкой панели их не отредактировать по-человечески.
 */
export function ContextIsland({
  source, contexts, pageTitle, pageHost, pageFavicon, faviconError, setFaviconError,
  sending, messages, modelState,
}: {
  source: ChatSource;
  contexts: AiContextsState;
  pageTitle: string;
  pageHost: string;
  pageFavicon: string | null;
  faviconError: boolean;
  setFaviconError: (v: boolean) => void;
  sending: boolean;
  messages: ChatMessage[];
  modelState: { label: string | null; loaded: boolean } | null;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Клик мимо и Esc закрывают меню. ⚠️ Esc ловится в фазе захвата и дальше не идёт: иначе тот же
  // Esc закрыл бы всю панель (usePanelShell.ts::useEscapeClose) вместо одного меню.
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [open]);

  const choose = (next: ChatSource) => {
    setOpen(false);
    window.aiPanel.setChatSource(next);
  };
  // Отвязать — значит уйти в набор по умолчанию, а если его нет, в пустой чат. Набор по умолчанию
  // человек и так выбрал «как обычно говорю с моделью» — крестик ведёт туда же.
  const unlink = () => choose(contexts.defaultId ? { kind: 'preset', id: contexts.defaultId } : { kind: 'none' });

  const preset = source.kind === 'preset' ? contexts.presets.find((p) => p.id === source.id) : undefined;
  const faint = { color: 'var(--text-faint)', flexShrink: 0 } as const;
  const lead = source.kind === 'page'
    ? (pageFavicon && !faviconError ? (
      <img
        src={pageFavicon} alt="" width={16} height={16}
        onError={() => setFaviconError(true)}
        style={{ flexShrink: 0, borderRadius: RADIUS.tight, objectFit: 'contain' }}
      />
    ) : <Globe size={16} style={faint} />)
    : source.kind === 'preset' ? <Pin size={16} style={faint} /> : <MessageCircle size={16} style={faint} />;
  const title = source.kind === 'page' ? (pageTitle || t('Новая вкладка'))
    : source.kind === 'preset' ? (preset?.title ?? pageTitle) : t('Пустой чат');
  const subtitle = source.kind === 'page' ? pageHost
    : source.kind === 'preset' ? t('Закреплённый контекст') : t('Без контекста страницы');

  return (
    <div ref={rootRef} style={{ position: 'relative', flexShrink: 0 }}>
      <PageIsland
        lead={lead} title={title} subtitle={subtitle}
        sending={sending} messages={messages} modelState={modelState}
        onOpenMenu={() => setOpen((v) => !v)} menuOpen={open}
        onUnlink={source.kind === 'page' ? unlink : undefined}
      />
      {open && (
        // ⚠️ Строки — PopoverRow из набора поповеров, а не свои: радиус строки (control, 8) с полем
        // карточки sp(1) ложится ровно в радиус коробки (box, 12) — дуги параллельны. Своя строка
        // с подобранными числами разъехалась с этой шкалой на первом же показе.
        <div role="menu" style={{
          position: 'absolute', zIndex: 5, top: '100%', left: 'var(--pad-island)', right: 'var(--pad-island)',
          marginTop: sp(1), padding: sp(1),
          display: 'flex', flexDirection: 'column', gap: 2,
          maxHeight: 340, overflowY: 'auto',
          background: 'var(--surface-solid)',
          border: '1px solid var(--glass-edge)',
          boxShadow: 'var(--shadow-card)',
          borderRadius: RADIUS.box,
        }}>
          <PopoverRow
            icon={<Globe size={15} />} title={t('Текущая страница')} hint={t('Модель читает открытую вкладку')}
            selected={source.kind === 'page'} trailing={source.kind === 'page' ? CHECK : null}
            onClick={() => choose({ kind: 'page' })}
          />
          {contexts.presets.map((p) => {
            const on = source.kind === 'preset' && source.id === p.id;
            return (
              <PopoverRow
                key={p.id} icon={<Pin size={15} />} title={p.title}
                hint={p.id === contexts.defaultId ? t('Набор по умолчанию') : t('Закреплённый набор')}
                selected={on} trailing={on ? CHECK : null}
                onClick={() => choose({ kind: 'preset', id: p.id })}
              />
            );
          })}
          <PopoverRow
            icon={<MessageCircle size={15} />} title={t('Пустой чат')} hint={t('Ни страницы, ни инструкций')}
            selected={source.kind === 'none'} trailing={source.kind === 'none' ? CHECK : null}
            onClick={() => choose({ kind: 'none' })}
          />
          <div style={{ height: 1, margin: `${sp(1)}px ${sp(2)}px`, background: 'var(--divider)' }} />
          <PopoverRow
            icon={<Settings2 size={15} />}
            title={contexts.presets.length ? t('Наборы контекста…') : t('Создать набор контекста…')}
            onClick={() => { setOpen(false); window.aiPanel.openSettings('ai'); }}
          />
        </div>
      )}
    </div>
  );
}

const CHECK = <Check size={15} style={{ color: 'var(--text-muted)' }} />;
