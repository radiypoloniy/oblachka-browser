import { useState } from 'react';
import type React from 'react';
import { Check } from 'lucide-react';
import type { PasswordIndicatorState } from '../../shared/ipc';
import { islandPlate } from '../styles/island';

// Менеджер паролей, шаг 2 — карточка поповера. Рисуется в отдельной WebContentsView поверх
// страницы (см. PasswordPopoverManager.ts), по тому же слою, что FindBar/SuggestDropdown.
interface PasswordActions {
  savePendingPassword(): Promise<boolean>;
  updatePendingPassword(): Promise<boolean>;
  fillSavedPassword(id: number): Promise<boolean>;
  dismissPendingPassword(): Promise<void>;
  generatePendingPassword(): Promise<boolean>;
}

interface Props {
  state: PasswordIndicatorState;
  onClose: () => void;
  actions?: PasswordActions;
}

export default function PasswordIndicatorPopover({ state, onClose, actions }: Props) {
  const [busy, setBusy] = useState(false);
  const api = actions ?? window.oblako;

  async function act(fn: () => Promise<boolean>) {
    setBusy(true);
    try {
      const ok = await fn();
      if (ok) onClose();
    } finally {
      setBusy(false);
    }
  }

  async function fill(id: number) {
    setBusy(true);
    try {
      const ok = await api.fillSavedPassword(id);
      if (ok) onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      width: 280,
      ...islandPlate,
      borderRadius: 'var(--radius-card)', padding: 16,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      {state.kind === 'offer-save' && (
        <>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-strong)' }}>
            Сохранить пароль для <b>{state.origin}</b>?
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
            {state.username}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => void act(() => api.savePendingPassword())} disabled={busy} style={btnPrimary}>
              Сохранить
            </button>
            <button
              onClick={() => void act(async () => { await api.dismissPendingPassword(); return true; })}
              disabled={busy}
              style={btnGhost}
            >Не сейчас</button>
          </div>
        </>
      )}

      {state.kind === 'offer-update' && (
        <>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-strong)' }}>
            Обновить пароль для <b>{state.origin}</b>?
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', fontFamily: 'var(--font-mono)' }}>
            {state.username}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => void act(() => api.updatePendingPassword())} disabled={busy} style={btnPrimary}>
              Обновить
            </button>
            <button
              onClick={() => void act(async () => { await api.dismissPendingPassword(); return true; })}
              disabled={busy}
              style={btnGhost}
            >Не сейчас</button>
          </div>
        </>
      )}

      {state.kind === 'has-saved' && (
        <>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-strong)' }}>
            Подставить сохранённый вход
          </div>
          {state.matches.map((m) => (
            <button
              key={m.id}
              disabled={busy}
              onClick={() => void fill(m.id)}
              style={{ ...btnGhost, textAlign: 'left', display: 'flex', gap: 8, alignItems: 'center' }}
            ><Check size={14} style={{ color: 'var(--text-muted)', flex: 'none' }} />
              {/* Логин пуст у записи, рождённой генератором пароля: он сохраняет пароль сразу, а
                  логин узнаёт при первом входе. До этого момента строка была ПУСТОЙ кнопкой —
                  человек не понимал, что выбирает. */}
              {m.username || <span style={{ color: 'var(--text-faint)' }}>без логина</span>}</button>
          ))}
        </>
      )}

      {state.kind === 'offer-generate' && (
        <>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-strong)' }}>
            Нет сохранённого входа для <b>{state.origin}</b>
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
            Похоже на регистрацию — сгенерировать надёжный пароль в это поле?
          </div>
          <button
            onClick={() => void act(() => api.generatePendingPassword())}
            disabled={busy}
            style={btnPrimary}
          >
            Сгенерировать пароль
          </button>
        </>
      )}
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 'var(--radius-sm)', border: 'none',
  background: 'var(--accent)', color: 'var(--on-accent)',
  fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'default', flex: 'none',
};
const btnGhost: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--divider-strong)', background: 'transparent',
  color: 'var(--text-body)', fontSize: 'var(--fs-sm)', cursor: 'default', flex: 'none',
};
