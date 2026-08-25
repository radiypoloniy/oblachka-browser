import { useEffect, useState } from 'react';
import { DEFAULT_PROFILE_ID } from '../../../shared/profiles';
import type { ProfilesState } from '../../../shared/profiles';

/** Что тулбару нужно знать о профиле — только для точки у щита, не весь профиль целиком. */
export interface ProfileBadge {
  name: string;
  color: string;
  isDefault: boolean;
  /** Профиль ходит в сеть ТОЛЬКО через туннель (vpn: 'on') — щит обязан показать разлад. */
  strict: boolean;
}

/**
 * Активный профиль для щита в адресной строке.
 *
 * ⚠️ Живёт здесь, а не в App: точка рисуется в тулбаре, и прокидывать ради неё ещё один проп
 * через десяток уровней незачем.
 */
export function useProfileBadge(): ProfileBadge | null {
  const [profile, setProfile] = useState<ProfileBadge | null>(null);

  useEffect(() => {
    const read = (p: ProfilesState): void => {
      const cur = p.profiles.find((x) => x.id === p.activeId);
      setProfile(cur ? {
        name: cur.name,
        color: cur.color,
        isDefault: cur.id === DEFAULT_PROFILE_ID,
        strict: cur.settings.vpn === 'on',
      } : null);
    };
    void window.oblako.getProfiles().then(read);
    return window.oblako.onProfilesChanged(read);
  }, []);

  return profile;
}

/** Подсказка щита: сначала то, что сломано, потом обычное состояние. */
export function profileHint(profile: ProfileBadge | null, vpnOn: boolean): string {
  if (profile && !profile.isDefault && profile.strict && !vpnOn) {
    return `Профиль «${profile.name}» открывает сайты только через VPN, а туннель выключен`;
  }
  const base = vpnOn ? 'Защита: VPN включён' : 'Защита: VPN, блокировка рекламы, сведения о сайте';
  return profile && !profile.isDefault ? `${base} · профиль «${profile.name}»` : base;
}
