import type React from 'react';

// ── Стиль кнопки навигации ────────────────────────────────────────────────────
// Живёт здесь (не в Toolbar.tsx), потому что islandBtn ниже строится поверх неё —
// вынесены вместе, чтобы не создавать циклический импорт между Toolbar.tsx и этим модулем.
export function navBtn(disabled: boolean): React.CSSProperties {
  return {
    border: 'none', background: 'transparent', padding: 7, borderRadius: 'var(--radius-sm)',
    color: disabled ? 'var(--text-faint)' : 'var(--text-muted)',
    cursor: 'default', display: 'inline-flex', opacity: disabled ? 0.45 : 1,
  };
}

// ── Плавающие плашки-острова ───────────────────────────────────────────────────
// Единая точка сборки «стеклянного» рецепта (фон + backdrop-blur + кант + тень) — раньше
// был продублирован по значению в 4 местах (Hub.tsx ×2, Sidebar.tsx asideBase/innerPlate,
// TabError.tsx), каждое со своими нюансами (см. ниже). Свели все в одну фабрику, чтобы менять
// сам рецепт блюра (Этап C) одной правкой, а не искать по всем копиям.
//
// Различия между местами не косметические, поэтому не слиты вслепую — параметризованы:
// - background: --surface (карточки внутри уже стеклянной поверхности, напр. поповеры) или
//   --surface-island (сами плавающие острова — Hub, сайдбар) — разные токены, разная роль
//   по вложенности (см. radii.css: острова снаружи, карточки внутри).
// - shadow: --shadow-card (дефолт, карточки) / --shadow-island (внешние острова-оболочки,
//   тяжелее) / null (плоские чипы без тени вообще, напр. QuickPromptChip в Hub.tsx).
// - border: кант --glass-edge есть почти везде, но НЕ у Sidebar::asideBase — тот кант не несёт
//   (внешняя оболочка сайдбара, кант был бы виден только по периметру всего сайдбара разом).
//
// radius сюда намеренно не входит — он всегда разный по контексту (card/pill/island), каждый
// вызывающий добавляет свой поверх (тот же паттерн, что уже был у islandPlate).
export interface GlassPlateOptions {
  surface?: 'surface' | 'surface-island';
  shadow?: 'shadow-card' | 'shadow-island' | null;
  border?: boolean;
}

// ⚠️ Каждая часть рецепта читается через ПЕРЕМЕННУЮ с текущим значением в запасном варианте.
// Это точка, куда цветной хром (тумблер «цветной сайдбар») подменяет плашки на прозрачные с
// подкраской: слой хрома ставит --plate-* на своём корне, и рецепт наследуется вниз сам.
//
// Почему переменными, а не флагом в аргументах: плашки собираются в дочерних компонентах, которые
// про тумблер не знают вовсе (пара в сплите, заголовок группы, кнопки тулбара), и флаг пришлось бы
// протаскивать через каждый уровень. Ровно на этом и погорел первый заход цветного сайдбара:
// подкраску получили только те места, где флаг был под рукой, а активная вкладка и пара в сплите
// остались белыми заплатками поверх цвета.
//
// Без --plate-* значения ровно прежние, поэтому все остальные потребители (поповеры, TabError,
// Hub) ничего не замечают: у них свои документы, где этих переменных нет.
export function glassPlate({ surface = 'surface', shadow = 'shadow-card', border = true }: GlassPlateOptions = {}): React.CSSProperties {
  return {
    background: `var(--plate-bg, var(--${surface}))`,
    backdropFilter: 'var(--plate-filter, var(--glass-filter))',
    WebkitBackdropFilter: 'var(--plate-filter, var(--glass-filter))',
    ...(shadow ? { boxShadow: `var(--plate-shadow, var(--${shadow}))` } : {}),
    ...(border ? { border: '1px solid var(--plate-edge, var(--glass-edge))' } : {}),
  };
}

