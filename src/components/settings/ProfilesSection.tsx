import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  DEFAULT_PROFILE_ID, PROFILE_COLORS, PROFILES_MAX,
  type Profile, type ProfileVpn, type ProfilesState,
} from '../../../shared/profiles';
import { SectionHeader, Subsection, OptionList, OptionRow, Segmented, TextField, btnGhost, InlineHint,
} from './kit';
import { RADIUS, TEXT, sp } from '../../styles/system';

// Раздел «Профили» — свои логины и свои настройки сети.
//
// ⚠️ Почему раздел, а не кнопка в тулбаре. Первая версия жила меткой справа от омнибокса, и это
// было неверно дважды: профиль переключают редко (не чаще пары раз в день), а постоянный значок
// занимал слот в кластере, где всё остальное — про текущую страницу. Плюс выпадашка на новой
// вкладке дралась за фокус с адресной строкой, у которой там свой цикл возврата фокуса.
//
// ⚠️ Профиль — единица УДОБСТВА. Поэтому здесь нет ни щитов, ни предупреждений: обычный список,
// как разрешения сайтов или движки поиска. Настройки приватности внутри профиля — такие же
// обычные строки, а не «режим защиты».

const VPN_OPTIONS: { id: ProfileVpn; label: string; hint: string }[] = [
  { id: 'inherit', label: 'Как в приложении', hint: 'Следует общему переключателю VPN' },
  { id: 'on', label: 'Только через VPN', hint: 'Туннель упал — профиль ждёт, а не выходит напрямую' },
  { id: 'off', label: 'Без VPN', hint: 'Прямой выход, даже когда VPN включён в приложении' },
];

