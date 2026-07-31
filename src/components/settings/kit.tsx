import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { islandPlate } from '../../styles/island';

// ── Набор презентационных примитивов раздела настроек ─────────────────────────
// Здесь ТОЛЬКО рендер и стили — никакого состояния, IPC и бизнес-логики. Каждый примитив
// заменяет ручную копию разметки, которая раньше повторялась по секциям Settings.tsx
// (и чинилась по одной — см. историю: fe64c60, c11ad8c). Меняешь рецепт — меняешь здесь один раз.

// Цвет ошибок. Раньше по всем секциям стояло var(--error, #e05) — токена --error в colors.css
// не существует, т.е. всегда рендерился захардкоженный #e05 в обход цветового закона проекта.
export const errorColor = 'var(--danger-500)';

// ── Кнопки (переехали из Settings.tsx, чтобы примитивы не жили внутри потребителя) ────────────

export const btnPrimary: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 'var(--radius-sm)', border: 'none',
  background: 'var(--accent)', color: '#fff',
  fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'default', flex: 'none',
  whiteSpace: 'nowrap',
};
export const btnGhost: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--divider-strong)', background: 'transparent',
  color: 'var(--text-body)', fontSize: 'var(--fs-sm)', cursor: 'default', flex: 'none',
};

// ── Favicon сайта ─────────────────────────────────────────────────────────────
// Модульный кэш обещаний — один запрос на host на всю сессию renderer, независимо от того,
// сколько строк/перерендеров его просят (main тоже кэширует, но так не спамим IPC).
const faviconCache = new Map<string, Promise<string | null>>();
function loadFavicon(host: string): Promise<string | null> {
  let p = faviconCache.get(host);
  if (!p) { p = window.oblako.getFavicon(host); faviconCache.set(host, p); }
  return p;
}

// Иконка сайта с фолбэком на букву-заглушку (тот же приём, что в History/Bookmarks-строках,
// пока/если иконки нет). data-URL приходит из main (FaviconService), тянется только с самого
// сайта. Жил локально в PasswordsSection — переехал сюда, когда понадобился второму списку.
export function Favicon({ host, size = 20 }: { host: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    if (!host) return () => { alive = false; };
    void loadFavicon(host).then((url) => { if (alive) setSrc(url); });
    return () => { alive = false; };
  }, [host]);

  const box: React.CSSProperties = {
    width: size, height: size, borderRadius: 'var(--radius-sm)', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  };
  if (src) {
    const inner = Math.round(size * 0.8);
    return <span style={box}><img src={src} alt="" width={inner} height={inner} style={{ objectFit: 'contain' }} /></span>;
  }
  return (
    <span style={{ ...box, background: 'var(--neutral-300)', color: 'var(--text-body)', fontSize: Math.round(size / 2), fontWeight: 600 }}>
      {host.charAt(0).toUpperCase() || '?'}
    </span>
  );
}

export function IconBtn({ title, active, onClick, children }: {
  title: string; active?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        border: 'none', background: 'transparent', cursor: 'default', padding: 6,
        borderRadius: 6, display: 'inline-flex', flex: 'none',
        color: active ? 'var(--success-500)' : 'var(--text-faint)',
      }}
      onMouseEnter={(e) => { if (!active) { e.currentTarget.style.color = 'var(--text-body)'; e.currentTarget.style.background = 'var(--surface-hover)'; } }}
      onMouseLeave={(e) => { if (!active) { e.currentTarget.style.color = 'var(--text-faint)'; e.currentTarget.style.background = 'transparent'; } }}
    >{children}</button>
  );
}

// ── Заголовки и подписи ───────────────────────────────────────────────────────

// Заголовок секции верхнего уровня (h2 + серое описание под ним).
export function SectionHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div>
      <h2 style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-strong)' }}>
        {title}
      </h2>
      {children && (
        <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
          {children}
        </p>
      )}
    </div>
  );
}

// Подсекция с разделителем сверху (h3 + описание + контент). danger красит описание
// в предупреждающий цвет (рискованные операции вроде полной индексации истории).
export function Subsection({ title, description, danger, children }: {
  title: string; description?: React.ReactNode; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 12,
      paddingTop: 20, marginTop: 4, borderTop: '1px solid var(--divider)',
    }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
          {title}
        </h3>
        {description && (
          <p style={{ margin: '4px 0 0', fontSize: 'var(--fs-xs)', color: danger ? 'var(--danger-500)' : 'var(--text-faint)' }}>
            {description}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

// Капс-лейбл группы («ССЫЛКА ПОДПИСКИ», «ИСКЛЮЧЕНИЯ»…). style — для точечных отклонений
// (напр. flex:1 + ellipsis в шапке списка паролей).
export function CapsLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: 'var(--ls-caps)',
      textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8, ...style,
    }}>
      {children}
    </div>
  );
}

export function LoadingNote() {
  return <div style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>Загрузка…</div>;
}

