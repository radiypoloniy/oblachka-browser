import type React from 'react';
import { RADIUS, TEXT, sp, pad, motion } from '../styles/system';
import { overlayPlate } from '../styles/island';

// ── Набор для поповеров ───────────────────────────────────────────────────────────────────────
//
// ⚠️ ЗАЧЕМ НАБОР, А НЕ ПРАВКА КАЖДОГО ЭКРАНА. Мелких карточек в браузере восемь — пароли,
// автозаполнение, разрешения, VPN, буфер, загрузки, перевод, быстрый поиск, — и каждая делалась
// автономно, потому что общего набора под рукой не было. Итог измеряем: пара «основная и
// вторичная кнопка» объявлена ЗАНОВО в четырёх файлах и уже разъехалась (поле 7×14 против 6×12),
// вторичная везде нарисована рамкой, а список аккаунтов в паролях собран из кнопок с галочками —
// языка, которого больше нигде в интерфейсе нет.
//
// Починить это поштучно значит через месяц получить пятый вариант кнопки. Поэтому здесь пять
// элементов, из которых собирается любая карточка: КАРТОЧКА, ЗАГОЛОВОК, СТРОКА, ПАРА КНОПОК,
// ЗНАЧОК В ПЛАШКЕ.
//
// ⚠️ Все пять живут по общим законам: материал (а не белая плита), токен выбора --selected (тот
// же, что у вкладки и раздела настроек), роли текста, шкала отступов и радиусов, одна кривая
// движения. Ни одного собственного числа тут нет и быть не должно.

/** Карточка поповера. Ширину задаёт вызывающий: у разных экранов разное содержимое. */
export function PopoverCard({ width = 280, children }: { width?: number; children: React.ReactNode }) {
  return (
    <div style={{
      width,
      // ⚠️ Поверхность оверлея (непрозрачная), а не стекло: все карточки набора живут в отдельных
      // вью над страницей, где backdrop-filter не работает вовсе, и полупрозрачность означала бы
      // просвечивающий текст сайта. Разбор — у --overlay-plate в styles/tokens/colors.css.
      ...overlayPlate,
      boxShadow: 'var(--shadow-overlay)',
      borderRadius: RADIUS.box,
      padding: sp(3),
      display: 'flex', flexDirection: 'column', gap: sp(2),
    }}>
      {children}
    </div>
  );
}

/**
 * Значок в плашке акцента — «о чём эта карточка».
 *
 * ⚠️ Приём взят у запроса разрешения: там он был единственным местом в интерфейсе и читался
 * лучше всех остальных карточек. Одинокая иконка посреди карточки выглядит потерянной, плашка
 * превращает её в знак.
 */
export function PopoverIcon({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      width: 34, height: 34, borderRadius: RADIUS.control,
      display: 'grid', placeItems: 'center',
      background: 'var(--accent-soft)', color: 'var(--accent)',
    }}>
      {children}
    </span>
  );
}

/** Заголовок карточки: роль section, без собственного кегля. */
export function PopoverTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ ...TEXT.section }}>{children}</div>;
}

/** Пояснение под заголовком — что произойдёт, если согласиться. */
export function PopoverHint({ children }: { children: React.ReactNode }) {
  return <div style={{ ...TEXT.body, color: 'var(--text-muted)' }}>{children}</div>;
}

/**
 * Строка списка: значок, название, подпись.
 *
 * ⚠️ Именно СТРОКА, а не кнопка с рамкой. Рамка вокруг каждого элемента — язык, которого в
 * интерфейсе больше нигде нет; три таких прямоугольника подряд читаются формой из веб-двухтысячных.
 * Выбранное отмечается общим токеном --selected, тем же, что вкладка в сайдбаре и раздел настроек.
 */
