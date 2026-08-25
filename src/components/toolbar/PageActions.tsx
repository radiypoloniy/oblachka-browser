import type React from 'react';
import type { RefObject } from 'react';
import { Copy, Check, KeyRound, Loader2, MoreHorizontal } from 'lucide-react';
import { StarGlyph } from '../glyphs';
import { glyph } from '../../styles/system';
import type { PageTranslateState, PageTranslateProgress } from '../../../shared/ipc';

/** Общий вид значка-кнопки внутри таблетки омнибокса: без фона, крохотное поле, свой цвет. */
const iconBtn = (color: string, background = 'transparent'): React.CSSProperties => ({
  border: 'none', background, cursor: 'default', padding: 3,
  borderRadius: 'var(--radius-sm)', display: 'inline-flex', flex: 'none', color,
});

/**
 * Действия над ОТКРЫТОЙ СТРАНИЦЕЙ — правый край адресной строки: пароли, копирование адреса,
 * закладка, «⋯».
 *
 * ⚠️ Ничего из этого не появляется на хабе и на служебных экранах: там нет страницы, к которой
 * действия относились бы. Это же и отделяет ряд от правого кластера — тот про БРАУЗЕР и потому
 * постоянный, а этот про конкретную страницу и потому исчезает вместе с ней.
 */
export function PageActions(props: {
  /** Пусто — рисовать нечего (хаб, настройки, история). */
  visible: boolean;

  /** Индикатор паролей приходит от main; нет — кнопки нет вовсе. */
  hasPasswords: boolean;
  passwordsRef: RefObject<HTMLDivElement>;
  passwordsOpen: boolean;
  onTogglePasswords: () => void;

  copied: boolean;
  onCopy: () => void;

  bookmarked: boolean;
  onToggleBookmark: () => void;

  translateState: PageTranslateState;
  translateProgress: PageTranslateProgress | null;
  onMore: () => void;
}): React.ReactElement | null {
  const {
    visible, hasPasswords, passwordsRef, passwordsOpen, onTogglePasswords,
    copied, onCopy, bookmarked, onToggleBookmark,
    translateState, translateProgress, onMore,
  } = props;

  if (!visible) return null;

  const moreTitle = translateState === 'translating'
    ? (translateProgress
      ? `Перевожу страницу… ${Math.min(translateProgress.batchIndex + 1, translateProgress.batchCount)}/${translateProgress.batchCount} · ${translateProgress.charsStreamed} симв.`
      : 'Перевожу страницу…')
    : translateState === 'translated' ? 'Страница переведена — ещё действия'
      : 'Ещё действия со страницей';

  return (
    <>
      {hasPasswords && (
        <div ref={passwordsRef} style={{ display: 'inline-flex', flex: 'none' }}>
          <button
            title="Пароли"
            onClick={onTogglePasswords}
            style={{
              ...iconBtn(passwordsOpen ? 'var(--accent)' : 'var(--text-muted)',
                passwordsOpen ? 'var(--accent-soft)' : 'transparent'),
              position: 'relative',
            }}
          >
            <KeyRound {...glyph(14)} />
          </button>
        </div>
      )}

      {/* Скопировано — зелёная галочка на пару секунд: это единственный отклик, других
          подтверждений копирования у нас нет. */}
      <button title="Копировать адрес" onClick={onCopy}
        style={iconBtn(copied ? 'var(--dot-local)' : 'var(--text-faint)')}>
        {copied ? <Check {...glyph(14)} /> : <Copy {...glyph(14)} />}
      </button>

      <button title={bookmarked ? 'Удалить из закладок' : 'Добавить в закладки'}
        onClick={onToggleBookmark}
        style={iconBtn(bookmarked ? 'var(--accent)' : 'var(--text-muted)')}>
        <StarGlyph size={14} filled={bookmarked} />
      </button>

      {/* «⋯» — действия, которым не нужна постоянная кнопка: перевод и отслеживание цены (само
          меню собирает main, см. IPC.OMNIBOX_MORE_MENU).
          ⚠️ Подсвечивается акцентом, пока перевод активен. Спрятанное в меню состояние иначе не
          видно вовсе — человек не понял бы, почему страница вдруг по-русски. Отслеживание цены
          отдельного сигнала здесь не получает: акцент в полосе один, и отдавать его надо тому
          состоянию, которое меняет саму страницу. */}
      <button
        title={moreTitle}
        onClick={onMore}
        style={iconBtn(translateState === 'idle' ? 'var(--text-muted)' : 'var(--accent)')}
      >
        {translateState === 'translating'
          ? <Loader2 {...glyph(14)} style={{ animation: 'oblako-spin 1s linear infinite' }} />
          : <MoreHorizontal {...glyph(14)} />}
      </button>
    </>
  );
}
