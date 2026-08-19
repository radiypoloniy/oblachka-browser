import { useState } from 'react';
import { KeyRound, ChevronRight, Sparkles } from 'lucide-react';
import type { PasswordIndicatorState } from '../../shared/ipc';
import {
  PopoverCard, PopoverIcon, PopoverTitle, PopoverHint, PopoverRow,
  PopoverActions, PrimaryButton, QuietButton, SiteIcon, hostLabel,
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
          <PopoverHint>{hostLabel(state.origin)} — вход будет подставляться сам при следующем визите.</PopoverHint>
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
          <PopoverHint>Для {hostLabel(state.origin)} сохранён другой пароль.</PopoverHint>
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
          {/* ⚠️ Знак и подпись сайта тут не украшение: карточка всплывает над полем на ЧУЖОЙ
              странице, и человек обязан видеть, чьё это предложение и для какого сайта — иначе
              она неотличима от подсказки самого сайта. */}
          <PopoverIcon><KeyRound size={18} /></PopoverIcon>
          <PopoverTitle>Войти как</PopoverTitle>
          <PopoverHint>{hostLabel(state.origin)}</PopoverHint>
          {state.matches.map((m, i) => (
            <PopoverRow
              key={m.id}
              index={i}
              icon={<SiteIcon host={state.origin} />}
              title={m.username || 'Без логина'}
              // ⚠️ Маска фиксированной длины, а не настоящая длина пароля: длина — это подсказка
              // тому, кто заглянул через плечо, и ради неё расширять контракт незачем.
              hint="••••••••••" 
              trailing={<ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />}
              onClick={() => void fill(m.id)}
              disabled={busy}
            />
          ))}
          {/* Смена пароля начинается ровно здесь: сохранённый вход для сайта есть, а нужен новый
              пароль — раньше за ним приходилось идти в настройки. */}
          <PopoverActions>
            <QuietButton onClick={() => void act(() => api.generatePendingPassword())} disabled={busy}>
              Придумать новый
            </QuietButton>
          </PopoverActions>
        </>
      )}

      {state.kind === 'offer-generate' && (
        <>
          {/* Свой знак, а не общий ключ: это единственная карточка, где браузер что-то СОЗДАЁТ,
              и по значку она должна отличаться от «войти» и «сохранить» с одного взгляда. */}
          <PopoverIcon><Sparkles size={18} /></PopoverIcon>
          <PopoverTitle>Придумать пароль?</PopoverTitle>
          <PopoverHint>
            Для {hostLabel(state.origin)} сохранённого входа нет — сгенерируем надёжный и сразу
            сохраним, чтобы он не потерялся.
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
