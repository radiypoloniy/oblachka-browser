import { useCallback, useLayoutEffect, useRef, useState } from 'react';

// Ниже COLLAPSE_THRESHOLD сайдбар схлопывается принудительно.
// Выше EXPAND_THRESHOLD — восстанавливается желаемое состояние пользователя.
// Зазор 20 px = гистерезис: убирает дёрганье на границе.
const SIDEBAR_COLLAPSE_THRESHOLD = 960;
const SIDEBAR_EXPAND_THRESHOLD   = 980;

/**
 * Схлопывание сайдбара: что выбрал человек и что реально показано.
 *
 * ⚠️ Два состояния, а не одно, и это несущее различие. desired — выбор человека (пойдёт в
 * автосейв, когда он появится). effective — что видно сейчас; на узком окне оно принудительно
 * true независимо от выбора. Схлопывание по ширине НЕ пишет в desired: иначе окно, сузившееся
 * на минуту, навсегда переписывало бы человеку его настройку.
 */
export function useSidebarCollapse() {
  const [desiredCollapsed, setDesiredCollapsed] = useState(false);
  const [effectiveCollapsed, setEffectiveCollapsed] = useState(false);
  // Реф — чтобы слушатель resize читал актуальный выбор, не пересоздаваясь на каждое изменение.
  const desiredCollapsedRef = useRef(desiredCollapsed);
  desiredCollapsedRef.current = desiredCollapsed;

  const updateSidebarCollapse = useCallback(() => {
    const w = window.innerWidth;
    if (w < SIDEBAR_COLLAPSE_THRESHOLD) {
      setEffectiveCollapsed(true);
    } else if (w >= SIDEBAR_EXPAND_THRESHOLD) {
      setEffectiveCollapsed(desiredCollapsedRef.current);
    }
    // в зоне гистерезиса [960, 980) — не меняем effective
  }, []);

  // Ручное переключение из сайдбара: всегда пишем в desired.
  // В effective применяем сразу, только если окно не в зоне принудительного схлопывания.
  const handleSidebarCollapse = useCallback((v: boolean) => {
    setDesiredCollapsed(v);
    desiredCollapsedRef.current = v;
    if (window.innerWidth >= SIDEBAR_COLLAPSE_THRESHOLD) {
      setEffectiveCollapsed(v);
    }
  }, []);

  useLayoutEffect(() => {
    updateSidebarCollapse(); // начальная проверка при маунте
    window.addEventListener('resize', updateSidebarCollapse);
    return () => window.removeEventListener('resize', updateSidebarCollapse);
  }, [updateSidebarCollapse]);

  return { collapsed: effectiveCollapsed, setCollapsed: handleSidebarCollapse };
}