export default function ProfilesSection() {
  const [state, setState] = useState<ProfilesState | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // ⚠️ Состояние берётся И из ответа на каждое действие, И из рассылки. Не дублирование:
  // рассылка нужна, чтобы список обновился после правки в другом окне, а ответ — чтобы экран
  // не зависел от того, дошла ли она. Первая версия полагалась только на рассылку, и та уходила
  // мимо слоя хрома: кнопки выглядели мёртвыми, хотя main всё выполнял.
  useEffect(() => {
    void window.oblako.getProfiles().then(setState);
    return window.oblako.onProfilesChanged(setState);
  }, []);

  if (!state) return null;

  async function create() {
    const name = draft.trim();
    if (!name || busy || !state) return;
    setBusy(true);
    try {
      // Цвет — следующий по кругу: выбирать его при заведении незачем, а одинаковые метки
      // не различить в списке.
      const color = PROFILE_COLORS[state.profiles.length % PROFILE_COLORS.length]!;
      setState(await window.oblako.createProfile(name, color));
      setDraft('');
    } finally {
      setBusy(false);
    }
  }

  const pinned = state.startupProfileId;

  return (
    <>
      <SectionHeader title="Профили" />

      <Subsection
        title="Зачем это нужно"
        description="У каждого профиля свои куки и логины: можно держать два аккаунта одного сайта открытыми рядом, а рабочее не смешивать с личным. Плюс свои настройки сети — например, один профиль всегда через VPN, а другой напрямую. История и закладки у каждого профиля свои. Пароли пока общие для всех профилей."
      >
        <span />
      </Subsection>

      <Subsection title="Ваши профили" description="Переключение действует на новые вкладки — уже открытые остаются в своих сессиях">
        <OptionList>
          {state.profiles.map((p) => (
            <OptionRow
              key={p.id}
              title={p.name}
              subtitle={subtitleFor(p, pinned === p.id, state.activeId === p.id)}
              active={state.activeId === p.id}
              onClick={() => { void window.oblako.switchProfile(p.id).then(setState); }}
              icon={<Dot profile={p} />}
              actions={(
                <div style={{ display: 'flex', alignItems: 'center', gap: sp(2) }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setOpenId(openId === p.id ? null : p.id); }}
                    style={btnGhost}
                  >{openId === p.id ? 'Свернуть' : 'Настроить'}</button>
                  {/* ⚠️ Основной профиль не удаляется: это сессия, где лежат данные человека,
                      и «удалить» означало бы стереть их. Кнопки просто нет. */}
                  {p.id !== DEFAULT_PROFILE_ID && (
                    <button
                      title="Удалить профиль вместе с его логинами"
                      onClick={(e) => {
                        e.stopPropagation();
                        void window.oblako.removeProfile(p.id).then(setState);
                        if (openId === p.id) setOpenId(null);
                      }}
                      style={{
                        border: 'none', background: 'transparent', cursor: 'pointer', padding: sp(1),
                        color: 'var(--text-faint)', display: 'inline-flex',
                      }}
                    ><Trash2 size={15} /></button>
                  )}
                </div>
              )}
            />
          ))}
        </OptionList>

        {openId && (() => {
          const p = state.profiles.find((x) => x.id === openId);
          if (!p) return null;
          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: sp(4), paddingTop: sp(2) }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
                <span style={{ ...TEXT.caption }}>Название</span>
                <TextField
                  value={p.name}
                  onChange={(v) => { void window.oblako.renameProfile(p.id, v).then(setState); }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
                <span style={{ ...TEXT.caption }}>Выход в сеть</span>
                <Segmented
                  value={p.settings.vpn}
                  options={VPN_OPTIONS}
                  onChange={(v) => { void window.oblako.setProfileSettings(p.id, { vpn: v }).then(setState); }}
                />
              </div>
              {p.id !== DEFAULT_PROFILE_ID && (
                <InlineHint>
                  Блокировка рекламы в этом профиле режет запросы к трекерам, но не прячет
                  блоки на странице — косметическая часть работает только в основном профиле.
                </InlineHint>
              )}
            </div>
          );
        })()}
      </Subsection>

      {state.profiles.length < PROFILES_MAX && (
        <Subsection title="Новый профиль" description="Например «Работа», «Личное» или «Второй аккаунт»">
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: sp(2) }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <TextField
                value={draft}
                onChange={setDraft}
                placeholder="Работа"
                onEnter={() => { void create(); }}
              />
            </div>
            <button onClick={() => { void create(); }} disabled={busy || !draft.trim()} style={{
              ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: sp(2),
              opacity: busy || !draft.trim() ? 0.5 : 1,
            }}><Plus size={14} /> Создать</button>
          </div>
        </Subsection>
      )}

      {/* ⚠️ Появляется только когда профилей больше одного: пока он один, вопрос «с каким
          запускаться» бессмыслен, а строка настройки — просто шум. */}
      {state.profiles.length > 1 && (
        <Subsection
          title="При запуске браузера"
          description="Можно спрашивать каждый раз или всегда открывать один и тот же профиль"
        >
          <OptionList>
            <OptionRow
              title="Спрашивать"
              subtitle="Экран выбора профиля при каждом запуске"
              active={!pinned}
              onClick={() => { void window.oblako.setStartupProfile(null).then(setState); }}
            />
            {state.profiles.map((p) => (
              <OptionRow
                key={p.id}
                title={`Всегда «${p.name}»`}
                subtitle="Запускаться с этим профилем и не спрашивать"
                active={pinned === p.id}
                onClick={() => { void window.oblako.setStartupProfile(p.id).then(setState); }}
                icon={<Dot profile={p} />}
              />
            ))}
          </OptionList>
        </Subsection>
      )}
    </>
  );
}

function subtitleFor(p: Profile, isPinned: boolean, isActive: boolean): string {
  const parts: string[] = [];
  if (isActive) parts.push('Активен');
  if (isPinned) parts.push('Открывается при запуске');
  const vpn = VPN_OPTIONS.find((o) => o.id === p.settings.vpn);
  if (p.settings.vpn !== 'inherit' && vpn) parts.push(vpn.label);
  return parts.join(' · ') || 'Свои куки и логины';
}

/** Метка профиля — цветной кружок с буквой, как аватар аккаунта. */
export function Dot({ profile, size = 18 }: { profile: Profile; size?: number }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: RADIUS.pill, flex: 'none',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      // ⚠️ Спред роли идёт ПЕРВЫМ: он несёт свой цвет и затёр бы белый, стой он после.
      ...TEXT.caption,
      // ⚠️ Токен, а не литерал: белый на цветной метке — тот же случай, что текст на акценте
      // (--on-accent выведен из него же). Литерал здесь ловит машина, и правильно ловит.
      background: `var(--tile-${profile.color})`, color: 'var(--white)',
      fontWeight: 700, lineHeight: 1,
    }}>{(profile.name.trim()[0] ?? '?').toUpperCase()}</span>
  );
}
