import { useEffect, useRef, useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import {
  DEFAULT_PROFILE_ID, PROFILE_COLORS, PROFILES_MAX,
  type Profile, type ProfileVpn, type ProfilesState,
} from '../../shared/profiles';
import { RADIUS, TEXT, motion, pad, sp } from '../styles/system';

// Переключатель профиля в тулбаре: метка активного + список.
//
// ⚠️ Профиль — единица УДОБСТВА, и подача обязана это отражать. Никаких щитов и замков:
// цветная метка с буквой, как аватар аккаунта. Человек заводит второй профиль ради второго
// аккаунта, а не ради анонимности; настройки приватности лежат внутри как обычные тумблеры.
//
// ⚠️ Переключение меняет только то, куда пойдут НОВЫЕ вкладки. Уже открытые остаются в своих
// сессиях — переставить партицию у живой вьюхи нельзя, да и не нужно: иначе человек, открывший
// почту в «работе», при переключении увидел бы там чужой аккаунт.

const DOT = 22;

const VPN_LABEL: Record<ProfileVpn, string> = {
  inherit: 'Как в приложении',
  on: 'Только через VPN',
  off: 'Без VPN',
};

const VPN_HINT: Record<ProfileVpn, string> = {
  inherit: 'Следует общему переключателю',
  on: 'Туннель упал — профиль ждёт, а не выходит напрямую',
  off: 'Прямой выход, даже когда VPN включён',
};

/** Цвет метки — токен плитки, не сырой цвет (цветовой закон: см. tokens/colors.css). */
function dotColor(color: string): string {
  return `var(--tile-${color})`;
}

function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}

export default function ProfileSwitcher() {
  const [state, setState] = useState<ProfilesState | null>(null);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void window.oblako.getProfiles().then(setState);
    return window.oblako.onProfilesChanged(setState);
  }, []);

  // Клик мимо закрывает — обычная механика меню. Esc тоже: у слоя должен быть выход с клавиатуры.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!boxRef.current?.contains(e.target as Node)) { setOpen(false); setAdding(false); }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { setOpen(false); setAdding(false); }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!state) return null;
  const active = state.profiles.find((p) => p.id === state.activeId) ?? state.profiles[0]!;
  // ⚠️ Один профиль — кнопки нет вовсе. Пока человек не завёл второй, это просто шум в тулбаре:
  // переключать не на что, а «Основной» ничего ему не сообщает.
  if (state.profiles.length < 2 && !open) {
    return (
      <button
        className="chrome-btn"
        title="Профили — свои логины и настройки сети"
        onClick={() => setOpen(true)}
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <Dot profile={active} />
      </button>
    );
  }

  return (
    <div ref={boxRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        className="chrome-btn"
        title={`Профиль: ${active.name}`}
        onClick={() => setOpen((v) => !v)}
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <Dot profile={active} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: sp(2), zIndex: 60,
          width: 268, padding: pad(2), display: 'flex', flexDirection: 'column', gap: sp(1),
          background: 'var(--surface-solid)', borderRadius: RADIUS.box,
          border: '1px solid var(--divider)', boxShadow: 'var(--shadow-island)',
        }}>
          {state.profiles.map((p) => (
            <ProfileRow
              key={p.id}
              profile={p}
              active={p.id === state.activeId}
              onPick={() => { void window.oblako.switchProfile(p.id); setOpen(false); }}
              onVpn={(vpn) => { void window.oblako.setProfileSettings(p.id, { vpn }); }}
              onRemove={p.id === DEFAULT_PROFILE_ID ? undefined : () => {
                void window.oblako.removeProfile(p.id);
              }}
            />
          ))}

          {adding ? (
            <div style={{ display: 'flex', gap: sp(1), padding: pad(1) }}>
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  const name = draft.trim();
                  if (!name) return;
                  // Цвет — следующий свободный по кругу: выбирать его при заведении незачем,
                  // а одинаковые метки не различить.
                  const color = PROFILE_COLORS[state.profiles.length % PROFILE_COLORS.length]!;
                  void window.oblako.createProfile(name, color);
                  setDraft('');
                  setAdding(false);
                }}
                placeholder="Работа, личное, второй аккаунт…"
                style={{
                  ...TEXT.body, flex: 1, minWidth: 0, padding: pad(1, 2),
                  borderRadius: RADIUS.control, border: '1px solid var(--divider-strong)',
                  background: 'var(--surface)', color: 'var(--text-strong)',
                  fontFamily: 'inherit', outline: 'none',
                }}
              />
            </div>
          ) : state.profiles.length < PROFILES_MAX && (
            <button
              onClick={() => { setAdding(true); setDraft(''); }}
              style={{
                ...TEXT.body, display: 'flex', alignItems: 'center', gap: sp(2),
                padding: pad(2), border: 'none', cursor: 'default', borderRadius: RADIUS.control,
                background: 'transparent', color: 'var(--text-muted)', textAlign: 'left',
                transition: motion.hover('background', 'color'),
              }}
            ><Plus size={14} /> Новый профиль</button>
          )}

          <div style={{ ...TEXT.caption, padding: `${sp(1)}px ${sp(2)}px 0` }}>
            У каждого профиля свои логины и настройки сети. История и закладки пока общие.
          </div>
        </div>
      )}
    </div>
  );
}

