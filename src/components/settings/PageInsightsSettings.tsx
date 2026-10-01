import { useEffect, useState } from 'react';
import { DEFAULT_INSIGHTS, type InsightsConfig } from '../../../shared/pageInsights';
import type { AiConnectionsState } from '../../../shared/ipc';
import { Subsection, InkSwitch } from './kit';

export function PageInsightsSettings() {
  const [config, setConfig] = useState<InsightsConfig>(DEFAULT_INSIGHTS);
  const [connections, setConnections] = useState<AiConnectionsState | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true, received = false;
    const off = window.oblako.onPageInsightsConfig(value => { received = true; setConfig(value); });
    void window.oblako.pageInsightsConfig().then(value => { if (alive && !received) setConfig(value); });
    void window.oblako.aiConnections().then(value => { if (alive) setConnections(value); });
    const offConnections = window.oblako.onAiConnectionsChanged(setConnections);
    return () => { alive = false; off(); offConnections(); };
  }, []);
  const save = (patch: Partial<InsightsConfig>) => {
    setError(''); void window.oblako.setPageInsightsConfig(patch).then(setConfig).catch(() => setError('Не удалось сохранить настройку'));
  };
  const field = { padding: '8px 12px', border: '1px solid var(--divider)', borderRadius: 'var(--radius-sm)',
    background: 'transparent', color: 'var(--text-body)', fontSize: 'var(--fs-sm)' };
  return <Subsection title="Подсказки по странице">
    <div style={{ display: 'grid', gap: 16, fontSize: 'var(--fs-sm)', color: 'var(--text-body)' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <InkSwitch on={config.enabled} onChange={() => save({ enabled: !config.enabled })} /> Автоматически выделять главное в AI-панели
      </label>
      <span style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-xs)', lineHeight: 1.5 }}>
        До пяти карточек с источниками. Только для открытой панели и текущей страницы.
        Встроенная модель в фоне не загружается, готовый разбор используется повторно.
        Для локального API разбор запускается вручную: браузер не знает, загружена ли там модель.
      </span>
      <label style={{ display: 'grid', gap: 8 }}>Модель для карточек
        <select aria-label="Модель для карточек" style={field} value={config.connectionId ?? ''}
          onChange={e => save({ connectionId: e.target.value || null, allowRemote: false })}>
          <option value="">Встроенная локальная модель</option>
          {connections?.connections.map(connection => <option key={connection.id} value={connection.id}
            disabled={!connections.ready.includes(connection.id)}>{connection.label}{!connections.ready.includes(connection.id) ? ' — не подключено' : ''}</option>)}
          {config.connectionId && !connections?.connections.some(c => c.id === config.connectionId) &&
            <option value={config.connectionId}>Подключение недоступно</option>}
        </select>
      </label>
      {config.connectionId && <>
        <label style={{ display: 'flex', alignItems: 'start', gap: 8 }}>
          <InkSwitch on={config.allowRemote} onChange={() => save({ allowRemote: !config.allowRemote })} />
          <span>Разрешить фоновые запросы выбранному подключению
            <small style={{ display: 'block', color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
              Отправляются отобранные фрагменты страницы. Облачный провайдер может списывать плату по вашему API.
            </small>
          </span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          Предел облачных разборов в день
          <input aria-label="Предел облачных разборов в день" type="number" min={1} max={100} value={config.dailyLimit}
            style={{ ...field, width: 88 }} onChange={e => save({ dailyLimit: Number(e.target.value) })} />
        </label>
      </>}
      {error && <span role="alert">{error}</span>}
    </div>
  </Subsection>;
}
