import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import type { PasswordIndicatorState } from '../../shared/ipc';
import {
  PopoverCard, PopoverIcon, PopoverTitle, PopoverHint, PopoverRow,
  PopoverActions, PrimaryButton, QuietButton, SiteIcon,
} from './popoverKit';

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
    <PopoverCard>
      {state.kind === 'offer-save' && (
        <>
          <PopoverIcon><KeyRound size={18} /></PopoverIcon>
          <PopoverTitle>Сохранить пароль?</PopoverTitle>
          <PopoverHint>{state.origin} — вход будет подставляться сам при следующем визите.</PopoverHint>
          <PopoverRow icon={<SiteIcon host={state.origin} />} title={state.username || 'Без логина'} />
          <PopoverActions>
            <PrimaryButton onClick={() => void act(() => api.savePendingPassword())} disabled={busy}>
              Сохранить
            </PrimaryButton>
            <QuietButton
              onClick={() => void act(async () => { await api.dismissPendingPassword(); return true; })}
              disabled={busy}
            >Не сейчас</QuietButton>
          </PopoverActions>
        </>
      )}

      {state.kind === 'offer-update' && (
        <>
          <PopoverIcon><KeyRound size={18} /></PopoverIcon>
          <PopoverTitle>Обновить пароль?</PopoverTitle>
          <PopoverHint>Для {state.origin} сохранён другой пароль.</PopoverHint>
          <PopoverRow icon={<SiteIcon host={state.origin} />} title={state.username || 'Без логина'} />
          <PopoverActions>
            <PrimaryButton onClick={() => void act(() => api.updatePendingPassword())} disabled={busy}>
              Обновить
            </PrimaryButton>
            <QuietButton
              onClick={() => void act(async () => { await api.dismissPendingPassword(); return true; })}
              disabled={busy}
            >Не сейчас</QuietButton>
          </PopoverActions>
        </>
      )}

      {state.kind === 'has-saved' && (
        <>
          {/* ⚠️ Заголовок про результат, а не про механику: человек выбирает, КЕМ войти, а не
              «подставляет сохранённый вход». Строки — обычный список набора, с значком сайта и
              замаскированным паролем: две записи с похожими логинами иначе неразличимы. */}
          <PopoverTitle>Войти как</PopoverTitle>
          {state.matches.map((m) => (
            <PopoverRow
              key={m.id}
              icon={<SiteIcon host={state.origin} />}
              title={m.username || 'Без логина'}
              // ⚠️ Маска фиксированной длины, а не настоящая длина пароля: длина — это подсказка
              // тому, кто заглянул через плечо, и ради неё расширять контракт незачем.
              hint="••••••••••" 
              onClick={() => void fill(m.id)}
              disabled={busy}
            />
          ))}
        </>
      )}

      {state.kind === 'offer-generate' && (
        <>
          <PopoverIcon><KeyRound size={18} /></PopoverIcon>
          <PopoverTitle>Придумать пароль?</PopoverTitle>
          <PopoverHint>
            Для {state.origin} сохранённого входа нет, а поле похоже на регистрацию — сгенерируем
            надёжный и сразу сохраним.
          </PopoverHint>
          <PopoverActions>
            <PrimaryButton onClick={() => void act(() => api.generatePendingPassword())} disabled={busy}>
              Сгенерировать
            </PrimaryButton>
          </PopoverActions>
        </>
      )}
    </PopoverCard>
  );
}
