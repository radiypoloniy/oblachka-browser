import { Children, Fragment, useEffect, useRef, useState } from 'react';
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
// ⚠️ Иконка запрашивается, ТОЛЬКО когда строка попала в видимую область. Раньше запрос уходил
// на монтировании, и раскрытие списка паролей выбрасывало разом по запросу на КАЖДЫЙ сохранённый
// домен — замерено: 60 записей давали заморозку в 333 мс и 2013 узлов разметки. Это ещё и было
// приватностной проблемой: одно открытие настроек означало обращение ко всем сайтам человека
// сразу, включая те, до которых он не долистал. Пункт 4 бэклога безопасности паролей.
// ⚠️ rootMargin положительный: подгружаем чуть раньше, чем строка доедет до края, иначе иконка
// появлялась бы уже на глазах — хуже, чем её отсутствие.
export function Favicon({ host, size = 20 }: { host: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  const [seen, setSeen] = useState(false);
  const boxRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (seen) return;
    const el = boxRef.current;
    // IntersectionObserver может быть недоступен только в экзотике; тогда честнее показать
    // иконки, чем не показать их никогда.
    if (!el || typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    if (!host || !seen) return () => { alive = false; };
    void loadFavicon(host).then((url) => { if (alive) setSrc(url); });
    return () => { alive = false; };
  }, [host, seen]);

  const box: React.CSSProperties = {
    width: size, height: size, borderRadius: 'var(--radius-sm)', flexShrink: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  };
  if (src) {
    const inner = Math.round(size * 0.8);
    return <span ref={boxRef} style={box}><img src={src} alt="" width={inner} height={inner} style={{ objectFit: 'contain' }} /></span>;
  }
  // Буква домена — не «пока грузится», а полноценный запасной вид: он же остаётся, если иконки
  // у сайта нет вовсе. Поэтому места под иконку хватает с первого кадра и список не дёргается.
  return (
    <span ref={boxRef} style={{ ...box, background: 'var(--neutral-300)', color: 'var(--text-body)', fontSize: Math.round(size / 2), fontWeight: 600 }}>
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
    // ⚠️ data-setting-block — якорь для поиска по настройкам (см. shared/settingsIndex.ts): по
    // нему находка прокручивает к блоку и подсвечивает его. Атрибут стоит ЗДЕСЬ, а не в каждой
    // секции: так его получают все блоки разом и новый блок не нужно не забыть пометить.
    // Расхождение имени с реестром ничего не ломает — раздел откроется, просто без подсветки.
    <div data-setting-block={title} style={{
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
// Место карточки статуса, пока её содержимое ещё едет из main. ⚠️ Повторяет геометрию
// StatusCard один в один (та же плашка, те же отступы, тот же радиус) — в этом весь смысл:
// раздел не должен подпрыгивать, когда заглушка сменится настоящей карточкой. Раньше на её
// месте была строка «Загрузка…» высотой в текст, и каждый ответ из main дёргал раскладку.
// Без мерцания и бегущих полос: их пришлось бы анимировать, а стеклянная система такого не
// прощает (см. CLAUDE.md про backdrop-filter).
export function StatusCardSkeleton() {
  const bar = (w: number, h: number): React.CSSProperties => ({
    width: w, height: h, borderRadius: 4, background: 'var(--surface-sunken)',
  });
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px', flexWrap: 'wrap',
      ...islandPlate,
      borderRadius: 'var(--radius-sm)',
    }} aria-busy="true">
      <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'var(--surface-sunken)', flex: 'none' }} />
      <div style={{ flex: '1 1 180px', minWidth: 0 }}>
        <div style={bar(120, 13)} />
        <div style={{ ...bar(230, 11), marginTop: 6 }} />
      </div>
    </div>
  );
}

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

// ── Список вариантов ──────────────────────────────────────────────────────────
//
// ⚠️ Форма поменялась по живой жалобе: «гигантские блоки с прямоугольными пятнами, ощущение
// грязи». Раньше КАЖДЫЙ вариант был отдельной залитой плашкой, и раздел AI превращался в стопку
// из восьми прямоугольников подряд (две модели, полоса памяти, два режима загрузки, карточка
// каталога, два движка перевода). На цветных палитрах заливка ещё и тонирована — стопка читалась
// грязью, и подбор цвета тут не помогает: лишней была сама заливка.
//
// Правило теперь такое: группу держат рамка и волосяные разделители, а заливка остаётся ровно у
// ВЫБРАННОГО варианта. Один залитый прямоугольник на список вместо N — это и есть разница между
// «выделено» и «пёстро».
//
// ⚠️ Разделители рисуются ЗДЕСЬ, между детьми, а не кромкой каждой строки: соседние кромки дают
// двойную линию, а у нижней строки — лишнюю над скруглением контейнера.
export function OptionList({ children }: { children: React.ReactNode }) {
  const items = Children.toArray(children).filter(Boolean);
  if (items.length === 0) return null;
  return (
    <div style={{
      border: '1px solid var(--divider-strong)',
      borderRadius: 'var(--radius-sm)',
      overflow: 'hidden',
    }}>
      {items.map((child, i) => (
        <Fragment key={i}>
          {i > 0 && <div style={{ height: 1, background: 'var(--divider)' }} />}
          {child}
        </Fragment>
      ))}
    </div>
  );
}

