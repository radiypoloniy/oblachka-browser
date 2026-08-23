import { useEffect, useState } from 'react';
import { Plus, Check } from 'lucide-react';
import {
  PROFILE_COLORS, PROFILES_MAX, shouldAskProfileOnStart,
  type Profile, type ProfilesState,
} from '../../shared/profiles';
import { ALTITUDE, DISPLAY, RADIUS, TEXT, altitude, motion, pad, sp } from '../styles/system';
import ProfileAvatar from './ProfileAvatar';

// Выбор профиля при запуске.
//
// ⚠️ ПОПОВЕР В ОКНЕ, а не отдельное окно выбора. Второе окно — это вспышка на старте, своя
// иконка в панели задач, свой размер и своя тема; сущностей и так хватает.
//
// ⚠️ Карточка собрана из ГОТОВЫХ РЕЦЕПТОВ, а не нарисована с нуля: altitude() задаёт поверхность,
// скругление и тень, TEXT/DISPLAY — роли текста, sp/pad — шкалу. Первая версия рисовалась руками
// и это было видно сразу: прямые углы (glassPlate НАМЕРЕННО не задаёт радиус — его ставит
// вызывающий) и мелкий текст в тесной коробке.
//
// ⚠️ Дисплейная гарнитура здесь УМЕСТНА и это единственное её место в диалогах: правило
// «в интерфейс не заходит никогда» сделано для плотного набора в мелком кегле, а этот экран —
// «лицо» продукта наравне со столом и онбордингом, и человек видит его до всего остального.
//
// ⚠️ Появляется ТОЛЬКО когда спрашивать есть о чём (см. shouldAskProfileOnStart): профилей
// больше одного и человек не закрепил выбор.

/** Кружок метки. Крупный: на этом экране он «аватар», а не значок в строке. */
const DOT = 40;

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

  // ⚠️ Пока карточка висит, содержимое обязано быть спрятано. WebContentsView страницы лежит
  // ПОВЕРХ React-рамки, и без этого при восстановленной сессии человек видит затемнение по
  // краям, но не саму карточку: браузер выглядит зависшим и требующим выбора, которого не
  // показывает (живой случай 23.08). Снимаем в уборке — в том числе если компонент ушёл
  // раньше, чем человек выбрал.
  useEffect(() => {
    if (!state) return;
    void window.oblako.setChromeModal(true);
    return () => { void window.oblako.setChromeModal(false); };
  }, [state]);

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
      setState(await window.oblako.createProfile(name, color));
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
      padding: sp(8),
      background: 'rgba(10,12,20,0.32)',
      backdropFilter: 'blur(2px)',
    }}>
      <div style={{
        // Готовый рецепт «острова» — поверхность, скругление содержимого (24), тень, кромка.
        ...altitude(ALTITUDE.island, { content: true }),
        width: 560, maxWidth: '100%', maxHeight: '100%', overflowY: 'auto',
        padding: `${sp(8)}px ${sp(8)}px ${sp(6)}px`,
        display: 'flex', flexDirection: 'column', gap: sp(6),
        animation: 'oblako-drag-card-in var(--dur-base) var(--ease-out)',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: sp(3) }}>
          <span style={{ ...DISPLAY, fontSize: 34, color: 'var(--text-strong)' }}>
            С чего начнём?
          </span>
          {/* ⚠️ Объяснение обязательно: человек видит этот экран РАНЬШЕ, чем успел прочитать
              что-либо про профили, и без него вопрос выглядит требованием выбрать непонятно что. */}
          <span style={{ ...TEXT.body, color: 'var(--text-muted)', maxWidth: '46ch' }}>
            У профиля свои логины, вкладки и настройки сети. Рабочее не смешивается
            с личным, а на одном сайте можно держать два аккаунта.
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
          {state.profiles.map((p) => (
            <ProfileButton key={p.id} profile={p} disabled={busy} onPick={() => { void pick(p.id); }} />
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
                ...TEXT.section, fontWeight: 400, width: '100%', boxSizing: 'border-box',
                padding: pad(4), borderRadius: RADIUS.box,
                border: '1px solid var(--accent)', background: 'var(--surface)',
                color: 'var(--text-strong)', fontFamily: 'inherit', outline: 'none',
              }}
            />
          ) : state.profiles.length < PROFILES_MAX && (
            <button
              onClick={() => { setAdding(true); setDraft(''); }}
              style={{
                ...TEXT.section, fontWeight: 400,
                display: 'flex', alignItems: 'center', gap: sp(3),
                padding: `${sp(4)}px ${sp(4)}px`, borderRadius: RADIUS.box, cursor: 'default',
                border: '1px dashed var(--divider-strong)', background: 'transparent',
                color: 'var(--text-muted)', textAlign: 'left',
                transition: motion.hover('background', 'color', 'border-color'),
              }}
            >
              <span style={{
                width: DOT, height: DOT, flex: 'none', borderRadius: RADIUS.pill,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                border: '1px dashed var(--divider-strong)',
              }}><Plus size={18} /></span>
              Новый профиль
            </button>
          )}
        </div>

        {/* ⚠️ Галочка — про то, чтобы вопрос БОЛЬШЕ НЕ ПОЯВЛЯЛСЯ, и сказано это прямо. Отмена
            в настройках названа здесь же: иначе человек, поставивший её однажды, не поймёт,
            куда делся выбор. */}
        <label style={{
          display: 'flex', alignItems: 'center', gap: sp(3), cursor: 'default',
          paddingTop: sp(2), borderTop: '1px solid var(--divider)',
        }}>
          <span
            onClick={() => setRemember((v) => !v)}
            style={{
              width: 22, height: 22, flex: 'none', borderRadius: RADIUS.tight,
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              background: remember ? 'var(--accent)' : 'transparent',
              border: remember ? 'none' : '1.5px solid var(--divider-strong)',
              color: 'var(--on-accent)', transition: motion.hover('background', 'border-color'),
            }}
          >{remember && <Check size={14} strokeWidth={3} />}</span>
          <span style={{ ...TEXT.caption }}>
            Запускать с выбранным профилем и больше не спрашивать — можно вернуть в настройках
          </span>
        </label>
      </div>
    </div>
  );
}

function ProfileButton({ profile, disabled, onPick }: {
  profile: Profile; disabled: boolean; onPick: () => void;
}) {
  const vpn = profile.settings.vpn === 'on' ? 'Только через VPN'
    : profile.settings.vpn === 'off' ? 'Без VPN' : 'Как в приложении';
  return (
    <button
      disabled={disabled}
      onClick={onPick}
      style={{
        display: 'flex', alignItems: 'center', gap: sp(4), width: '100%',
        padding: pad(4), borderRadius: RADIUS.box, cursor: 'default',
        border: '1px solid var(--divider)', background: 'var(--surface-sunken)',
        color: 'inherit', textAlign: 'left', font: 'inherit',
        transition: motion.hover('background', 'border-color'),
      }}
    >
      {/* ⚠️ Тот же компонент, что в настройках: аватарка, выбранная человеком там, обязана
          встретить его здесь — иначе выбор облика выглядит как настройка ни на что не влияющая. */}
      <ProfileAvatar profile={profile} size={DOT} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', ...TEXT.section, color: 'var(--text-strong)' }}>
          {profile.name}
        </span>
        <span style={{ display: 'block', ...TEXT.caption, marginTop: sp(1) }}>{vpn}</span>
      </span>
    </button>
  );
}