export function InlineError({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <span style={{ fontSize: 'var(--fs-xs)', color: errorColor, ...style }}>{children}</span>;
}

export function InlineHint({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{children}</span>;
}

// ── Карточка статуса ──────────────────────────────────────────────────────────
// Иконка + заголовок + подпись + действия справа. flexWrap/minWidth — чтобы на узкой ширине
// кнопки уходили на строку ниже, а не вылезали за карточку (баг, который раньше чинился
// в каждой ручной копии отдельно).
export function StatusCard({ icon, title, subtitle, actions }: {
  icon: React.ReactNode; title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', flexWrap: 'wrap',
      ...islandPlate,
      borderRadius: 'var(--radius-sm)',
    }}>
      {icon}
      <div style={{ flex: '1 1 180px', minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2 }}>
            {subtitle}
          </div>
        )}
      </div>
      {actions}
    </div>
  );
}

// ── Поля ввода ────────────────────────────────────────────────────────────────

const inputBase: React.CSSProperties = {
  padding: '8px 12px', borderRadius: 'var(--radius-sm)',
  background: 'var(--surface)', color: 'var(--text-strong)',
  fontSize: 'var(--fs-sm)', outline: 'none',
  width: '100%', minWidth: 0, boxSizing: 'border-box',
};

// Рамка при ошибке / в покое. Фокус — через мутацию style в onFocus/onBlur (тот же приём,
// что был в ручных копиях: без ре-рендера на каждый фокус).
function borderFor(error: boolean): string {
  return error ? `1.5px solid ${errorColor}` : '1.5px solid var(--divider-strong)';
}

interface TextFieldProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: 'text' | 'password';
  mono?: boolean;
  // Текст ошибки под полем (красит и рамку). info — серая подпись, показывается когда нет ошибки.
  error?: string;
  info?: string;
  onEnter?: () => void;
  maxLength?: number;
  inputRef?: React.Ref<HTMLInputElement>;
  // style — обёртка-колонка (флекс-параметры в ряду: flex, flexBasis…), inputStyle — сам input.
  style?: React.CSSProperties;
  inputStyle?: React.CSSProperties;
}

export function TextField({
  value, onChange, placeholder, type = 'text', mono, error, info, onEnter, maxLength,
  inputRef, style, inputStyle,
}: TextFieldProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, ...style }}>
      <input
        ref={inputRef}
        type={type}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onEnter ? (e) => { if (e.key === 'Enter') onEnter(); } : undefined}
        onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
        onBlur={(e) => (e.currentTarget.style.borderColor = error ? errorColor : 'var(--divider-strong)')}
        style={{
          ...inputBase,
          border: borderFor(!!error),
          ...(mono ? { fontFamily: 'monospace' } : {}),
          ...inputStyle,
        }}
      />
      {error && <InlineError>{error}</InlineError>}
      {!error && info && <InlineHint>{info}</InlineHint>}
    </div>
  );
}

export function TextArea({ value, onChange, placeholder, rows, style }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
  style?: React.CSSProperties;
}) {
  return (
    <textarea
      value={value}
      placeholder={placeholder}
      rows={rows}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
      onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--divider-strong)')}
      style={{
        ...inputBase, border: borderFor(false),
        resize: 'vertical', fontFamily: 'inherit', ...style,
      }}
    />
  );
}

// Ряд «поле + кнопка»: на узкой ширине кнопка переносится под поле, поле не схлопывается
// (рецепт из fe64c60). Поле-ребёнок должно нести flex:'1 1 200px' (см. fieldFlex).
export function InputRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{children}</div>;
}

// Стандартные флекс-параметры поля внутри InputRow.
export const fieldFlex: React.CSSProperties = { flex: '1 1 200px' };

// ── Вариант выбора (движок перевода, модели) ──────────────────────────────────
// Переехал из Settings.tsx — общий для TranslationEngineSection и ModelsSection.

interface EngineOptionProps {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  badge?: { text: string; color: string };
  // Второй независимый бейдж (напр. «в памяти» рядом с «активна» у моделей, ModelsSection.tsx) —
  // не форкаем компонент ради второй метки, см. CLAUDE.md про переиспользование готовых компонентов.
  badge2?: { text: string; color: string };
}

export function EngineOption({ active, disabled, onClick, title, subtitle, badge, badge2 }: EngineOptionProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
        ...islandPlate, borderRadius: 'var(--radius-sm)', textAlign: 'left',
        border: 'none', cursor: disabled ? 'default' : 'default',
        boxShadow: active ? '0 0 0 1.5px var(--accent) inset' : undefined,
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {active
        ? <Check size={18} style={{ color: 'var(--accent)', flex: 'none' }} />
        : <span style={{ width: 18, flex: 'none' }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
          {title}
        </div>
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2 }}>
          {subtitle}
        </div>
      </div>
      {(badge || badge2) && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flex: 'none' }}>
          {badge && (
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 'var(--ls-caps)', textTransform: 'uppercase',
              color: badge.color,
            }}>
              {badge.text}
            </span>
          )}
          {badge2 && (
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 'var(--ls-caps)', textTransform: 'uppercase',
              color: badge2.color,
            }}>
              {badge2.text}
            </span>
          )}
        </div>
      )}
    </button>
  );
}