export function PopoverRow({ icon, title, hint, trailing, selected, onClick, disabled, index }: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  hint?: React.ReactNode;
  /** Состояние справа: галочка подключения, спиннер, счётчик. Место держится всегда — см. ниже. */
  trailing?: React.ReactNode;
  selected?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  /**
   * Номер в списке — строка доезжает со ступенькой (см. keyframes popover-row-in в global.css).
   *
   * ⚠️ Опционально и по номеру, а не автоматически для всех: карточка с ОДНОЙ строкой не список,
   * и оживлять её нечем — движение там читается как дёрганье. Ступенька имеет смысл ровно там,
   * где строк несколько и глазу нужно понять, что это перечень.
   */
  index?: number;
}) {
  return (
    <button
      className="popover-row"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'flex', alignItems: 'center', gap: sp(2),
        padding: sp(1), borderRadius: RADIUS.control,
        border: 'none', background: selected ? 'var(--selected)' : 'transparent',
        color: 'var(--text-body)', textAlign: 'left', cursor: 'default', width: '100%',
        transition: motion.hover('background'),
        opacity: disabled ? 0.5 : 1,
        ...(index === undefined ? null : {
          animation: 'popover-row-in var(--dur-base) var(--ease-out) both',
          // Ступень маленькая и с потолком: список из десяти аккаунтов не должен собираться полсекунды.
          animationDelay: `${Math.min(index, 5) * 40}ms`,
        }),
      }}
    >
      {icon !== undefined && (
        <span style={{
          width: 30, height: 30, flex: 'none', borderRadius: RADIUS.control,
          display: 'grid', placeItems: 'center', overflow: 'hidden', position: 'relative',
          background: 'var(--surface-sunken)', color: 'var(--text-muted)',
          fontSize: 'var(--fs-xs)', fontWeight: 600,
        }}>
          {icon}
        </span>
      )}
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{
          display: 'block', color: 'var(--text-strong)', fontSize: 'var(--fs-sm)', fontWeight: 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{title}</span>
        {hint !== undefined && (
          <span style={{ ...TEXT.caption, display: 'block' }}>{hint}</span>
        )}
      </span>
      {/* ⚠️ Место под состояние держим ВСЕГДА, даже пустым: иначе строки без галочки выбиваются из
          общей вертикали и список «прыгает» при подключении. */}
      <span style={{ width: 16, flex: 'none', display: 'grid', placeItems: 'center' }}>{trailing}</span>
    </button>
  );
}

/**
 * Значок сайта для строки списка.
 *
 * ⚠️ Свой, а не Favicon из настроек: тот тянет за собой весь модуль настроек, а поповер — отдельная
 * точка входа со своим бандлом. Здесь нужен минимум: картинка сайта, а если её нет — первая буква
 * хоста. Вопросительный знак в макете был заглушкой; в живой карточке человек узнаёт запись по
 * значку, а не по знаку вопроса.
 */
export function SiteIcon({ host }: { host: string }) {
  // ⚠️ Сюда приезжает и голый хост, и ПОЛНЫЙ origin: состояние паролей несёт `new URL().origin`
  // («https://site.ru»), и без нормализации адрес значка складывался в «https://https://site.ru/
  // favicon.ico» — то есть картинка не грузилась НИКОГДА, а под ней вместо первой буквы сайта
  // всегда стояла «H» от «https». Заметить это глазами трудно: буква выглядит как буква.
  const clean = host.replace(/^[a-z]+:\/\//i, '').replace(/^www\./, '').replace(/[/:].*$/, '');
  const letter = (clean[0] ?? '?').toUpperCase();
  return (
    <>
      <img
        src={`https://${clean}/favicon.ico`}
        alt=""
        width={18}
        height={18}
        style={{ display: 'block', borderRadius: RADIUS.tight }}
        onError={(e) => {
          // Значка нет — прячем картинку, под ней остаётся буква.
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
      <span style={{ position: 'absolute', fontSize: 'var(--fs-xs)', fontWeight: 600, zIndex: -1 }}>{letter}</span>
    </>
  );
}

/** Человекочитаемое имя сайта: без схемы и www. Состояние поповеров несёт полный origin. */
export function hostLabel(origin: string): string {
  return origin.replace(/^[a-z]+:\/\//i, '').replace(/^www\./, '').replace(/\/$/, '');
}

/** Ряд кнопок. Основное действие ПЕРВЫМ — как во всём интерфейсе. */
export function PopoverActions({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: sp(1), marginTop: sp(1) }}>{children}</div>;
}

const buttonBase: React.CSSProperties = {
  padding: pad(1, 3), borderRadius: RADIUS.control, border: 'none',
  fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'default', flex: 'none',
  transition: motion.hover('background', 'color'),
};

/** Основное действие. */
export function PrimaryButton({ children, onClick, disabled, stretch }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean;
  /** Делить ширину поровну со второй кнопкой — когда выбор равноправный (разрешить/запретить). */
  stretch?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...buttonBase, background: 'var(--accent)', color: 'var(--on-accent)',
      opacity: disabled ? 0.5 : 1, ...(stretch ? { flex: 1 } : null),
    }}>{children}</button>
  );
}

/**
 * Тихое действие — «не сейчас», «отмена».
 *
 * ⚠️ ЗАЛИВКОЙ, А НЕ РАМКОЙ. Рамка добавляет третью линию к и без того плотной карточке (у неё
 * уже есть кромка материала и разделители), а тихая заливка отделяет кнопку от фона ровно
 * настолько, насколько нужно второму по важности действию.
 */
export function QuietButton({ children, onClick, disabled, stretch }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; stretch?: boolean;
}) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...buttonBase, background: 'var(--surface-sunken)', color: 'var(--text-body)', fontWeight: 500,
      opacity: disabled ? 0.5 : 1, ...(stretch ? { flex: 1 } : null),
    }}>{children}</button>
  );
}
