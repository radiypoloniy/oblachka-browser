import { useCompare } from '../compare/useCompare';
import { InkSwitch, Subsection } from './kit';
import { useState } from 'react';
import { sp } from '../../styles/system';

export function CompareSettings() {
  const state = useCompare(), [error, setError] = useState('');
  return <Subsection title="Сравнение товаров"><div style={{ display: 'grid', gap: sp(3), fontSize: 'var(--fs-sm)', color: 'var(--text-body)' }}>
    <label style={{ display: 'flex', alignItems: 'center', gap: sp(2) }}><InkSwitch on={state?.enabled ?? true}
      onChange={() => { setError(''); void window.oblako.setTabCompareEnabled(!state?.enabled).catch(() => setError('Не удалось сохранить настройку')); }} />Предлагать сравнить похожие товары в открытых вкладках</label>
    <span style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>Предложение появляется без новой кнопки в тулбаре. Обнаружение не вызывает AI. После нажатия выбранная для работы со страницей модель готовит краткий вывод и до трёх советов; один запрос на разбор. Повторить сравнение можно в AI-панели.</span>
    {error && <span role="alert">{error}</span>}
  </div></Subsection>;
}