// ── Строка списка ─────────────────────────────────────────────────────────────
// Бывший EngineOption. Переименован вместе со сменой формы: это уже не «карточка движка», а
// строка любого списка — модели, движки, поисковики.
//
// ⚠️ width: '100%' обязателен. Строка — это <button>, а кнопка сжимается по содержимому; пока она
// была прямым ребёнком колонки, её растягивал align-items: stretch, но стоило завернуть её в
// обёртку рядом с корзиной (список моделей), как она села по тексту. На экране это выглядело как
// «плитки разной ширины» — вторая половина той же жалобы.

interface OptionRowProps {
  title: string;
  /** Узел, а не строка: строке моделей нужно дописать в подпись ошибку удаления. */
  subtitle?: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  /** Есть onClick — строка выбирается кликом; нет — это просто строка с действием справа. */
  onClick?: () => void;
  badge?: { text: string; color: string };
  // Второй независимый бейдж (напр. «в памяти» рядом с «активна» у моделей, ModelsSection.tsx) —
  // не форкаем компонент ради второй метки, см. CLAUDE.md про переиспользование компонентов.
  badge2?: { text: string; color: string };
  /** Кнопки справа (скачать, удалить, выгрузить). Живут ВНУТРИ строки, а не рядом с ней. */
  actions?: React.ReactNode;
  /** Оставлять ли слева место под галочку. По умолчанию — только у выбираемых строк. */
  selectable?: boolean;
}

export function OptionRow({
  title, subtitle, active = false, disabled, onClick, badge, badge2, actions, selectable,
}: OptionRowProps) {
  const canSelect = selectable ?? onClick !== undefined;
  // ⚠️ Заливка ТОЛЬКО у выбранного, и она из акцента, а не из палитры: у выбора ровно одно
  // значение — «вот этот», и читаться он обязан одинаково во всех палитрах и обеих темах.
  const activeFill = active ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'transparent';

  const body = (
    <>
      {canSelect && (active
        ? <Check size={18} style={{ color: 'var(--accent)', flex: 'none' }} />
        : <span style={{ width: 18, flex: 'none' }} />)}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
          {title}
        </div>
        {subtitle && (
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2, lineHeight: 1.45 }}>
            {subtitle}
          </div>
        )}
      </div>
      {(badge || badge2) && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flex: 'none' }}>
          {[badge, badge2].map((b, i) => b && (
            <span key={i} style={{
              fontSize: 'var(--fs-xs)', fontWeight: 700, letterSpacing: 'var(--ls-caps)', textTransform: 'uppercase',
              color: b.color,
            }}>
              {b.text}
            </span>
          ))}
        </div>
      )}
    </>
  );

  const shared: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', width: '100%',
    textAlign: 'left', border: 'none', boxSizing: 'border-box', flex: 1, minWidth: 0,
    background: actions ? 'transparent' : activeFill,
    opacity: disabled ? 0.55 : 1,
  };

  // Действия справа — узлом ВНЕ кнопки: кнопка внутри кнопки недопустима, поэтому при наличии
  // действий заливку выбранного несёт обёртка, а сама строка становится прозрачной.
  const row = onClick
    ? <button onClick={onClick} disabled={disabled} style={{ ...shared, cursor: 'default' }}>{body}</button>
    : <div style={shared}>{body}</div>;

  if (!actions) return row;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, paddingRight: 12, background: activeFill,
    }}>
      {row}
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>{actions}</div>
    </div>
  );
}

// ── Сегментированный переключатель ────────────────────────────────────────────
// ⚠️ Для выбора ИЗ ДВУХ-ТРЁХ коротких вариантов — вместо списка строк. Две строки-карточки под
// вопрос «когда загружать модель» занимали полэкрана, хотя выбор здесь бинарный; в пилюле он
// занимает одну строку и читается как один вопрос, а не как два предложения.
// Подпись выбранного варианта показываем ПОД пилюлей: сам сегмент обязан оставаться коротким, а
// пояснение («первый ответ займёт около 30 секунд») терять нельзя.
export function Segmented<T extends string>({ value, options, onChange }: {
  value: T;
  options: { id: T; label: string; hint?: string }[];
  onChange: (id: T) => void;
}) {
  const current = options.find((o) => o.id === value);
  return (
    <div>
      <div style={{
        display: 'inline-flex', gap: 2, padding: 3, borderRadius: 'var(--radius-sm)',
        background: 'var(--surface-sunken)', maxWidth: '100%', flexWrap: 'wrap',
      }}>
        {options.map((o) => {
          const active = o.id === value;
          return (
            <button
              key={o.id}
              onClick={() => onChange(o.id)}
              style={{
                padding: '7px 14px', borderRadius: 'calc(var(--radius-sm) - 2px)', border: 'none',
                cursor: 'default', fontSize: 'var(--fs-sm)', fontWeight: active ? 600 : 400,
                background: active ? 'var(--surface)' : 'transparent',
                boxShadow: active ? 'var(--shadow-card)' : 'none',
                color: active ? 'var(--text-strong)' : 'var(--text-muted)',
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {current?.hint && (
        <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 8 }}>
          {current.hint}
        </div>
      )}
    </div>
  );
}