// Значения --plate-* при включённом цветном хроме. Плашка становится ПРОЗРАЧНОЙ: со своей заливкой
// она выглядит наклеенной поверх цвета. Тонкая граница остаётся — без неё элемент теряет края.
export const TINTED_PLATE_VARS: React.CSSProperties = {
  ['--plate-bg' as string]: 'color-mix(in srgb, var(--sidebar-tint) 5%, transparent)',
  ['--plate-filter' as string]: 'none',
  ['--plate-edge' as string]: 'color-mix(in srgb, var(--sidebar-tint) 12%, transparent)',
  ['--plate-shadow' as string]: 'none',
};

// Изначально жили только в Toolbar.tsx — вынесены сюда для переиспользования в других панелях
// (История/Настройки/поповеры). Совпадает с glassPlate() по умолчанию — оставлен константой,
// чтобы существующие потребители (`...islandPlate`) не трогать вообще.
export const islandPlate: React.CSSProperties = glassPlate();

// ── Единая высота островов верхней полосы ──────────────────────────────────────
// ⚠️ ОДНО число на все три острова (навигация, омнибокс, правый кластер), и это не косметика.
// Раньше высота у пилюли омнибокса задавалась явно (38), а у плашек с кнопками вырастала из
// содержимого — кант 1 + поле 3 + кнопка 32 + поле 3 + кант 1 = 40. Два пикселя разницы при
// выравнивании по ВЕРХУ (`alignItems: flex-start` у полосы) дают разные нижние кромки, и полоса
// выглядит собранной кое-как. Поле в плашке поэтому ровно 2: 1 + 2 + 32 + 2 + 1 = 38.
export const ISLAND_HEIGHT = 38;

// Плашка-группа кнопок верхней полосы. Скругление — ПИЛЮЛЯ, как у омнибокса: три острова в одной
// строке обязаны быть одной формы, иначе капсула посередине и карточки по краям читаются как
// случайный набор. Токен ровно про это и заведён (radii.css: «VPN pill, status pills, round icon
// buttons»).
export function islandGroup(): React.CSSProperties {
  return {
    ...islandPlate,
    display: 'flex', alignItems: 'center', gap: 2,
    height: ISLAND_HEIGHT, padding: 2,
    borderRadius: 'var(--radius-pill)',
  };
}

// ── Кнопка ВНУТРИ плашки-кластера ──────────────────────────────────────────────
// Та же геометрия, что у navBtn, но со стеклянной плашкой НЕ на себе: её несёт группа. Нужна
// правому кластеру тулбара, который собран в один остров вместо россыпи отдельных.
//
// ⚠️ `disabled` здесь означает «недоступно на ЭТОЙ странице», и кнопка при этом остаётся на
// месте, а не исчезает. Это несущее свойство раскладки, а не косметика: набор кнопок справа
// раньше менялся от страницы к странице, из-за чего кластер «дышал», а вместе с ним ездил
// омнибокс. Приём не новый — «Обновить» на хабе ровно так же гасится, а не прячется.
export function clusterBtn({ active = false, disabled = false, color }: {
  active?: boolean; disabled?: boolean; color?: string;
} = {}): React.CSSProperties {
  return {
    ...navBtn(disabled),
    ...(color && !disabled ? { color } : {}),
    // Активное состояние (открыт свой поповер) — тот же accent-soft, что был у одиночных островов.
    ...(active && !disabled ? { background: 'var(--accent-soft)', color: 'var(--accent)' } : {}),
    // Круглая, а не со скруглением 8: кнопка стоит в капсуле высотой 38 с полем 2, и квадратные
    // углы у крайних кнопок вылезали бы за её дугу светлыми серпами при наведении.
    borderRadius: 'var(--radius-pill)',
  };
}

// Одиночная кнопка-остров (AI, адблок) — тот же islandPlate, компактный размер как у navBtn.
export function islandBtn(color?: string, bg?: string): React.CSSProperties {
  return {
    ...navBtn(false),
    ...islandPlate,
    color: color ?? 'var(--text-muted)',
    // bg передают для АКТИВНОГО состояния (акцентная заливка) — оно цветному хрому не подчиняется:
    // акцент по цветовому закону один и палитрой не переопределяется.
    background: bg ?? 'var(--plate-bg, var(--surface))',
    borderRadius: 'var(--radius-card)',
  };
}
