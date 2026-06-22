import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ArrowLeft, ArrowRight, RefreshCw, Lock, Search, Shield, Sparkles, Moon, Copy, Check, Globe } from 'lucide-react';
import type { TabState, HistoryEntry } from '../../shared/ipc';
import { rankByFrecency, normalizeForOmnibox } from '../../shared/frecency';

// Высота тулбара — должна совпадать с CSS-значением (56px).
const TOOLBAR_HEIGHT = 56;
// Дебаунс запроса к истории (мс).
const SUGGEST_DEBOUNCE = 150;
// Максимум строк в дропдауне.
const SUGGEST_MAX = 8;

// ── VPN-пилюля: ступенчатое схлопывание ─────────────────────────────────────

type VpnMode = 'full' | 'short' | 'icon';

// Ширина тулбара (= ширина колонки), при которой переключаем режим.
// full  : полный лейбл «VPN · Финляндия» / «VPN выкл.»
// short : только «VPN» + цветной индикатор
// icon  : только иконка-щит + индикатор
const VPN_THRESHOLD_FULL  = 1150;
const VPN_THRESHOLD_SHORT =  900;

// Сколько пикселей от центра уходит правая группа кнопок (paddingRight 138 +
// кнопки + отступы) в каждом режиме. Используется для вычисления ширины омнибокса
// так, чтобы он не наезжал на правую группу (оба — вправо от центра на это значение).
const RIGHT_RESERVE: Record<VpnMode, number> = {
  full:  400, // 138 sys + ~160 VPN + 32×2 AI/Moon + 24 gap ≈ 356 + запас
  short: 315, // 138 sys +  ~85 VPN + 32×2 AI/Moon + 24 gap ≈ 311
  icon:  265, // 138 sys +  ~35 VPN + 32×2 AI/Moon + 24 gap ≈ 261
};

// ── Типы ─────────────────────────────────────────────────────────────────────

type SuggestKind = 'history' | 'tab' | 'search';

interface SuggestItem {
  kind: SuggestKind;
  label: string;
  sub?: string;
  url: string;
  tabId?: string;
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

// ── Компонент ─────────────────────────────────────────────────────────────────

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
  const [toolbarWidth, setToolbarWidth] = useState(1280);

