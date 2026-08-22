import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import {
  PROFILE_COLORS, PROFILES_MAX, shouldAskProfileOnStart,
  type Profile, type ProfilesState,
} from '../../shared/profiles';
import { RADIUS, TEXT, motion, pad, sp } from '../styles/system';
import { glassPlate } from '../styles/island';

// Выбор профиля при запуске.
//
// ⚠️ ПОПОВЕР В ОКНЕ, а не отдельное окно выбора. Второе окно — это вспышка на старте, своя
// иконка в панели задач, свой размер и своя тема; сущностей и так хватает. Здесь тот же слой,
// что у остальных карточек браузера, и та же дизайн-система.
//
// ⚠️ Появляется ТОЛЬКО когда спрашивать есть о чем (см. shouldAskProfileOnStart): профилей
// больше одного и человек не закрепил выбор. Один профиль — вопроса нет вовсе, иначе это
// издевательство: «с каким из одного?».

export default function ProfilePicker({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState<ProfilesState | null>(null);
  const [remember, setRemember] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.oblako.getProfiles().then((p) => {
      // Спрашивать не о чем — молча уходим, не мигнув карточкой.
      if (!shouldAskProfileOnStart(p)) { onDone(); return; }
      setState(p);
    });
  }, [onDone]);

  if (!state) return null;

  async function pick(id: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await window.oblako.switchProfile(id);
      // ⚠️ Закрепление — отдельным действием и ТОЛЬКО по галочке: молча запомнить выбор значило
      // бы, что вопрос больше не вернётся, а человек об этом не просил.
      if (remember) await window.oblako.setStartupProfile(id);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  async function create(): Promise<void> {
    const name = draft.trim();
    if (!name || busy || !state) return;
    setBusy(true);
    try {
      const color = PROFILE_COLORS[state.profiles.length % PROFILE_COLORS.length]!;
      const next = await window.oblako.createProfile(name, color);
      setState(next);
      setDraft('');
      setAdding(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 80,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(10,12,20,0.28)',
    }}>
      <div style={{
        ...glassPlate(),
        width: 420, maxWidth: '92%', padding: pad(6),
        display: 'flex', flexDirection: 'column', gap: sp(4),
        animation: 'oblako-drag-card-in var(--dur-base) var(--ease-out)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
          <span style={{ ...TEXT.title }}>С каким профилем начать?</span>
          {/* ⚠️ Объяснение обязательно и здесь. Человек видит этот экран РАНЬШЕ, чем что-либо
              успел прочитать про профили; без него вопрос выглядит как требование выбрать
              непонятно что. */}
          <span style={{ ...TEXT.caption }}>
            У профиля свои логины, вкладки и настройки сети. Рабочее не смешивается с личным,
            а на одном сайте можно держать два аккаунта.
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: sp(1) }}>
          {state.profiles.map((p) => (
            <button
              key={p.id}
              disabled={busy}
              onClick={() => { void pick(p.id); }}
              style={{
                display: 'flex', alignItems: 'center', gap: sp(3), width: '100%',
                padding: pad(3), borderRadius: RADIUS.control, cursor: 'default',
                border: '1px solid var(--divider)', background: 'var(--surface)',
                color: 'inherit', textAlign: 'left', font: 'inherit',
                transition: motion.hover('background', 'border-color'),
              }}
            >
              <Dot profile={p} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', ...TEXT.body, color: 'var(--text-strong)', fontWeight: 600 }}>
                  {p.name}
                </span>
                <span style={{ display: 'block', ...TEXT.caption }}>
                  {p.settings.vpn === 'on' ? 'Только через VPN'
                    : p.settings.vpn === 'off' ? 'Без VPN' : 'Как в приложении'}
                </span>
              </span>
            </button>
          ))}

          {adding ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void create();
                if (e.key === 'Escape') setAdding(false);
              }}
              placeholder="Название профиля"
              style={{
                ...TEXT.body, width: '100%', boxSizing: 'border-box', padding: pad(3),
                borderRadius: RADIUS.control, border: '1px solid var(--divider-strong)',
                background: 'var(--surface)', color: 'var(--text-strong)',
                fontFamily: 'inherit', outline: 'none',
              }}
            />
          ) : state.profiles.length < PROFILES_MAX && (
            <button
              onClick={() => { setAdding(true); setDraft(''); }}
              style={{
                ...TEXT.body, display: 'flex', alignItems: 'center', gap: sp(2),
                padding: pad(3), borderRadius: RADIUS.control, cursor: 'default',
                border: '1px dashed var(--divider-strong)', background: 'transparent',
                color: 'var(--text-muted)', textAlign: 'left',
                transition: motion.hover('background', 'color'),
              }}
            ><Plus size={14} /> Новый профиль</button>
          )}
        </div>

        {/* ⚠️ Галочка — про то, чтобы вопрос БОЛЬШЕ НЕ ПОЯВЛЯЛСЯ, и сказано это прямо.
            Отменяется в настройках, и про это тоже сказано здесь: иначе человек, поставивший
            её однажды, не поймёт, куда делся выбор. */}
        <label style={{ display: 'flex', alignItems: 'center', gap: sp(2), cursor: 'default' }}>
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            style={{ accentColor: 'var(--accent)' }}
          />
          <span style={{ ...TEXT.caption }}>
            Запускать с выбранным профилем и больше не спрашивать (можно вернуть в настройках)
          </span>
        </label>
      </div>
    </div>
  );
}

function Dot({ profile }: { profile: Profile }) {
  return (
    <span style={{
      width: 26, height: 26, flex: 'none', borderRadius: RADIUS.pill,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      ...TEXT.body, background: `var(--tile-${profile.color})`, color: 'var(--white)',
      fontWeight: 700,
    }}>{(profile.name.trim()[0] ?? '?').toUpperCase()}</span>
  );
}
