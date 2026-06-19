import { forwardRef, useRef, useState } from 'react';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import type { FindResult } from '../../shared/ipc';

interface Props {
  result: FindResult | null;
  onSearch: (query: string, forward: boolean) => void;
  onNext: (forward: boolean) => void;
  onStop: () => void;   // пустой запрос — останавливаем поиск, счётчик в null
  onClose: () => void;  // кнопка ✕ или Esc в поле
}

const FindBar = forwardRef<HTMLInputElement, Props>(
  ({ result, onSearch, onNext, onStop, onClose }, ref) => {
    const [query, setQuery] = useState('');
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = e.target.value;
      setQuery(v);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!v.trim()) {
        onStop();
        return;
      }
      // Debounce 250 мс: findInPage не вызываем на каждую букву.
      debounceRef.current = setTimeout(() => { onSearch(v, true); }, 250);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        // Приоритет панели: Esc закрывает её, страница не получает событие.
        e.preventDefault();
        e.stopPropagation();
        if (debounceRef.current) clearTimeout(debounceRef.current);
        onClose();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        onNext(!e.shiftKey); // Enter = вниз, Shift+Enter = вверх
      }
    };

    const hasResults = result !== null && result.count > 0;
    const noMatch = query.trim() !== '' && result !== null && result.count === 0;

    return (
      <div style={{
        position: 'absolute', top: 8, right: 8, zIndex: 100,
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '5px 6px',
        background: 'var(--surface)',
        backdropFilter: 'var(--glass-filter)',
        WebkitBackdropFilter: 'var(--glass-filter)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-card)',
        border: '1px solid var(--glass-edge)',
        userSelect: 'none',
      }}>
        <input
          ref={ref}
          type="text"
          autoFocus
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Найти на странице…"
          style={{
            width: 200,
            padding: '4px 8px',
            background: noMatch ? 'rgba(200,50,50,0.12)' : 'var(--surface-sunken)',
            border: '1px solid var(--glass-edge)',
            borderRadius: 'calc(var(--radius-card) / 2)',
            fontSize: 'var(--fs-sm)',
            color: noMatch ? 'var(--text-strong)' : 'var(--text-strong)',
            outline: 'none',
            transition: 'background 0.15s',
          }}
        />
        {query.trim() && result && (
          <span style={{
            fontSize: 'var(--fs-xs)',
            color: noMatch ? 'rgba(200,50,50,0.8)' : 'var(--text-faint)',
            minWidth: 48,
            textAlign: 'center',
            flexShrink: 0,
          }}>
            {noMatch ? 'нет' : `${result.activeMatch} / ${result.count}`}
          </span>
        )}
        <button
          onClick={() => onNext(false)}
          disabled={!hasResults}
          title="Предыдущее (Shift+Enter)"
          style={btnStyle(!hasResults)}
        >
          <ChevronUp size={14} strokeWidth={2} />
        </button>
        <button
          onClick={() => onNext(true)}
          disabled={!hasResults}
          title="Следующее (Enter)"
          style={btnStyle(!hasResults)}
        >
          <ChevronDown size={14} strokeWidth={2} />
        </button>
        <button onClick={onClose} title="Закрыть (Esc)" style={btnStyle(false)}>
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    );
  },
);

FindBar.displayName = 'FindBar';
export default FindBar;

function btnStyle(disabled: boolean): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    width: 26, height: 26,
    background: 'none',
    border: 'none',
    borderRadius: 'calc(var(--radius-card) / 2)',
    color: disabled ? 'var(--text-faint)' : 'var(--text-muted)',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    padding: 0,
    flexShrink: 0,
  };
}
