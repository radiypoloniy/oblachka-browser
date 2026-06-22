import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ArrowLeft, ArrowRight, RefreshCw, Lock, Search, Shield, Sparkles, Moon, Copy, Check, Globe } from 'lucide-react';
import type { TabState, HistoryEntry } from '../../shared/ipc';
import { rankByFrecency, normalizeForOmnibox } from '../../shared/frecency';

// Высота тулбара — должна совпадать с CSS-значением (56px).
// Дропдаун позиционируется с position:fixed, top = TOOLBAR_HEIGHT.
const TOOLBAR_HEIGHT = 56;
// Дебаунс запроса к истории (мс).
const SUGGEST_DEBOUNCE = 150;
// Максимум строк в дропдауне.
const SUGGEST_MAX = 8;

type SuggestKind = 'history' | 'tab' | 'search';

interface SuggestItem {
  kind: SuggestKind;
  label: string;    // основной текст (URL или заголовок)
  sub?: string;     // вспомогательный текст
  url: string;      // URL для перехода / переключения
  tabId?: string;   // только для kind='tab'
}

interface ToolbarProps {
  tab: TabState | undefined;
  allTabs: TabState[];
  vpnOn: boolean;
  dark: boolean;
  omniboxRef?: React.RefObject<HTMLInputElement>;
  onToggleVpn: () => void;
  onToggleDark: () => void;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onSubmit: (input: string) => void;
  onSuggestToggle?: (open: boolean) => void;
}

