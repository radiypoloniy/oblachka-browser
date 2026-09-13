import { useState } from 'react';
import { Download, RefreshCw, RotateCcw } from 'lucide-react';
import type { UpdateStatus } from '../../shared/ipc';
import { updateOfferPhase } from '../../shared/updateOffer';
import { PopoverCard, PopoverActions, PrimaryButton, QuietButton } from './popoverKit';
import { sp, RADIUS, TEXT, DISPLAY } from '../styles/system';

// Карточка «доступна новая версия». Живёт в собственной WebContentsView поверх страницы
// (см. electron/UpdatePromptManager.ts) — тот же рецепт, что запрос разрешения сайта.

type Action = 'update' | 'later' | 'skip';

interface Props {
  status: UpdateStatus;
  onRespond: (action: Action) => void;
}

export default function UpdatePrompt({ status, onRespond }: Props) {
  const [skip, setSkip] = useState(false);
  const phase = updateOfferPhase(status.kind);
  const version = status.newVersion ?? '';

  let title: string;
  let hint: string;
  let Icon = Download;
  if (phase === 'progress') {
    title = `Скачиваем версию ${version}…`;
    hint = `${status.percent}%`;
    Icon = Download;
  } else if (phase === 'restart') {
    title = `Перезапустить и поставить ${version}?`;
    hint = 'Браузер закроется ненадолго и откроется сам. Вкладки на месте.';
    Icon = RotateCcw;
  } else {
    title = `Поставить версию ${version}?`;
    hint = `Сейчас стоит ${status.currentVersion}. Скачается в фоне, вкладки сохранятся.`;
    Icon = RefreshCw;
  }

  return (
    <div className="oblako-ask-in">
      <PopoverCard width={380} invert tail>
        <div style={{ display: 'flex', gap: sp(4), alignItems: 'flex-start' }}>
          <span style={{
            width: 46, height: 46, borderRadius: RADIUS.box, flex: 'none',
            display: 'grid', placeItems: 'center',
            background: 'var(--overlay-invert-quiet)', color: 'var(--overlay-invert-ink)',
          }}>
            <Icon size={23} style={{ flexShrink: 0 }} />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              ...TEXT.caption, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
              color: 'var(--overlay-invert-body)', marginBottom: sp(1),
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>Oblako</div>
            <div style={{
              ...DISPLAY, fontSize: 20, fontWeight: 700, letterSpacing: '-0.03em',
              lineHeight: 1.14, color: 'var(--overlay-invert-ink)', marginBottom: sp(2),
            }}>{title}</div>
            <div style={{ ...TEXT.body, color: 'var(--overlay-invert-body)' }}>{hint}</div>
          </div>
        </div>

        {phase === 'progress' && (
          <div style={{
            height: 4, borderRadius: RADIUS.tight,
            background: 'var(--overlay-invert-quiet)', overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', width: `${status.percent}%`,
              background: 'var(--accent)', transition: 'width .2s',
            }} />
          </div>
        )}

        {phase === 'ask' && (
          <label style={{
            display: 'flex', alignItems: 'center', gap: sp(2),
            ...TEXT.caption, color: 'var(--overlay-invert-body)',
            cursor: 'default', userSelect: 'none',
          }}>
            <input
              type="checkbox"
              checked={skip}
              onChange={(e) => setSkip(e.target.checked)}
              style={{ cursor: 'default', accentColor: 'var(--accent)' }}
            />
            Не спрашивать об этой версии
          </label>
        )}

        {phase !== 'progress' && (
          <PopoverActions>
            <PrimaryButton stretch big onClick={() => onRespond('update')}>
              {phase === 'restart' ? 'Перезапустить' : 'Обновить'}
            </PrimaryButton>
            <QuietButton stretch big invert onClick={() => onRespond(skip ? 'skip' : 'later')}>
              {phase === 'restart' ? 'Позже' : 'Не сейчас'}
            </QuietButton>
          </PopoverActions>
        )}
      </PopoverCard>
    </div>
  );
}