  const internalRef = useRef<HTMLInputElement>(null);
  const inputRef = externalRef ?? internalRef;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);

  // Измеряем ширину тулбара для расчёта режима VPN и ширины омнибокса.
  useEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const update = () => setToolbarWidth(el.offsetWidth);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, []);

  // Режим VPN-пилюли и ширина омнибокса вычисляются из ширины тулбара.
  // Омнибокс растёт по мере схлопывания VPN — центр не двигается (left:50%).
  const vpnMode: VpnMode = toolbarWidth >= VPN_THRESHOLD_FULL ? 'full'
    : toolbarWidth >= VPN_THRESHOLD_SHORT ? 'short'
    : 'icon';
  const omniboxWidth = Math.min(620, Math.max(160, toolbarWidth - 2 * RIGHT_RESERVE[vpnMode]));

  // Пока не редактируем — поле отражает реальный URL вкладки.
  useEffect(() => {
    if (!editing) setValue(isHub ? '' : (tab?.url ?? ''));
  }, [tab?.url, isHub, editing]);

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

  const buildSuggestions = useCallback(async (query: string) => {
    if (!query.trim()) { closeDropdown(); return; }
    const q = query.toLowerCase();

    let histEntries: HistoryEntry[] = [];
    try {
      histEntries = await window.oblako.searchHistory(query);
      histEntries = rankByFrecency(histEntries);
    } catch { /* история недоступна */ }

    const seen = new Set<string>();
    const histItems: SuggestItem[] = [];
    for (const e of histEntries) {
      const norm = normalizeForOmnibox(e.url);
      if (seen.has(norm)) continue;
      seen.add(norm);
      histItems.push({ kind: 'history', label: e.url, sub: e.title, url: e.url });
      if (histItems.length >= 5) break;
    }

    const tabItems: SuggestItem[] = allTabs
      .filter((t) => !t.isHub && (
        t.url.toLowerCase().includes(q) || t.title.toLowerCase().includes(q)
      ))
      .map((t) => ({ kind: 'tab' as SuggestKind, label: t.url, sub: t.title, url: t.url, tabId: t.id }));

    const searchItem: SuggestItem = {
      kind: 'search',
      label: `Искать: ${query}`,
      url: `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
    };

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

  const pickSuggestion = (item: SuggestItem) => {
    if (item.kind === 'tab' && item.tabId) {
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
    <div
      ref={toolbarRef}
      className="drag"
      style={{
        display: 'flex', alignItems: 'center', gap: 10, height: TOOLBAR_HEIGHT, flex: 'none',
        paddingLeft: 16, paddingRight: 138,
        position: 'relative',
      }}
    >
      {/* Кнопки навигации */}
      <div className="no-drag" style={{ display: 'flex', gap: 2 }}>
        <button title="Назад" disabled={!tab?.canGoBack} onClick={onBack}
          style={navBtn(!tab?.canGoBack)}><ArrowLeft size={18} /></button>
        <button title="Вперёд" disabled={!tab?.canGoForward} onClick={onForward}
          style={navBtn(!tab?.canGoForward)}><ArrowRight size={18} /></button>
        <button title="Обновить" disabled={isHub} onClick={onReload}
          style={navBtn(isHub)}><RefreshCw size={17} /></button>
      </div>

      {/* Омнибокс: абсолютно по центру колонки (left:50%).
          Ширина растёт при схлопывании VPN — центральная ось неподвижна.
          pointer-events:none на внешней обёртке — боковые кнопки кликабельны насквозь. */}
      <div style={{
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        top: 0, bottom: 0,
        display: 'flex', alignItems: 'center',
        width: omniboxWidth,
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
              onChange={(e) => { setValue(e.target.value); triggerSuggest(e.target.value); }}
              onFocus={() => { setEditing(true); if (value.trim()) triggerSuggest(value); }}
              onBlur={() => {
                setTimeout(() => { setEditing(false); closeDropdown(); }, 150);
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
                style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 3,
                         display: 'inline-flex', color: copied ? 'var(--dot-local)' : 'var(--text-faint)' }}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            )}
          </div>

          {/* Дропдаун: position:fixed в координатах chromeView (всё окно). */}
          {dropdownOpen && suggestions.length > 0 && (() => {
            const rect = containerRef.current?.getBoundingClientRect();
            if (!rect) return null;
            return (
              <div style={{
                position: 'fixed', top: TOOLBAR_HEIGHT, left: rect.left, width: rect.width,
                zIndex: 200,
                background: 'var(--surface)',
                backdropFilter: 'var(--glass-filter)', WebkitBackdropFilter: 'var(--glass-filter)',
                borderRadius: 'var(--radius-card)', boxShadow: 'var(--shadow-island)',
                border: '1px solid var(--glass-edge)',
                overflow: 'hidden', maxHeight: 280, overflowY: 'auto',
              }}>
                {suggestions.map((item, idx) => (
                  <SuggestRow
                    key={`${item.kind}-${item.url}`}
                    item={item} active={idx === selectedIdx}
                    onMouseDown={() => pickSuggestion(item)}
                    onMouseEnter={() => setSelectedIdx(idx)}
                  />
                ))}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Правая группа: VPN-пилюля (схлопывается) + AI + тема.
          marginLeft:auto прижимает к правому краю flex-контейнера. */}
      <div className="no-drag" style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
        <VpnPill vpnOn={vpnOn} mode={vpnMode} onClick={onToggleVpn} />
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

// ── VPN-пилюля ───────────────────────────────────────────────────────────────

function VpnPill({ vpnOn, mode, onClick }: { vpnOn: boolean; mode: VpnMode; onClick: () => void }) {
  const shieldColor = vpnOn ? 'var(--dot-vpn)' : 'var(--text-faint)';
  const dot = vpnOn
    ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--dot-vpn)', flex: 'none' }} />
    : null;

  if (mode === 'icon') {
    // Только щит + цветная точка (если VPN включён).
    return (
      <button
        onClick={onClick}
        title={vpnOn ? 'VPN включён' : 'VPN выкл.'}
        style={{
          ...navBtn(false),
          position: 'relative',
          color: shieldColor,
          background: vpnOn ? 'var(--surface)' : 'transparent',
          boxShadow: vpnOn ? 'var(--shadow-card)' : 'none',
        }}
      >
        <Shield size={15} />
        {vpnOn && (
          // Маленький индикатор поверх иконки.
          <span style={{
            position: 'absolute', bottom: 5, right: 5,
            width: 5, height: 5, borderRadius: '50%', background: 'var(--dot-vpn)',
          }} />
        )}
      </button>
    );
  }

  if (mode === 'short') {
    // «VPN» + индикатор — без страны.
    return (
      <button
        onClick={onClick}
        title={vpnOn ? 'VPN · Финляндия' : 'VPN выкл.'}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 10px',
          borderRadius: 'var(--radius-pill)', border: 'none', cursor: 'default',
          background: vpnOn ? 'var(--surface)' : 'var(--surface-sunken)',
          boxShadow: vpnOn ? 'var(--shadow-card)' : 'none',
          fontSize: 'var(--fs-sm)', fontWeight: 500,
          color: vpnOn ? 'var(--text-strong)' : 'var(--text-muted)',
        }}
      >
        <Shield size={15} style={{ color: shieldColor }} />
        VPN
        {dot}
      </button>
    );
  }

  // full — полный лейбл.
  return (
    <button
      onClick={onClick}
      title="VPN"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7, height: 34, padding: '0 12px',
        borderRadius: 'var(--radius-pill)', border: 'none', cursor: 'default',
        background: vpnOn ? 'var(--surface)' : 'var(--surface-sunken)',
        boxShadow: vpnOn ? 'var(--shadow-card)' : 'none',
        fontSize: 'var(--fs-sm)', fontWeight: 500,
        color: vpnOn ? 'var(--text-strong)' : 'var(--text-muted)',
      }}
    >
      <Shield size={15} style={{ color: shieldColor }} />
      {vpnOn ? 'VPN · Финляндия' : 'VPN выкл.'}
      {dot}
    </button>
  );
}

// ── Строка дропдауна ──────────────────────────────────────────────────────────

function SuggestRow({ item, active, onMouseDown, onMouseEnter }: {
  item: SuggestItem;
  active: boolean;
  onMouseDown: () => void;
  onMouseEnter: () => void;
}) {
  const icon = item.kind === 'search' ? <Search size={13} /> : <Globe size={13} />;

  return (
    <div
      onMouseDown={onMouseDown}
      onMouseEnter={onMouseEnter}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
        cursor: 'default',
        background: active ? 'var(--surface-sunken)' : 'transparent',
        transition: 'background 0.08s', minWidth: 0,
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

// ── Стиль кнопки навигации ────────────────────────────────────────────────────

function navBtn(disabled: boolean): React.CSSProperties {
  return {
    border: 'none', background: 'transparent', padding: 7, borderRadius: 'var(--radius-sm)',
    color: disabled ? 'var(--text-faint)' : 'var(--text-muted)',
    cursor: 'default', display: 'inline-flex', opacity: disabled ? 0.45 : 1,
  };
}
