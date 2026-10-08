import { useEffect, useState } from 'react';
import { KeyRound, ChevronRight, Sparkles } from 'lucide-react';
import type { PasswordIndicatorState } from '../../shared/ipc';
import {
  PopoverCard, PopoverHeader, PopoverField, PopoverHint, PopoverRow,
  PopoverActions, PrimaryButton, QuietButton, SiteIcon, hostLabel,
} from './popoverKit';

// Менеджер паролей, шаг 2 — карточка поповера. Рисуется в отдельной WebContentsView поверх
// страницы (см. PasswordPopoverManager.ts), по тому же слою, что FindBar/SuggestDropdown.
interface PasswordActions {
  savePendingPassword(username?: string): Promise<boolean>;
  updatePendingPassword(username?: string): Promise<boolean>;
  fillSavedPassword(id: number): Promise<boolean>;
  dismissPendingPassword(permanent?: boolean): Promise<void>;
  generatePendingPassword(): Promise<boolean>;
}

interface Props {
  state: PasswordIndicatorState;
  onClose: () => void;
  actions?: PasswordActions;
}

export default function PasswordIndicatorPopover({ state, onClose, actions }: Props) {
  const [busy, setBusy] = useState(false);
  const [username, setUsername] = useState('username' in state ? state.username : '');
  const api = actions ?? window.oblako;

  useEffect(() => {
    setUsername('username' in state ? state.username : '');
  }, [state]);

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

  // ⚠️ Вопрос «сохранить/обновить» — одна и та же карточка с разной кнопкой. Раньше это были два
  // почти одинаковых блока по сорок строк, и правка в одном (поле логина) в другой не доезжала.
  const offer = state.kind === 'offer-save' || state.kind === 'offer-update' ? state.kind : null;
  const commit = () => void act(() => (offer === 'offer-update'
    ? api.updatePendingPassword(username)
    : api.savePendingPassword(username)));

  return (
    <PopoverCard>
      {offer && (
        <>
          {/* ⚠️ Три кнопки «Сохранить / Не сейчас / Никогда» в 280 px не помещались (по-русски
              ряд шире карточки на 15 px и обрезался краем вью). «Не сейчас» теперь — крестик в
              шапке: карточка закрывается, а вопрос остаётся под ключом в тулбаре, как у Chrome.
              Отказ навсегда — отдельной тихой кнопкой, рядом с основной. */}
          <PopoverHeader
            icon={<KeyRound size={18} />}
            title={offer === 'offer-update' ? 'Обновить пароль?' : 'Сохранить пароль?'}
            subtitle={hostLabel(state.origin)}
            onClose={onClose}
          />
          {offer === 'offer-update' && (
            <PopoverHint>Сохранённый пароль для этого логина заменится новым.</PopoverHint>
          )}
          <PopoverField
            label="Логин"
            placeholder="Логин или e-mail"
            value={username}
            onChange={setUsername}
            onEnter={busy ? undefined : commit}
            leading={<SiteIcon host={state.origin} />}
            disabled={busy}
          />
          <PopoverActions>
            <PrimaryButton onClick={commit} disabled={busy}>
              {offer === 'offer-update' ? 'Заменить' : 'Сохранить'}
            </PrimaryButton>
            <QuietButton
              onClick={() => void act(async () => { await api.dismissPendingPassword(true); return true; })}
              disabled={busy}
            >Никогда</QuietButton>
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
          <PopoverHeader
            icon={<KeyRound size={18} />}
            title="Войти как"
            subtitle={hostLabel(state.origin)}
            onClose={onClose}
          />
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {state.matches.map((m, i) => (
              <PopoverRow
                key={m.id}
                index={i}
                icon={<SiteIcon host={state.origin} />}
                title={m.username || 'Без логина'}
                // ⚠️ Маска фиксированной длины, а не настоящая длина пароля: длина — это подсказка
                // тому, кто заглянул через плечо, и ради неё расширять контракт незачем.
                hint={`${m.path ? `${m.path}  ·  ` : ''}••••••••••`}
                trailing={<ChevronRight size={14} style={{ color: 'var(--text-muted)' }} />}
                onClick={() => void fill(m.id)}
                disabled={busy}
              />
            ))}
          </div>
          {/* Смена пароля начинается ровно здесь: сохранённый вход для сайта есть, а нужен новый
              пароль — раньше за ним приходилось идти в настройки. */}
          {state.allowGenerate && (
            <PopoverActions>
              <QuietButton onClick={() => void act(() => api.generatePendingPassword())} disabled={busy}>
                Придумать новый
              </QuietButton>
            </PopoverActions>
          )}
        </>
      )}

      {state.kind === 'offer-generate' && (
        <>
          {/* Свой знак, а не общий ключ: это единственная карточка, где браузер что-то СОЗДАЁТ,
              и по значку она должна отличаться от «войти» и «сохранить» с одного взгляда. */}
          <PopoverHeader
            icon={<Sparkles size={18} />}
            title="Придумать пароль?"
            subtitle={hostLabel(state.origin)}
            onClose={onClose}
          />
          <PopoverHint>Сгенерируем надёжный пароль и сразу сохраним, чтобы он не потерялся.</PopoverHint>
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
