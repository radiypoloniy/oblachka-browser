import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  DEFAULT_PROFILE_ID, PROFILE_COLORS, PROFILES_MAX,
  type Profile, type ProfileAvatar as AvatarValue, type ProfileTheme, type ProfileUa,
  type ProfileVpn, type ProfilesState,
} from '../../../shared/profiles';
import { THEME_PALETTE_IDS } from '../../../shared/ipc';
import { SectionHeader, Subsection, OptionList, OptionRow, Segmented, TextField, btnGhost, btnPrimary,
  InlineHint, InlineError, FactGrid, Fact, Stage, SpotCard, InkFrame, CapsLabel, Read,
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

// ⚠️ Двоичные настройки профиля показаны СЕГМЕНТАМИ, а не тумблерами: в разделе настроек
// тумблера нет вовсе (см. kit.tsx), и заводить его ради двух строк здесь значило бы принести в
// продукт ещё один вид контрола — ровно то, из-за чего интерфейсы перестают выглядеть цельными.
const ON_OFF: { id: 'on' | 'off'; label: string }[] = [
  { id: 'on', label: 'Включена' },
  { id: 'off', label: 'Выключена' },
];

const UA_OPTIONS: { id: ProfileUa; label: string; hint: string }[] = [
  { id: 'desktop', label: 'Компьютер', hint: 'Обычные версии сайтов' },
  // ⚠️ Формулировка честная: это НЕ другой отпечаток и не анонимность (см. shared/profiles.ts).
  // Профиль просто получает мобильные версии — иногда они удобнее и легче.
  { id: 'mobile', label: 'Телефон', hint: 'Мобильные версии сайтов — не анонимность, а удобство' },
];

// Язык, который профиль просит у сайтов. ⚠️ Не поле ввода: заголовок Accept-Language человек
// руками не пишет, а ошибка в нём молча ломает выдачу сайтов на «непонятном» языке.
const LANG_OPTIONS: { id: string; label: string; hint: string; value: string | null }[] = [
  { id: 'inherit', label: 'Как в приложении', hint: 'Профиль не просит ничего особенного', value: null },
  { id: 'ru', label: 'Русский', hint: 'Сайты отвечают по-русски, где умеют', value: 'ru-RU,ru;q=0.9,en;q=0.8' },
  { id: 'en', label: 'English', hint: 'Сайты отвечают по-английски, где умеют', value: 'en-US,en;q=0.9' },
];

// Своя тема профиля. ⚠️ Пусто — это «как в приложении», а не «светлая»: профиль без своей темы
// обязан следовать общей настройке, в том числе когда её меняют при открытом профиле.
const THEME_OPTIONS: { id: string; label: string; hint: string; value: ProfileTheme | null }[] = [
  { id: 'inherit', label: 'Как в приложении', hint: 'Тема профиля не задана', value: null },
  { id: 'light', label: 'Светлая', hint: 'Всегда светлая, что бы ни стояло в приложении', value: 'light' },
  { id: 'dark', label: 'Тёмная', hint: 'Всегда тёмная, что бы ни стояло в приложении', value: 'dark' },
  { id: 'system', label: 'Как в системе', hint: 'Следует переключателю Windows', value: 'system' },
];

// ⚠️ Подписи палитр продублированы из раздела «Внешний вид» СОЗНАТЕЛЬНО — те же слова, что человек
// уже видел там. Тащить сюда весь список с образцами цветов незачем: здесь выбирают не палитру
// как таковую, а «чем этот профиль отличается», и хватает названия.
const PALETTE_LABELS: Record<string, string> = {
  charcoal: 'Уголь', graphite: 'Графит', slate: 'Сланец',
  paper: 'Бумага', mint: 'Мята', sky: 'Небо',
};

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
  const featured = state.profiles.find((p) => p.id === (openId ?? state.activeId)) ?? state.profiles[0]!;
  const others = state.profiles.filter((p) => p.id !== featured.id);
  const active = state.profiles.find((p) => p.id === state.activeId);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(6) }}>
      <SectionHeader
        title="Профили"
        hero={active?.name ?? '—'}
        heroLabel="активен сейчас · переключение действует на новые вкладки"
      />

      <FactGrid>
        <Fact label="Куки и логины" hint="Два аккаунта одного сайта рядом" value="Свои" active />
        <Fact label="Сеть" hint="VPN и блокировка — на профиль" value="Своя" active />
        <Fact label="История и закладки" hint="Скачанные файлы — в общей папке" value="Свои" active />
        <Fact label="Пароли" hint="Сейф пока один на устройство" value="Общие" />
      </FactGrid>

      <Subsection
        title="Ваши профили"
        description="Карточка слева — то дело, которое настраиваете. Переключение действует на новые вкладки, уже открытые остаются в своих сессиях."
      >
        <Stage
          lead={(
            <SpotCard
              stain={`var(--tile-${featured.color})`}
              eyebrow="дело"
              icon={<ProfileAvatar profile={featured} size={48} />}
              title={featured.name}
              subtitle={subtitleFor(featured, pinned === featured.id, state.activeId === featured.id)}
              selected
              fields={fieldsFor(featured)}
              mark={state.activeId === featured.id
                ? <span style={{ ...TEXT.caption, color: 'var(--success-500)', fontWeight: 700 }}>Активен</span>
                : undefined}
            />
          )}
          side={(
            <>
              {others.map((p) => (
                <SpotCard
                  key={p.id}
                  compact
                  stain={`var(--tile-${p.color})`}
                  icon={<ProfileAvatar profile={p} size={40} />}
                  title={p.name}
                  subtitle={subtitleFor(p, pinned === p.id, state.activeId === p.id)}
                  selected={false}
                  onClick={() => setOpenId(p.id)}
                  actions={p.id !== DEFAULT_PROFILE_ID ? (
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
                  ) : undefined}
                />
              ))}
              {state.profiles.length < PROFILES_MAX && (
                <InkFrame title="Новое дело" hint="Например «Работа», «Личное» или «Второй аккаунт»">
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
                      ...btnPrimary, display: 'inline-flex', alignItems: 'center', gap: sp(2),
                      opacity: busy || !draft.trim() ? 0.5 : 1,
                    }}><Plus size={14} /> Создать</button>
                  </div>
                </InkFrame>
              )}
            </>
          )}
        />

        <InkFrame
          title={`Настройки «${featured.name}»`}
          hint="Карточка показывает, кто это. Здесь — что ему можно. Основной профиль нельзя удалить и нельзя просить стирать логины при выходе."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: sp(4) }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
              <CapsLabel>Как выглядит</CapsLabel>
              <AvatarEditor profile={featured} onState={setState} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
              <CapsLabel>Тема профиля</CapsLabel>
              <Segmented
                value={THEME_OPTIONS.find((o) => o.value === featured.look.theme)?.id ?? 'inherit'}
                options={THEME_OPTIONS}
                onChange={(v) => {
                  const value = THEME_OPTIONS.find((o) => o.id === v)?.value ?? null;
                  void window.oblako.setProfileLook(featured.id, { theme: value }).then(setState);
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
              <CapsLabel>Палитра профиля</CapsLabel>
              <Segmented
                value={featured.look.palette ?? 'inherit'}
                options={[
                  { id: 'inherit', label: 'Как в приложении' },
                  ...THEME_PALETTE_IDS.map((id) => ({ id, label: PALETTE_LABELS[id] ?? id })),
                ]}
                onChange={(v) => {
                  void window.oblako.setProfileLook(featured.id, { palette: v === 'inherit' ? null : v }).then(setState);
                }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
              <CapsLabel>Название</CapsLabel>
              <TextField
                value={featured.name}
                onChange={(v) => { void window.oblako.renameProfile(featured.id, v).then(setState); }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
              <CapsLabel>Выход в сеть</CapsLabel>
              <Segmented
                value={featured.settings.vpn}
                options={VPN_OPTIONS}
                onChange={(v) => { void window.oblako.setProfileSettings(featured.id, { vpn: v }).then(setState); }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
              <CapsLabel>Как представляться сайтам</CapsLabel>
              <Segmented
                value={featured.settings.ua}
                options={UA_OPTIONS}
                onChange={(v) => { void window.oblako.setProfileSettings(featured.id, { ua: v }).then(setState); }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
              <CapsLabel>Язык сайтов</CapsLabel>
              <Segmented
                value={langIdOf(featured)}
                options={LANG_OPTIONS}
                onChange={(v) => {
                  const value = LANG_OPTIONS.find((o) => o.id === v)?.value ?? null;
                  void window.oblako.setProfileSettings(featured.id, { lang: value }).then(setState);
                }}
              />
            </div>
            {featured.id !== DEFAULT_PROFILE_ID && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
                  <CapsLabel>Блокировка рекламы</CapsLabel>
                  <Segmented
                    value={featured.settings.adblock ? 'on' : 'off'}
                    options={ON_OFF}
                    onChange={(v) => { void window.oblako.setProfileSettings(featured.id, { adblock: v === 'on' }).then(setState); }}
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
                  <CapsLabel>Куки и данные сайтов при выходе</CapsLabel>
                  <Segmented
                    value={featured.settings.clearOnExit ? 'on' : 'off'}
                    options={CLEAR_OPTIONS}
                    onChange={(v) => { void window.oblako.setProfileSettings(featured.id, { clearOnExit: v === 'on' }).then(setState); }}
                  />
                </div>
                <Read>
                  <InlineHint>
                    Блокировка рекламы в этом профиле режет запросы к трекерам, но не прячет
                    блоки на странице — косметическая часть работает только в основном профиле.
                    Очистка при выходе стирает логины этого профиля, но не трогает его историю,
                    закладки и пароли.
                  </InlineHint>
                </Read>
              </>
            )}
            <div style={{ display: 'flex', gap: sp(2), flexWrap: 'wrap' }}>
              {state.activeId !== featured.id && (
                <button
                  onClick={() => { void window.oblako.switchProfile(featured.id).then(setState); }}
                  style={btnPrimary}
                >Переключиться на это дело</button>
              )}
              {featured.id !== DEFAULT_PROFILE_ID && (
                <button
                  onClick={() => {
                    void window.oblako.removeProfile(featured.id).then(setState);
                    setOpenId(null);
                  }}
                  style={btnGhost}
                >Удалить дело</button>
              )}
            </div>
          </div>
        </InkFrame>
      </Subsection>

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
    </div>
  );
}

const CLEAR_OPTIONS: { id: 'on' | 'off'; label: string; hint: string }[] = [
  { id: 'off', label: 'Оставлять', hint: 'Профиль помнит, где вы вошли' },
  { id: 'on', label: 'Стирать', hint: 'При закрытии браузера логины этого профиля пропадут' },
];

/** Какой из вариантов языка выбран сейчас. Незнакомая строка считается «как в приложении». */
function langIdOf(p: Profile): string {
  return LANG_OPTIONS.find((o) => o.value === p.settings.lang)?.id ?? 'inherit';
}

function subtitleFor(p: Profile, isPinned: boolean, isActive: boolean): string {
  const parts: string[] = [];
  if (isActive) parts.push('Активен');
  if (isPinned) parts.push('Открывается при запуске');
  const vpn = VPN_OPTIONS.find((o) => o.id === p.settings.vpn);
  if (p.settings.vpn !== 'inherit' && vpn) parts.push(vpn.label);
  // ⚠️ Про очистку сказано В СПИСКЕ, а не только внутри «Настроить»: это единственная настройка
  // профиля, которая ТЕРЯЕТ данные, и узнавать о ней, раскрыв карточку, поздно.
  if (p.settings.clearOnExit && p.id !== DEFAULT_PROFILE_ID) parts.push('Стирает логины при выходе');
  if (p.settings.ua === 'mobile') parts.push('Мобильные версии');
  if (p.look.theme || p.look.palette) parts.push('Свой облик');
  return parts.join(' · ') || 'Свои куки и логины';
}

function fieldsFor(p: Profile): { label: string; value: string }[] {
  const vpn = VPN_OPTIONS.find((o) => o.id === p.settings.vpn);
  const ua = UA_OPTIONS.find((o) => o.id === p.settings.ua);
  const lang = LANG_OPTIONS.find((o) => o.id === langIdOf(p));
  return [
    { label: 'Выход', value: vpn?.label ?? 'Как в приложении' },
    { label: 'Сайтам', value: ua?.label ?? 'Компьютер' },
    { label: 'Язык', value: lang?.label ?? 'Как в приложении' },
    { label: 'Облик', value: (p.look.theme || p.look.palette) ? 'Свой' : 'Как в приложении' },
  ];
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