export default function Toolbar({
  tab, allTabs, vpnOn, dark, omniboxRef: externalRef,
  onToggleVpn, onToggleDark, onBack, onForward, onReload, onSubmit, onSuggestToggle,
}: ToolbarProps) {
  const isHub = tab?.isHub ?? true;
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [suggestions, setSuggestions] = useState<SuggestItem[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(-1);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const internalRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? internalRef;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Пока не редактируем — поле отражает реальный URL вкладки.
  useEffect(() => {
    if (!editing) setValue(isHub ? '' : (tab?.url ?? ''));
  }, [tab?.url, isHub, editing]);

  // Уведомляем App о смене состояния дропдауна.
  const openDropdown = useCallback(() => {
    setDropdownOpen(true);
    onSuggestToggle?.(true);
  }, [onSuggestToggle]);

  const closeDropdown = useCallback(() => {
    setDropdownOpen(false);
    setSuggestions([]);
    setSelectedIdx(-1);
    onSuggestToggle?.(false);
  }, [onSuggestToggle]);

  // Строим список саджестов по введённой строке.
  const buildSuggestions = useCallback(async (query: string) => {
    if (!query.trim()) { closeDropdown(); return; }

    const q = query.toLowerCase();

    // 1. История: IPC-запрос + frecency-сортировка.
    let histEntries: HistoryEntry[] = [];
    try {
      histEntries = await window.oblako.searchHistory(query);
      histEntries = rankByFrecency(histEntries);
    } catch { /* история недоступна */ }

    // Дедупликация по нормализованному URL.
    const seen = new Set<string>();
    const histItems: SuggestItem[] = [];
    for (const e of histEntries) {
      const norm = normalizeForOmnibox(e.url);
      if (seen.has(norm)) continue;
      seen.add(norm);
      histItems.push({ kind: 'history', label: e.url, sub: e.title, url: e.url });
      if (histItems.length >= 5) break;
    }

    // 2. Открытые вкладки (не хаб, не спящие без URL, совпадение в url/title).
    const tabItems: SuggestItem[] = allTabs
      .filter((t) => !t.isHub && (
        t.url.toLowerCase().includes(q) || t.title.toLowerCase().includes(q)
      ))
      .map((t) => ({ kind: 'tab' as SuggestKind, label: t.url, sub: t.title, url: t.url, tabId: t.id }));

    // 3. Поисковый саджест (всегда в конце).
    const searchItem: SuggestItem = {
      kind: 'search',
      label: `Искать: ${query}`,
      url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
    };

    // Приоритет: история и вкладки сверху, поиск снизу. Ограничиваем SUGGEST_MAX строками.
    const tabUrls = new Set(tabItems.map((t) => t.url));
    const deduped = [
      ...tabItems,
      ...histItems.filter((h) => !tabUrls.has(h.url)),
    ].slice(0, SUGGEST_MAX - 1);
    deduped.push(searchItem);
    setSuggestions(deduped);
    setSelectedIdx(-1);
    openDropdown();
  }, [allTabs, openDropdown, closeDropdown]);

  // Запуск саджестов с дебаунсом.
  const triggerSuggest = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { closeDropdown(); return; }
    debounceRef.current = setTimeout(() => { void buildSuggestions(q); }, SUGGEST_DEBOUNCE);
  }, [buildSuggestions, closeDropdown]);

  const submit = (input: string) => {
    const v = input.trim();
    if (!v) return;
    onSubmit(v);
    inputRef.current?.blur();
    setEditing(false);
    closeDropdown();
    setValue(v);
  };

  const copyUrl = async () => {
    if (!tab?.url) return;
    try {
      await navigator.clipboard.writeText(tab.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch { /* noop */ }
  };

  // Клик по саджесту.
  const pickSuggestion = (item: SuggestItem) => {
    if (item.kind === 'tab' && item.tabId) {
      // Переключение на уже открытую вкладку.
      void window.oblako.activateTab(item.tabId);
      closeDropdown();
      setEditing(false);
    } else {
      submit(item.url);
    }
  };

  // Клавиатурная навигация. e.code — раскладконезависимо.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (dropdownOpen && suggestions.length > 0) {
      if (e.code === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, suggestions.length - 1));
        return;
      }
      if (e.code === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, -1));
        return;
      }
      if (e.code === 'Enter') {
        e.preventDefault();
        if (selectedIdx >= 0 && selectedIdx < suggestions.length) {
          pickSuggestion(suggestions[selectedIdx]);
        } else {
          submit(value);
        }
        return;
      }
    } else if (e.code === 'Enter') {
      submit(value);
      return;
    }
    if (e.code === 'Escape') {
      if (dropdownOpen) {
        closeDropdown();
      } else {
        inputRef.current?.blur();
        setEditing(false);
      }
    }
  };

  return (
    <div className="drag" style={{
      display: 'flex', alignItems: 'center', gap: 10, height: TOOLBAR_HEIGHT, flex: 'none',
      paddingLeft: 16,
      paddingRight: 138,
      position: 'relative', // нужно для абсолютного позиционирования омнибокса
    }}>
      <div className="no-drag" style={{ display: 'flex', gap: 2 }}>
        <button title="Назад" disabled={!tab?.canGoBack} onClick={onBack}
          style={navBtn(!tab?.canGoBack)}><ArrowLeft size={18} /></button>
        <button title="Вперёд" disabled={!tab?.canGoForward} onClick={onForward}
          style={navBtn(!tab?.canGoForward)}><ArrowRight size={18} /></button>
        <button title="Обновить" disabled={isHub} onClick={onReload}
          style={navBtn(isHub)}><RefreshCw size={17} /></button>
      </div>

      {/* Омнибокс: абсолютно центрируется по полной ширине toolbar-а (= центр contentRef).
          Внешняя обёртка pointer-events:none — боковые кнопки получают клики сквозь неё.
          Ширина: max(160px, calc(100% - 820px)) не даёт наезжать на VPN-кнопку на стандартных
          окнах; 820px = левый край (≈126px) + правый край (≈130px+138px системных) × 2.  */}
      <div style={{
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        top: 0, bottom: 0,
        display: 'flex', alignItems: 'center',
        width: 'max(160px, calc(100% - 820px))',
        maxWidth: 620,
        pointerEvents: 'none',
      }}>
        <div
          ref={containerRef}
          className="no-drag"
          style={{ width: '100%', position: 'relative', pointerEvents: 'auto' }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, height: 38,
            padding: '0 12px', borderRadius: 'var(--radius-pill)',
            background: 'var(--surface-sunken)',
            boxShadow: 'inset 0 0 0 1px var(--divider)',
          }}>
            <span style={{ color: 'var(--text-faint)', display: 'inline-flex' }}>
              {isHub ? <Search size={15} /> : <Lock size={14} />}
            </span>
            <input
              ref={inputRef}
              value={value}
              placeholder="Введите запрос или адрес"
              onChange={(e) => {
                setValue(e.target.value);
                triggerSuggest(e.target.value);
              }}
              onFocus={() => {
                setEditing(true);
                if (value.trim()) triggerSuggest(value);
              }}
              onBlur={() => {
                // Задержка: клик по саджесту успеет сработать до закрытия.
                setTimeout(() => {
                  setEditing(false);
                  closeDropdown();
                }, 150);
              }}
              onKeyDown={handleKeyDown}
              style={{
                flex: 1, border: 'none', background: 'transparent', outline: 'none',
                fontSize: 'var(--fs-sm)', color: 'var(--text-strong)',
                fontFamily: isHub ? 'var(--font-sans)' : 'var(--font-mono)',
              }}
            />
            {!isHub && tab?.url && (
              <button title="Копировать адрес" onClick={copyUrl}
                style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 3, display: 'inline-flex', color: copied ? 'var(--dot-local)' : 'var(--text-faint)' }}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            )}
          </div>

          {/* Дропдаун саджестов: position:fixed в координатах chromeView (всё окно). */}
          {dropdownOpen && suggestions.length > 0 && (() => {
            const rect = containerRef.current?.getBoundingClientRect();
            if (!rect) return null;
            return (
              <div style={{
                position: 'fixed',
                top: TOOLBAR_HEIGHT,
                left: rect.left,
                width: rect.width,
                zIndex: 200,
                background: 'var(--surface)',
                backdropFilter: 'var(--glass-filter)',
                WebkitBackdropFilter: 'var(--glass-filter)',
                borderRadius: 'var(--radius-card)',
                boxShadow: 'var(--shadow-island)',
                border: '1px solid var(--glass-edge)',
                overflow: 'hidden',
                maxHeight: 280,
                overflowY: 'auto',
              }}>
                {suggestions.map((item, idx) => (
                  <SuggestRow
                    key={`${item.kind}-${item.url}`}
                    item={item}
                    active={idx === selectedIdx}
                    onMouseDown={() => pickSuggestion(item)}
                    onMouseEnter={() => setSelectedIdx(idx)}
                  />
                ))}
              </div>
            );
          })()}
        </div>
      </div>

      {/* marginLeft: auto → правая группа прижимается к правому краю flex-контейнера */}
      <div className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
        <button onClick={onToggleVpn} title="VPN" style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 12px',
          borderRadius: 'var(--radius-pill)', border: 'none', cursor: 'default',
          background: vpnOn ? 'var(--surface)' : 'var(--surface-sunken)',
          boxShadow: vpnOn ? 'var(--shadow-card)' : 'none',
          fontSize: 'var(--fs-sm)', fontWeight: 500,
          color: vpnOn ? 'var(--text-strong)' : 'var(--text-muted)',
        }}>
          <Shield size={15} style={{ color: vpnOn ? 'var(--dot-vpn)' : 'var(--text-faint)' }} />
          {vpnOn ? 'VPN · Финляндия' : 'VPN выкл.'}
          {vpnOn && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--dot-vpn)' }} />}
        </button>
        <button title="AI-хаб" style={{ ...navBtn(false), background: 'var(--accent-soft)', color: 'var(--accent)' }}>
          <Sparkles size={18} />
        </button>
        <button title="Тема" onClick={onToggleDark}
          style={{ ...navBtn(false), color: dark ? 'var(--accent)' : 'var(--text-muted)' }}>
          <Moon size={18} />
        </button>
      </div>
    </div>
  );
}

