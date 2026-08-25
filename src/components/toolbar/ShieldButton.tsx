import type React from 'react';
import type { RefObject } from 'react';
import { ShieldGlyph } from '../glyphs';
import { profileHint } from './useProfileBadge';
import type { ProfileBadge } from './useProfileBadge';

/**
 * Щит слева в адресной строке — вход в карточку сайта (соединение, разрешения, вырезанные
 * трекеры, VPN; см. SitePopoverManager.ts).
 *
 * ⚠️ Щит, а не замок, и это не косметика. Кнопка отвечает на вопрос «что защищает меня прямо
 * сейчас» — соединение, трекеры, туннель, — а замок обещает только первое.
 *
 * ⚠️ Кнопка живая ВСЕГДА, включая хаб и приватную вкладку. Раньше там стояла некликабельная
 * картинка, и до VPN нельзя было добраться с новой вкладки — а включают его чаще всего именно
 * оттуда.
 *
 * ⚠️ Зелёная ЗАЛИВКА щита = туннель поднят: функциональный зелёный по цветовому закону
 * (--dot-vpn). Открытый поповер перебивает акцентом — это состояние интерфейса, а не защиты.
 */
export function ShieldButton({ btnRef, vpnOn, popoverOpen, profile, onToggle }: {
  btnRef: RefObject<HTMLButtonElement>;
  vpnOn: boolean;
  popoverOpen: boolean;
  /** Активный профиль — ради точки в углу щита. */
  profile: ProfileBadge | null;
  onToggle: () => void;
}): React.ReactElement {
  return (
    <button
      ref={btnRef}
      title={profileHint(profile, vpnOn)}
      onClick={onToggle}
      style={{
        border: 'none', background: popoverOpen ? 'var(--accent-soft)' : 'transparent',
        cursor: 'default', padding: 3, borderRadius: 'var(--radius-sm)',
        display: 'inline-flex', flex: 'none', position: 'relative',
        color: popoverOpen ? 'var(--accent)' : vpnOn ? 'var(--dot-vpn)' : 'var(--text-faint)',
      }}
    >
      <ShieldGlyph size={14} filled={vpnOn && !popoverOpen} />

      {/* ⚠️ Точка профиля — вместо полосы во всю ширину окна, которая была уродлива и занимала
          строку ради одного факта. Индикация нужна, но её место здесь: у щита, где и так собрано
          «что защищает меня прямо сейчас». Показывается только когда профиль НЕ основной — иначе
          это вечная метка ни о чём.
          ⚠️ Профиль ждёт VPN, а туннеля нет — точка становится предупреждающей: цвет несёт
          статус (по цветовому закону), а не украшение. */}
      {profile && !profile.isDefault && (
        <span
          style={{
            position: 'absolute', right: 0, bottom: 0,
            width: 7, height: 7, borderRadius: 'var(--radius-pill)',
            background: profile.strict && !vpnOn ? 'var(--warning-500)' : `var(--tile-${profile.color})`,
            boxShadow: '0 0 0 1.5px var(--surface)',
          }}
        />
      )}
    </button>
  );
}
