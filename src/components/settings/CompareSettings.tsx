import { useCompare } from '../compare/useCompare';
import { InkSwitch, Subsection } from './kit';
import { useState } from 'react';

export function CompareSettings() {
  const state = useCompare(), [error, setError] = useState('');
  return <Subsection title="Сравнение товаров"><div style={{ display: 'grid', gap: 12, fontSize: 'var(--fs-sm)', color: 'var(--text-body)' }}>
    <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><InkSwitch on={state?.enabled ?? true}
      onChange={() => { setError(''); void window.oblako.setTabCompareEnabled(!state?.enabled).catch(() => setError('Не удалось сохранить настройку')); }} />Предлагать сравнить похожие товары в открытых вкладках</label>
    <span style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>Обнаружение вариантов работает без модели и платных запросов. Для сопоставления названий характеристик можно выбрать локальную или облачную модель в предложении сравнения.</span>
    {error && <span role="alert">{error}</span>}
  </div></Subsection>;
}
