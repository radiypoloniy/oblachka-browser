import type React from 'react';
import { Ban } from 'lucide-react';
import { islandPlate } from '../styles/island';
import Toggle from './Toggle';

// Адблок-секция объединённого поповера «Защита» (см. vpnpopover.tsx) — второй блок под
// VpnIndicatorPopover в той же WebContentsView-карточке. Глобальный тумблер дублирует Settings →
// Блокировка (тот же AdBlockState.enabled); секция «на этом сайте» — новая, раньше нигде в UI
// не было точки, чтобы посмотреть per-site счётчик или быстро выключить блокировку для одного
// домена без похода в Settings → Исключения.
interface Props {
  enabled: boolean;
  // null — на текущей вкладке нет обычной http(s)-страницы (хаб/настройки/oblako-chrome://) —
  // секция «на этом сайте» в этом случае скрыта целиком, показывать нечего.
  domain: string | null;
  whitelisted: boolean;
  blockedCount: number;
  onToggleEnabled: () => void;
  onToggleSite: () => void;
}

export default function AdBlockSitePanel({
  enabled, domain, whitelisted, blockedCount, onToggleEnabled, onToggleSite,
}: Props) {
  return (
    <div style={{
      width: 300,
      ...islandPlate,
      borderRadius: 'var(--radius-card)', padding: 16,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Ban size={16} style={{ color: enabled ? 'var(--text-body)' : 'var(--text-faint)' }} />
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-strong)', fontWeight: 600, flex: 1 }}>
          {enabled ? 'Блокировка рекламы включена' : 'Блокировка рекламы выключена'}
        </div>
        <Toggle checked={enabled} onChange={onToggleEnabled} />
      </div>

      {domain && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          paddingTop: 10, borderTop: '1px solid var(--divider)',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 'var(--fs-xs)', color: 'var(--text-body)', fontWeight: 600,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {domain}
            </div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2 }}>
              {!enabled ? 'Блокировка выключена глобально'
                : whitelisted ? 'В исключениях — не блокируется'
                : `Заблокировано на сайте: ${blockedCount.toLocaleString('ru')}`}
            </div>
          </div>
          <button
            onClick={onToggleSite}
            disabled={!enabled}
            style={btnSecondary}
            onMouseEnter={(e) => { if (enabled) e.currentTarget.style.background = 'var(--surface-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            {whitelisted ? 'Включить здесь' : 'Выключить здесь'}
          </button>
        </div>
      )}
    </div>
  );
}

// Secondary (не Ghost, в отличие от VpnIndicatorPopover.tsx::btnGhost) — рамка var(--divider-strong)
// остаётся постоянно во всех состояниях, hover добавляет только заливку var(--surface-hover)
// (тот же паттерн, что и в остальном проекте, см. VpnIndicatorPopover.tsx). Раньше hover-а не
// было вообще — фон всегда transparent, кнопка выглядела «мёртвой» (кликабельна, но без обратной связи).
const btnSecondary: React.CSSProperties = {
  padding: '7px 12px', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--divider-strong)', background: 'transparent',
  color: 'var(--text-body)', fontSize: 'var(--fs-xs)', cursor: 'default', flex: 'none',
};