function Dot({ profile }: { profile: Profile }) {
  return (
    <span style={{
      width: DOT, height: DOT, borderRadius: RADIUS.pill, flex: 'none',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      // ⚠️ Роль подписи целиком, а не свой кегль: буква в метке — тот же класс текста, что
      // подпись под плиткой. Спред идёт ПЕРВЫМ — он несёт свой цвет и затёр бы белый.
      ...TEXT.caption, background: dotColor(profile.color), color: '#fff',
      fontWeight: 700, letterSpacing: 0,
    }}>{initial(profile.name)}</span>
  );
}

function ProfileRow({ profile, active, onPick, onVpn, onRemove }: {
  profile: Profile;
  active: boolean;
  onPick: () => void;
  onVpn: (v: ProfileVpn) => void;
  onRemove?: () => void;
}) {
  const [openVpn, setOpenVpn] = useState(false);
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: sp(1), padding: pad(2),
      borderRadius: RADIUS.control,
      background: active ? 'var(--accent-soft)' : 'transparent',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: sp(2) }}>
        <button
          onClick={onPick}
          style={{
            display: 'flex', alignItems: 'center', gap: sp(2), flex: 1, minWidth: 0,
            border: 'none', background: 'transparent', cursor: 'default', padding: 0,
            color: 'inherit', textAlign: 'left', font: 'inherit',
          }}
        >
          <Dot profile={profile} />
          <span style={{
            ...TEXT.body, flex: 1, minWidth: 0, color: 'var(--text-strong)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{profile.name}</span>
          {active && <Check size={14} style={{ color: 'var(--accent)', flex: 'none' }} />}
        </button>
        {onRemove && (
          <button
            onClick={onRemove}
            title="Удалить профиль вместе с его логинами"
            style={{
              border: 'none', background: 'transparent', cursor: 'default', padding: 0,
              color: 'var(--text-faint)', display: 'inline-flex', flex: 'none',
            }}
          ><Trash2 size={13} /></button>
        )}
      </div>

      {/* Сетевая настройка профиля — обычная строка, а не «режим защиты». */}
      <button
        onClick={() => setOpenVpn((v) => !v)}
        title={VPN_HINT[profile.settings.vpn]}
        style={{
          ...TEXT.caption, alignSelf: 'flex-start', marginLeft: DOT + sp(2),
          border: 'none', background: 'transparent', cursor: 'default', padding: 0,
          color: profile.settings.vpn === 'on' ? 'var(--accent)' : 'var(--text-faint)',
        }}
      >{VPN_LABEL[profile.settings.vpn]}</button>

      {openVpn && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(1), marginLeft: DOT + sp(2) }}>
          {(['inherit', 'on', 'off'] as ProfileVpn[]).map((v) => (
            <button
              key={v}
              onClick={() => { onVpn(v); setOpenVpn(false); }}
              title={VPN_HINT[v]}
              style={{
                ...TEXT.caption, padding: pad(1, 2), cursor: 'default', borderRadius: RADIUS.pill,
                border: '1px solid var(--divider-strong)',
                background: profile.settings.vpn === v ? 'var(--accent)' : 'transparent',
                color: profile.settings.vpn === v ? 'var(--on-accent)' : 'var(--text-body)',
                transition: motion.hover('background', 'color'),
              }}
            >{VPN_LABEL[v]}</button>
          ))}
        </div>
      )}
    </div>
  );
}