function SuggestRow({ item, active, onMouseDown, onMouseEnter }: {
  item: SuggestItem;
  active: boolean;
  onMouseDown: () => void;
  onMouseEnter: () => void;
}) {
  const icon = item.kind === 'tab'
    ? <Globe size={13} />
    : item.kind === 'search'
      ? <Search size={13} />
      : <Globe size={13} />;

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
        cursor: 'default',
        background: active ? 'var(--surface-sunken)' : 'transparent',
        transition: 'background 0.08s',
        minWidth: 0,
      }}
    >
      <span style={{ color: 'var(--text-faint)', flex: 'none', display: 'inline-flex' }}>
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 'var(--fs-sm)', color: 'var(--text-strong)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {item.label}
        </div>
        {item.sub && (
          <div style={{
            fontSize: 'var(--fs-xs)', color: 'var(--text-muted)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {item.sub}
          </div>
        )}
      </div>
      {item.kind === 'tab' && (
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', flex: 'none' }}>
          вкладка
        </span>
      )}
    </div>
  );
}

function navBtn(disabled: boolean): React.CSSProperties {
  return {
    border: 'none', background: 'transparent', padding: 7, borderRadius: 'var(--radius-sm)',
    color: disabled ? 'var(--text-faint)' : 'var(--text-muted)',
    cursor: 'default', display: 'inline-flex', opacity: disabled ? 0.45 : 1,
  };
}
