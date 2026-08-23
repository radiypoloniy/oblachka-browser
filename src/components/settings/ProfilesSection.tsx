import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  DEFAULT_PROFILE_ID, PROFILE_COLORS, PROFILES_MAX,
  type Profile, type ProfileAvatar as AvatarValue, type ProfileVpn, type ProfilesState,
} from '../../../shared/profiles';
import { SectionHeader, Subsection, OptionList, OptionRow, Segmented, TextField, btnGhost,
  InlineHint, InlineError,
} from './kit';
import ProfileAvatar, { AVATAR_EMOJI } from '../ProfileAvatar';
import { readFileDataUrl, shrinkAvatarPhoto } from '../profileAvatarPhoto';
import { RADIUS, TEXT, motion, selected, sp } from '../../styles/system';

// Сторона кнопки эмодзи в наборе. Не из шкалы отступов: это площадь НАЖАТИЯ, а не воздух,
// и мельче 32 в неё не попасть мышью с первого раза (правило Fitts, тот же размер у кнопок
// тулбара).
const EMOJI_BTN = 34;

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
        description="У каждого профиля свои куки и логины: можно держать два аккаунта одного сайта открытыми рядом, а рабочее не смешивать с личным. Плюс свои настройки сети — например, один профиль всегда через VPN, а другой напрямую. История, закладки, список загрузок и отслеживание товаров у каждого профиля свои. Сами скачанные файлы лежат в общей папке «Загрузки», как и раньше. Пароли пока общие для всех профилей."
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
              icon={<ProfileAvatar profile={p} />}
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
                <span style={{ ...TEXT.caption }}>Как выглядит</span>
                <AvatarEditor profile={p} onState={setState} />
              </div>
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
                icon={<ProfileAvatar profile={p} />}
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

// Выбор облика профиля: буква, эмодзи или своё фото.
//
// ⚠️ Стоит ПЕРВЫМ в блоке «Настроить», до названия и выхода в сеть. Не потому, что важнее, а
// потому, что это единственная настройка профиля, которую человек видит потом каждый день:
// аватарка едет на экран выбора при запуске и в строку списка, а «выход в сеть» он поставит
// один раз и забудет.
function AvatarEditor({ profile, onState }: { profile: Profile; onState: (s: ProfilesState) => void }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const kind = profile.avatar.kind;
  const emoji = profile.avatar.kind === 'emoji' ? profile.avatar.emoji : '';

  async function apply(av: AvatarValue): Promise<void> {
    setErr('');
    onState(await window.oblako.setProfileAvatar(profile.id, av));
  }

  async function onPick(file: File | undefined): Promise<void> {
    if (!file) return;
    setBusy(true);
    setErr('');
    try {
      const small = await shrinkAvatarPhoto(await readFileDataUrl(file));
      // ⚠️ Отказ ОБЪЯСНЯЕТСЯ. Разбор на той стороне роняет негодную аватарку в букву молча, и без
      // этой строки человек, выбравший файл, увидел бы букву и решил, что кнопка не работает.
      if (!small) { setErr('Не получилось ужать эту картинку — попробуйте другую (PNG, JPEG или WebP)'); return; }
      await apply({ kind: 'photo', dataUrl: small });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(3) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: sp(4) }}>
        {/* Крупный показ — единственное место, где человек видит аватарку в полный рост до того,
            как встретит её на экране выбора при запуске. */}
        <ProfileAvatar profile={profile} size={48} />
        <Segmented
          value={kind}
          options={[
            { id: 'letter' as const, label: 'Буква' },
            { id: 'emoji' as const, label: 'Эмодзи' },
            { id: 'photo' as const, label: 'Фото' },
          ]}
          onChange={(k) => {
            if (k === 'letter') { void apply({ kind: 'letter' }); return; }
            if (k === 'emoji') { void apply({ kind: 'emoji', emoji: emoji || AVATAR_EMOJI[0]! }); return; }
            // ⚠️ «Фото» открывает выбор файла и НЕ переключает вид сам: отменил диалог — облик
            // остался прежним. Иначе отказ от выбора оставлял бы профиль с пустым кружком.
            if (kind !== 'photo') fileRef.current?.click();
          }}
        />
      </div>

      {kind === 'emoji' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(1) }}>
          {AVATAR_EMOJI.map((e) => {
            const active = e === emoji;
            return (
              <button
                key={e}
                onClick={() => { void apply({ kind: 'emoji', emoji: e }); }}
                onMouseEnter={(ev) => { ev.currentTarget.style.transform = motion.lift; }}
                onMouseLeave={(ev) => { ev.currentTarget.style.transform = 'none'; }}
                style={{
                  width: EMOJI_BTN, height: EMOJI_BTN, flex: 'none', borderRadius: RADIUS.control,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  border: 'none', cursor: 'default', lineHeight: 1,
                  // Кегль от кнопки, а не из шкалы текста: это глиф, а не подпись.
                  fontSize: Math.round(EMOJI_BTN * 0.56),
                  background: 'transparent',
                  ...selected(active),
                  // Выбранный держится кольцом цвета профиля — тем же приёмом, что сама аватарка.
                  boxShadow: active ? `inset 0 0 0 1.5px var(--tile-${profile.color})` : 'none',
                  transition: motion.hover('background', 'box-shadow', 'transform'),
                }}
              >{e}</button>
            );
          })}
        </div>
      )}

      {kind === 'photo' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: sp(2) }}>
          <button style={{ ...btnGhost, opacity: busy ? 0.5 : 1 }} disabled={busy}
            onClick={() => fileRef.current?.click()}
          >{busy ? 'Готовлю…' : 'Заменить фото'}</button>
          <button style={btnGhost} onClick={() => { void apply({ kind: 'letter' }); }}>Убрать</button>
        </div>
      )}

      {err && <InlineError>{err}</InlineError>}

      {/* Один вход для файла на оба случая (первый выбор и замена): второй input означал бы
          второй обработчик и второй шанс разойтись. */}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          // ⚠️ Значение сбрасываем СРАЗУ: без этого повторный выбор ТОГО ЖЕ файла не даёт события
          // change вовсе — человек жмёт «заменить», указывает тот же файл, и ничего не происходит.
          e.target.value = '';
          void onPick(file);
        }}
      />
    </div>
  );
}
