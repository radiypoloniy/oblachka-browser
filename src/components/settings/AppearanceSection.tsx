import { useEffect, useRef, useState } from 'react';
import { Upload, Trash2, RotateCcw, Plus, Shuffle } from 'lucide-react';
import { SectionHeader, Subsection, InlineError, InlineHint, TextField, btnGhost, segBtnStyle, SegTrack,
  FactGrid, Fact, SpotGrid, SpotCard, MasterSwitch, OptionList, OptionRow, CapsLabel,
} from './kit';
import Toggle from '../Toggle';
import { isDarkTheme } from '../../../shared/ipc';
import type { ThemeMode, ThemePaletteId, ThemePrefs } from '../../../shared/ipc';
import {
  loadNewTabSettings, saveNewTabSettings, setNewTabCustomImage, getNewTabCustomImage,
  shrinkBackgroundImage,
  WALLPAPER_PRESETS, livePresetId, RATE_CHOICES, CRYPTO_CHOICES, TINT_AMOUNT_MIN, TINT_AMOUNT_MAX,
  POSTER_TONES,
  type NewTabSettings, type BackgroundKind,
} from '../../newtab/settings';
import { allMeshes, deleteUserMesh, isUserMesh, saveUserMesh, subscribeMeshes, meshCss } from '../../newtab/gradients';
import {
  createMeshDraft, randomMesh, type MeshGradient,
} from '../../../shared/chromeGround';
import GradientEditor from './GradientEditor';

import CryptoIcon from '../CryptoIcon';
import { RADIUS, TEXT, pad, sp } from '../../styles/system';

// Раздел «Интерфейс» — оформление самого браузера (тема и палитра) и новой вкладки.
// Настройки вкладки пишутся в localStorage-стор (saveNewTabSettings шлёт событие → открытая
// вкладка применяет изменения живьём), тема — в main, потому что её обязаны знать все окна и
// каждый поповер (см. shared/ipc.ts::ThemePrefs). UI-примитивы — из settings/kit + общий Toggle.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // свыше — риск переполнить квоту localStorage

// Сторона образца палитры, обоев и градиента.
// ⚠️ Не из шкалы отступов: это КАРТИНКА, её читают целиком, а не как элемент вёрстки. На прежних
// 64×44 «Уголь» и «Бумага» различались одним оттенком фона, и весь раздел рядом с крупным
// набором остальных настроек выглядел набором служебных квадратиков — живой отзыв: «всё очень
// мелкое и старомодное». Радиус — коробочный, как у всех карточек раздела, а не radius-sm.
const SWATCH_W = 84;
const SWATCH_H = 56;

const THEME_MODES: [ThemeMode, string][] = [['light', 'Светлая'], ['dark', 'Тёмная'], ['system', 'Как в системе']];

// Подпись под именем темы — что она означает, а не как называется.
const THEME_HINT: Record<ThemeMode, string> = {
  light: 'Всегда светлый интерфейс',
  dark: 'Всегда тёмный интерфейс',
  system: 'Следует переключателю Windows',
};

// Чем сейчас занят фон новой вкладки — одним словом для плитки факта.
const BG_WORD: Record<BackgroundKind, string> = {
  preset: 'Градиент',
  mesh: 'Свой градиент',
  color: 'Свой цвет',
  custom: 'Своё фото',
  photo: 'Фото дня',
};

// Образцы палитр для превью. ⚠️ Значения продублированы из palettes.css сознательно: показать
// невыбранную палитру можно только её собственными цветами, а прочитать CSS-переменные темы,
// которая сейчас не применена, нельзя в принципе. Дублируются ТОЛЬКО три ступени: фон окна,
// поверхность острова и текст на нём — из них и складывается узнаваемый вид палитры. Полоска
// текста в образце не украшение: без неё «Уголь» и «Бумага» на квадратике 64×44 различались бы
// только оттенком фона, а тёплое/холодное как раз заметнее всего именно на тексте.
type Swatch = [ground: string, surface: string, text: string];
const PALETTES: { id: ThemePaletteId; label: string; hint: string; light: Swatch; dark: Swatch }[] = [
  { id: 'charcoal', label: 'Уголь',  hint: 'Как в iOS',   light: ['#F2F2F7', '#FFFFFF', '#3C3C43'], dark: ['#121214', '#1C1C1E', '#EBEBF5'] },
  { id: 'graphite', label: 'Графит', hint: 'Как в macOS', light: ['#ECECEC', '#FFFFFF', '#3C3C43'], dark: ['#1E1E1E', '#2C2C2C', '#EBEBF5'] },
  { id: 'slate',    label: 'Сланец', hint: 'Холодный',    light: ['#E5E9F0', '#FFFFFF', '#3B4252'], dark: ['#2E3440', '#3B4252', '#E5E9F0'] },
  { id: 'paper',    label: 'Бумага', hint: 'Тёплый',      light: ['#F1EDE4', '#FDFBF6', '#3A332A'], dark: ['#14120F', '#1C1917', '#E9E3D9'] },
  // ⚠️ Две палитры с ЦВЕТНОЙ землёй. Зелёная земля не означает «VPN включён», а голубая —
  // «облако»: функциональные цвета живут в акценте и значках, палитра их не трогает (см. разбор
  // в palettes.css).
  { id: 'mint',     label: 'Мята',   hint: 'Зелёная земля', light: ['#E9F2EC', '#FFFFFF', '#2C3A31'], dark: ['#101613', '#18201B', '#DDE9E1'] },
  { id: 'sky',      label: 'Небо',   hint: 'Голубая земля', light: ['#E8EEFA', '#FFFFFF', '#2C3550'], dark: ['#0F1319', '#171C24', '#DEE5F0'] },
];

export default function AppearanceSection() {
  const [s, setS] = useState<NewTabSettings>(() => loadNewTabSettings());
  // Тема живёт в main; здесь только копия для отрисовки. Подписка нужна не для своих же кликов, а
  // для чужих: то же самое окно настроек может стоять открытым, пока тему меняют в другом окне или
  // пока система сама переключает светлую/тёмную.
  const [theme, setTheme] = useState<ThemePrefs>({ mode: 'light', palette: 'charcoal', systemDark: false });
  useEffect(() => {
    void window.oblako.getTheme().then(setTheme).catch(() => { /* останется дефолт */ });
    return window.oblako.onThemeChanged(setTheme);
  }, []);
  const applyTheme = (mode: ThemeMode, palette: ThemePaletteId) => {
    setTheme((t) => ({ ...t, mode, palette })); // сразу, не дожидаясь ответа: кнопка не должна «залипать»
    void window.oblako.setTheme(mode, palette);
  };
  const themeIsDark = isDarkTheme(theme);
  const [hasCustom, setHasCustom] = useState(() => getNewTabCustomImage() !== null);
  const [imgError, setImgError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [meshes, setMeshes] = useState(() => allMeshes());
  useEffect(() => subscribeMeshes(() => setMeshes(allMeshes())), []);
  const [draft, setDraft] = useState<MeshGradient | null>(null);
  const [draftTarget, setDraftTarget] = useState<'chrome' | 'newtab'>('newtab');

  function apply(next: NewTabSettings) { setS(next); saveNewTabSettings(next); }
  const patchBg = (p: Partial<NewTabSettings['background']>) => apply({ ...s, background: { ...s.background, ...p } });
  const patchClock = (p: Partial<NewTabSettings['clock']>) => apply({ ...s, clock: { ...s.clock, ...p } });
  const patchWeather = (p: Partial<NewTabSettings['weather']>) => apply({ ...s, weather: { ...s.weather, ...p } });
  const patchRates = (p: Partial<NewTabSettings['rates']>) => apply({ ...s, rates: { ...s.rates, ...p } });
  const patchSidebar = (p: Partial<NewTabSettings['sidebar']>) => apply({ ...s, sidebar: { ...s.sidebar, ...p } });

  function applyRandom(from: 'chrome' | 'newtab') {
    const saved = saveUserMesh(randomMesh());
    if (!saved) { openDraft(from, randomMesh()); return; }
    if (from === 'chrome') {
      apply({ ...s, sidebar: { ...s.sidebar, tinted: true, source: 'mesh', meshId: saved.id } });
    } else {
      apply({ ...s, background: { ...s.background, kind: 'mesh', meshId: saved.id } });
    }
  }

  function openDraft(from: 'chrome' | 'newtab', existing?: MeshGradient) {
    setDraftTarget(from);
    setDraft(existing ? { ...existing } : createMeshDraft(['#81b29a', '#e07a5f', '#1d3557'], 'Градиент'));
  }

  function saveDraft() {
    if (!draft) return;
    const saved = saveUserMesh(draft);
    if (!saved) return;
    if (draftTarget === 'chrome') {
      apply({ ...s, sidebar: { ...s.sidebar, tinted: true, source: 'mesh', meshId: saved.id } });
    } else {
      apply({ ...s, background: { ...s.background, kind: 'mesh', meshId: saved.id } });
    }
    setDraft(null);
  }

  function removeMesh(id: string) {
    deleteUserMesh(id);
    apply({
      ...s,
      sidebar: s.sidebar.meshId === id ? { ...s.sidebar, source: 'palette', meshId: '' } : s.sidebar,
      background: s.background.meshId === id
        ? { ...s.background, kind: s.background.kind === 'mesh' ? 'preset' : s.background.kind, meshId: '' }
        : s.background,
    });
  }

  // Порядок валют в строке — порядок RATE_CHOICES, а не порядок кликов: иначе набор из тех же
  // валют выглядит по-разному в зависимости от того, как его собирали.
  const toggleRateCode = (code: string) => {
    const has = s.rates.codes.includes(code);
    const next = has
      ? s.rates.codes.filter((c) => c !== code)
      : RATE_CHOICES.map((c) => c.code).filter((c) => c === code || s.rates.codes.includes(c));
    patchRates({ codes: next });
  };

  // Тот же приём для крипты — порядок из CRYPTO_CHOICES, а не из порядка кликов.
  const toggleCryptoCode = (code: string) => {
    const has = s.crypto.codes.includes(code);
    const next = has
      ? s.crypto.codes.filter((c) => c !== code)
      : CRYPTO_CHOICES.map((c) => c.code).filter((c) => c === code || s.crypto.codes.includes(c));
    apply({ ...s, crypto: { ...s.crypto, codes: next } });
  };

  function onPickFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) { setImgError('Файл больше 8 МБ'); return; }
    setImgError('');
    const reader = new FileReader();
    reader.onload = () => {
      const raw = reader.result as string;
      // Показываем сразу, а ужимаем следом (см. shrinkBackgroundImage): полноразмерное фото с
      // телефона/камеры стоит рендереру сотни миллисекунд на каждый показ новой вкладки.
      setNewTabCustomImage(raw);
      setHasCustom(true);
      patchBg({ kind: 'custom' });
      void shrinkBackgroundImage(raw)
        .then((small) => { if (small.length < raw.length) setNewTabCustomImage(small); })
        .catch(() => { /* не вышло — останется исходная картинка */ });
    };
    reader.onerror = () => setImgError('Не удалось прочитать файл');
    reader.readAsDataURL(file);
  }

  function removeCustom() {
    setNewTabCustomImage(null);
    setHasCustom(false);
    if (s.background.kind === 'custom') patchBg({ kind: 'preset' });
  }

  // Нынешний облик словами — для шапки и плиток. ⚠️ Берётся из тех же таблиц, что рисуют выбор
  // ниже (THEME_MODES, PALETTES, BG_WORD): вторая копия подписей разошлась бы с первой в тот
  // день, когда добавят седьмую палитру.
  const themeWord = THEME_MODES.find(([m]) => m === theme.mode)?.[1] ?? 'Светлая';
  const palette = PALETTES.find((p) => p.id === theme.palette);
  const paletteLabel = palette?.label ?? 'Уголь';
  const paletteHint = palette?.hint ?? 'оттенок нейтрали';
  const groundWord = !s.sidebar.tinted
    ? 'Ровный'
    : s.sidebar.source === 'mesh' ? 'Свой градиент'
    : s.sidebar.source === 'poster'
      ? (POSTER_TONES.find((t) => t.id === s.sidebar.tone)?.label ?? 'Краска')
      : 'Тон палитры';
  const bgWord = BG_WORD[s.background.kind];

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(8), alignItems: 'flex-start' }}>
      {/* ⚠️ Ширину колонка не ограничивает: раздел двухколоночный (настройки + живой предпросмотр
          новой вкладки), и обе колонки делят место сами. Зашитые 560 px мешали именно здесь —
          предпросмотр прижимался к краю, хотя места было вдоволь. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: sp(6), flex: '1 1 420px', minWidth: 0 }}>
      {/* ⚠️ ГЕРОЙ — нынешний облик словами, а не название раздела. До этого «Интерфейс» был
          единственным крупным разделом без ответа в шапке: чтобы понять, какая тема и палитра
          стоят, приходилось искать подсвеченный образец среди шести квадратиков. */}
      <SectionHeader
        title="Интерфейс"
        hero={`${themeWord} · ${paletteLabel}`}
        heroLabel="облик всего браузера — окно, поповеры и новая вкладка"
      >
        Тема и палитра браузера, оформление новой вкладки — фон, часы, приветствие и быстрые ссылки.
      </SectionHeader>

      <FactGrid>
        <Fact label="Тема" hint="светлая, тёмная или вслед за системой" value={themeWord} active />
        <Fact label="Палитра" hint={paletteHint} value={paletteLabel} active />
        <Fact
          label="Фон окна"
          hint={s.sidebar.tinted ? 'мягкий градиент и текстура' : 'ровная заливка палитры'}
          value={groundWord}
          active={s.sidebar.tinted}
        />
        <Fact label="Новая вкладка" hint="что стоит фоном" value={bgWord} active />
      </FactGrid>

      {/* ── Тема ──
          ⚠️ КАРТОЧКИ С ОБРАЗЦОМ, а не три слова в пилюле. Тема — это не пункт списка, а то, как
          браузер будет выглядеть; выбирать её по подписи «Светлая» значит выбирать вслепую.
          Образец рисуется теми же цветами, что и палитра ниже, поэтому пара «тема + палитра»
          видна целиком до применения. */}
      <Subsection title="Тема" description="Светлая, тёмная или вслед за системой. Образец показывает выбранную палитру.">
        <SpotGrid dense>
          {THEME_MODES.map(([mode, label]) => (
            <SpotCard
              key={mode}
              compact
              stack
              selected={theme.mode === mode}
              onClick={() => applyTheme(mode, theme.palette)}
              icon={<ThemeSample mode={mode} palette={palette} systemDark={theme.systemDark} />}
              title={label}
              subtitle={THEME_HINT[mode]}
            />
          ))}
        </SpotGrid>
        {/* Приватные вкладки всегда тёмные и всегда одного вида — иначе режим перестаёт читаться
            как режим. Сказать об этом здесь дешевле, чем оставить человека гадать, почему выбор
            не подействовал на окно инкогнито. */}
        <InlineHint>Приватные вкладки остаются тёмными при любой теме.</InlineHint>
      </Subsection>

      {/* ── Палитра ── */}
      <Subsection title="Палитра" description="Оттенок нейтрали: фон, поверхности и текст. Акцентный цвет не меняется.">
        <SpotGrid dense>
          {PALETTES.map((p) => (
            <SpotCard
              key={p.id}
              compact
              stack
              selected={theme.palette === p.id}
              onClick={() => applyTheme(theme.mode, p.id)}
              icon={<Sample swatch={themeIsDark ? p.dark : p.light} />}
              title={p.label}
              subtitle={p.hint}
            />
          ))}
        </SpotGrid>
      </Subsection>

      {/* ── Фон интерфейса ──
          ⚠️ Один тумблер, а не список вариантов: оттенок и так берётся из выбранной палитры,
          поэтому «какой именно цветной» — вопрос, на который человеку отвечать не нужно.
          Стоит сразу за палитрой не случайно: это её продолжение, а не отдельная тема.
          ⚠️ Назывался «цветной сайдбар» и красил только его — из-за чего сайдбар и выглядел
          боковой плашкой на сером окне. Подкраска это свойство ОКНА; ключ в хранилище оставлен
          прежним (`sidebar.tinted`), чтобы не терять уже сделанный человеком выбор. */}
      <Subsection title="Фон интерфейса" description="Мягкий градиент и лёгкая текстура на всём окне вместо ровной заливки. Можно взять тон палитры или свой градиент из общего каталога.">
        {/* ⚠️ ГЛАВНЫЙ ПЕРЕКЛЮЧАТЕЛЬ блока, а не голая строка с тумблером: всё остальное здесь
            (градиенты, насыщенность) существует только когда он включён. Тот же рецепт, что у
            блокировки рекламы и подтверждения Windows у паролей. */}
        <MasterSwitch
          on={s.sidebar.tinted}
          title={s.sidebar.tinted ? 'Цветной фон' : 'Ровная заливка'}
          description={s.sidebar.tinted
            ? 'Мягкий градиент и лёгкая текстура на всём окне'
            : 'Окно залито ровным фоном палитры'}
          control={<Toggle checked={s.sidebar.tinted} onChange={() => apply({ ...s, sidebar: { ...s.sidebar, tinted: !s.sidebar.tinted } })} />}
        />
        {s.sidebar.tinted && (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(3) }}>
              <button
                title="Палитра"
                onClick={() => patchSidebar({ source: 'palette' })}
                style={{
                  width: SWATCH_W, height: SWATCH_H, borderRadius: RADIUS.box, cursor: 'default', border: 'none',
                  background: 'linear-gradient(180deg, color-mix(in srgb, var(--sidebar-tint) 45%, var(--app-bg)), var(--app-bg))',
                  outline: s.sidebar.source === 'palette' ? '2px solid var(--accent)' : '2px solid transparent',
                  outlineOffset: 2,
                }}
              />
              {/* ⚠️ Краска здесь — ТОН ЗЕМЛИ, а не заливка хрома: она подмешивается к --app-bg
                  долей «Насыщенности» с прежним потолком 30%, выше которого острова перестают
                  отделяться от фона. Поэтому образец показан так же, как у палитры, — растяжкой
                  в землю, а не квадратом краски в полную силу: иначе он обещал бы не то. */}
              {POSTER_TONES.map((t) => (
                <button
                  key={t.id}
                  title={t.label}
                  onClick={() => patchSidebar({ source: 'poster', tone: t.id })}
                  style={{
                    width: SWATCH_W, height: SWATCH_H, borderRadius: RADIUS.box, cursor: 'default', border: 'none',
                    background: `linear-gradient(180deg, color-mix(in srgb, ${t.css} 45%, var(--app-bg)), var(--app-bg))`,
                    outline: s.sidebar.source === 'poster' && s.sidebar.tone === t.id
                      ? '2px solid var(--accent)' : '2px solid transparent',
                    outlineOffset: 2,
                  }}
                />
              ))}
              {meshes.map((m) => (
                <MeshThumb
                  key={m.id}
                  mesh={m}
                  dark={themeIsDark}
                  selected={s.sidebar.source === 'mesh' && s.sidebar.meshId === m.id}
                  onSelect={() => patchSidebar({ source: 'mesh', meshId: m.id })}
                  onEdit={() => openDraft('chrome', m)}
                  onDelete={isUserMesh(m.id) ? () => removeMesh(m.id) : undefined}
                />
              ))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2) }}>
            <button
              onClick={() => openDraft('chrome')}
              style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: sp(2) }}
            >
              <Plus size={14} /> Создать градиент
            </button>
            <button
              onClick={() => applyRandom('chrome')}
              style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: sp(2) }}
            >
              <Shuffle size={14} /> Случайный
            </button>
            </div>
            {s.sidebar.source !== 'mesh' && (
              <OptionList>
                <SliderRow
                  label="Насыщенность"
                  value={s.sidebar.amount}
                  min={TINT_AMOUNT_MIN} max={TINT_AMOUNT_MAX} step={1}
                  onChange={(v) => patchSidebar({ amount: v })}
                  format={(v) => `${v}%`}
                />
              </OptionList>
            )}
          </>
        )}
      </Subsection>

      {/* ── Фон ── */}
      <Subsection title="Фон" description="Градиент, свой цвет или изображение. Свои градиенты те же, что у фона интерфейса.">
        <SegTrack>
          {([['preset', 'Градиент'], ['color', 'Цвет'], ['custom', 'Своё фото'], ['photo', 'Фото дня']] as [BackgroundKind, string][]).map(([kind, label]) => {
            const gradientOn = s.background.kind === 'preset' || s.background.kind === 'mesh';
            const active = kind === 'preset' ? gradientOn : s.background.kind === kind;
            return (
            <SegBtn key={kind} active={active}
              onClick={() => patchBg({ kind: kind === 'preset' && s.background.meshId ? 'mesh' : kind })}>{label}</SegBtn>
            );
          })}
        </SegTrack>

        {s.background.kind === 'photo' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: sp(2), flexWrap: 'wrap' }}>
            <span style={{ flex: 1, minWidth: '24ch' }}>
              <InlineHint>
                Картинка дня Wikimedia — отбирают редакторы Commons. Загружается через ваше
                соединение или VPN и кэшируется на день.
              </InlineHint>
            </span>
            {/* ⚠️ «Другое фото» — шаг НАЗАД ПО КАЛЕНДАРЮ, а не случайный снимок: у Wikimedia на
                каждый день ровно одна отобранная картинка, поэтому вчерашняя тоже хорошая.
                Случайный выбор вернул бы ровно то, ради чего мы ушли от прежнего источника, —
                непредсказуемое качество. */}
            <button
              onClick={() => { void window.oblako.shuffleNewtabPhoto(); }}
              style={{
                ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: sp(1),
              }}
            >
              <RotateCcw size={14} /> Другое фото
            </button>
          </div>
        )}

        {(s.background.kind === 'preset' || s.background.kind === 'mesh') && (
          <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(3) }}>
            {WALLPAPER_PRESETS.map((p) => (
              <button key={p.id} title={p.label} onClick={() => patchBg({ kind: 'preset', preset: p.id })}
                style={{
                  width: SWATCH_W, height: SWATCH_H, borderRadius: RADIUS.box, cursor: 'default',
                  background: p.css, border: 'none',
                  // ⚠️ Сравниваем через livePresetId: у человека мог остаться выбранным снятый
                  // фон («Лаванда», «Полночь»), и без перевода ни один образец не подсветился бы
                  // — список выглядел бы так, будто фон не выбран вовсе.
                  outline: s.background.kind === 'preset' && livePresetId(s.background.preset) === p.id ? '2px solid var(--accent)' : '2px solid transparent',
                  outlineOffset: 2,
                }} />
            ))}
            {meshes.map((m) => (
              <MeshThumb
                key={m.id}
                mesh={m}
                dark={themeIsDark}
                selected={s.background.kind === 'mesh' && s.background.meshId === m.id}
                onSelect={() => patchBg({ kind: 'mesh', meshId: m.id })}
                onEdit={() => openDraft('newtab', m)}
                onDelete={isUserMesh(m.id) ? () => removeMesh(m.id) : undefined}
              />
            ))}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2) }}>
          <button
            onClick={() => openDraft('newtab')}
            style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: sp(2) }}
          >
            <Plus size={14} /> Создать градиент
          </button>
          <button
            onClick={() => applyRandom('newtab')}
            style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: sp(2) }}
          >
            <Shuffle size={14} /> Случайный
          </button>
          </div>
          </>
        )}

        {s.background.kind === 'color' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: sp(3) }}>
            <input type="color" value={s.background.color}
              onChange={(e) => patchBg({ color: e.target.value })}
              style={{ width: 44, height: 32, border: 'none', background: 'none', cursor: 'default' }} />
            <span style={{ ...TEXT.body, color: 'var(--text-strong)', fontFamily: 'var(--font-mono)' }}>{s.background.color}</span>
          </div>
        )}

        {s.background.kind === 'custom' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
            <input ref={fileRef} type="file" accept="image/*" hidden
              onChange={(e) => onPickFile(e.target.files?.[0])} />
            <div style={{ display: 'flex', gap: sp(2) }}>
              <button style={{ ...btnGhost, display: 'flex', gap: sp(2), alignItems: 'center' }} onClick={() => fileRef.current?.click()}>
                <Upload size={14} /> {hasCustom ? 'Заменить фото' : 'Выбрать фото'}
              </button>
              {hasCustom && (
                <button style={{ ...btnGhost, display: 'flex', gap: sp(2), alignItems: 'center' }} onClick={removeCustom}>
                  <Trash2 size={14} /> Убрать
                </button>
              )}
            </div>
            {imgError && <InlineError>{imgError}</InlineError>}
            {!hasCustom && !imgError && <InlineHint>Изображение хранится локально на этом устройстве.</InlineHint>}
          </div>
        )}

        <OptionList>
        <SliderRow label="Затемнение" value={s.background.dim} min={0} max={0.8} step={0.02}
          onChange={(v) => patchBg({ dim: v })} format={(v) => `${Math.round(v * 100)}%`} />
        {/* ⚠️ Потолок снижен с 40: размытие держали ради читаемости виджетов, а эту работу теперь
            делает материал — карточка размывает фон ПОД СОБОЙ, обои остаются резкими. Сорок
            пикселей превращали фотографию в цветное пятно; шестнадцати хватает как эффекту. */}
        <SliderRow label="Размытие" value={s.background.blur} min={0} max={16} step={1}
          onChange={(v) => patchBg({ blur: v })} format={(v) => `${v}px`} />
        </OptionList>
      </Subsection>

      {/* ── Часы ── */}
      {/* ⚠️ Тумблера «показывать» здесь больше нет ни у часов, ни у погоды с курсами: состав
          экрана определяется тем, какие виджеты на нём стоят (см. src/newtab/desktop.ts), а
          два разных способа убрать одно и то же неизбежно разошлись бы. Здесь остались только
          настройки САМИХ виджетов — формат времени, город, валюты. */}
      <Subsection title="Часы" description="Вид и формат виджета часов на новой вкладке.">
        <SegTrack>
          <SegBtn active={s.clock.face !== 'digital'} onClick={() => patchClock({ face: 'analog' })}>Циферблат</SegBtn>
          <SegBtn active={s.clock.face === 'digital'} onClick={() => patchClock({ face: 'digital' })}>Цифры</SegBtn>
        </SegTrack>
        {/* 24-часовой формат у циферблата смысла не имеет — прячем, а не показываем неработающий
            тумблер. «Секунды» осмысленны у обоих: у стрелок это секундная стрелка. */}
        <OptionList>
          {s.clock.face === 'digital' && (
            <SwitchRow title="24-часовой формат" subtitle="Иначе 12 часов с AM и PM"
              checked={s.clock.hour24} onChange={(v) => patchClock({ hour24: v })} />
          )}
          <SwitchRow
            title={s.clock.face === 'digital' ? 'Секунды' : 'Секундная стрелка'}
            subtitle="Обновление раз в секунду вместо раза в минуту"
            checked={s.clock.seconds} onChange={(v) => patchClock({ seconds: v })} />
          <SwitchRow title="Дата и день недели" subtitle="Строка под временем"
            checked={s.clock.date} onChange={(v) => patchClock({ date: v })} />
        </OptionList>
      </Subsection>

      {/* ── Поиск ── */}
      <Subsection title="Поиск" description="Строка поиска на самой новой вкладке — адресная строка работает независимо от неё.">
        <OptionList>
          <SwitchRow title="Строка поиска" subtitle="Поле по центру новой вкладки"
            checked={s.search.show} onChange={(v) => apply({ ...s, search: { show: v } })} />
        </OptionList>
      </Subsection>

      {/* ── Погода ── */}
      <Subsection title="Погода" description="Город для виджета погоды на новой вкладке.">
        <>
          <TextField value={s.weather.city} placeholder="Город (например, Москва)"
            onChange={(v) => patchWeather({ city: v })} />
          <SegTrack>
            <SegBtn active={s.weather.units === 'c'} onClick={() => patchWeather({ units: 'c' })}>°C</SegBtn>
            <SegBtn active={s.weather.units === 'f'} onClick={() => patchWeather({ units: 'f' })}>°F</SegBtn>
          </SegTrack>
        </>
      </Subsection>

      {/* ── Курс валют ── */}
      <Subsection title="Курс валют" description="Какие валюты показывает виджет курса (данные ЦБ РФ).">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2) }}>
          {RATE_CHOICES.map((c) => (
            <SegBtn key={c.code} active={s.rates.codes.includes(c.code)} onClick={() => toggleRateCode(c.code)}>
              {c.symbol} {c.label}
            </SegBtn>
          ))}
        </div>
      </Subsection>

      {/* ── Крипта ── */}
      <Subsection title="Крипта" description="Какие активы показывает виджет «Крипта» (цены в рублях, источник — CoinGecko).">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2) }}>
          {CRYPTO_CHOICES.map((c) => (
            <SegBtn key={c.code} active={s.crypto.codes.includes(c.code)} onClick={() => toggleCryptoCode(c.code)}>
              {/* Тот же значок, что в самом виджете, — выбирают по нему, а не по названию. */}
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: sp(2) }}>
                <CryptoIcon code={c.code} size={16} /> {c.label}
              </span>
            </SegBtn>
          ))}
        </div>
      </Subsection>
      </div>

      {draft && (
        <div style={{ flex: '1 1 280px', minWidth: 0, maxWidth: 480, position: 'sticky', top: 0, alignSelf: 'flex-start' }}>
          <GradientEditor
            mesh={draft}
            dark={themeIsDark}
            onChange={setDraft}
            onSave={saveDraft}
            onCancel={() => setDraft(null)}
            heading={draftTarget === 'chrome' ? 'Градиент фона интерфейса' : 'Градиент новой вкладки'}
          />
        </div>
      )}
    </div>
  );
}

// ── Мелкие презентационные хелперы секции ────────────────────────────────────
// ⚠️ Своего SegBtn здесь больше нет: рецепт сегмента живёт в kit.tsx (segBtnStyle) и одинаков
// для темы, фона, часов, единиц и трёхпозиционного выбора разрешений. Три копии этой кнопки уже
// разъехались по отступам и тени — это ровно тот случай, когда «мелкая правка» ломает систему.
function SegBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button onClick={onClick} style={segBtnStyle(active)}>{children}</button>;
}

// Образец палитры: земля, на ней приподнятый остров, на острове две строки текста.
//
// ⚠️ Рисуется той же ЛЕСТНИЦЕЙ, что и настоящий интерфейс, а не квадратиком одного цвета. Полоска
// текста здесь не украшение: без неё «Уголь» и «Бумага» различались бы только оттенком фона, а
// тёплое/холодное заметнее всего именно на тексте. Значения ступеней продублированы из
// palettes.css сознательно — прочитать переменные НЕ применённой сейчас темы нельзя в принципе.
function Sample({ swatch, clip }: { swatch: Swatch; clip?: 'left' | 'right' }) {
  const [ground, surface, text] = swatch;
  return (
    <span style={{
      // Половинки «как в системе» стыкуются встык: у каждой своя земля, обводка общая снаружи.
      position: clip ? 'absolute' : 'relative',
      inset: clip === 'left' ? '0 50% 0 0' : clip === 'right' ? '0 0 0 50%' : undefined,
      width: clip ? undefined : SWATCH_W, height: clip ? undefined : SWATCH_H,
      borderRadius: clip ? 0 : RADIUS.box, background: ground, overflow: 'hidden',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: sp(2),
    }}>
      <span style={{
        width: 58, height: 28, borderRadius: RADIUS.control, background: surface, flex: 'none',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4, padding: '0 8px',
      }}>
        <span style={{ height: 3, borderRadius: RADIUS.tight, background: text, opacity: 0.85 }} />
        <span style={{ height: 3, borderRadius: RADIUS.tight, background: text, opacity: 0.45, width: '65%' }} />
      </span>
    </span>
  );
}

// Образец темы. ⚠️ «Как в системе» показан РАЗРЕЗАННЫМ ПОПОЛАМ, а не той половиной, что стоит в
// Windows прямо сейчас: смысл варианта в том, что вид меняется сам, и картинка обязана это
// сказать. Показывать только текущую половину значило бы рисовать её неотличимой от «Светлой».
function ThemeSample({ mode, palette, systemDark }: {
  mode: ThemeMode;
  palette: { light: Swatch; dark: Swatch } | undefined;
  systemDark: boolean;
}) {
  const light = palette?.light ?? PALETTES[0]!.light;
  const dark = palette?.dark ?? PALETTES[0]!.dark;
  const frame: React.CSSProperties = {
    position: 'relative', width: SWATCH_W, height: SWATCH_H, borderRadius: RADIUS.box,
    overflow: 'hidden', flex: 'none', display: 'block',
    boxShadow: 'inset 0 0 0 1px var(--divider)',
  };
  if (mode === 'system') {
    return (
      <span style={frame} title={systemDark ? 'Сейчас в Windows тёмная' : 'Сейчас в Windows светлая'}>
        <Sample swatch={light} clip="left" />
        <Sample swatch={dark} clip="right" />
      </span>
    );
  }
  return <span style={frame}><Sample swatch={mode === 'dark' ? dark : light} /></span>;
}

function MeshThumb({ mesh, dark, selected, onSelect, onEdit, onDelete }: {
  mesh: MeshGradient; dark: boolean; selected: boolean; onSelect: () => void; onEdit: () => void; onDelete?: () => void;
}) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        title={mesh.name}
        onClick={onSelect}
        onDoubleClick={onEdit}
        style={{
          width: SWATCH_W, height: SWATCH_H, borderRadius: RADIUS.box, cursor: 'default', border: 'none',
          backgroundImage: meshCss(mesh, dark), backgroundSize: 'cover',
          outline: selected ? '2px solid var(--accent)' : '2px solid transparent',
          outlineOffset: 2,
        }}
      />
      {onDelete && (
        <button
          title="Удалить"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          style={{
            position: 'absolute', top: -6, right: -6, width: 16, height: 16, padding: 0,
            borderRadius: RADIUS.pill, border: 'none', cursor: 'default',
            background: 'transparent', color: 'var(--text-muted)',
            boxShadow: 'inset 0 0 0 1px var(--divider)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Trash2 size={10} />
        </button>
      )}
    </span>
  );
}

// Редактор своих быстрых ссылок: строки «название + адрес», добавление/удаление. Пустые строки
// (без адреса) вкладка просто не покажет, поэтому чистить их отдельно не нужно.

// Строка-тумблер внутри OptionList.
//
// ⚠️ Своей вёрстки у неё БОЛЬШЕ НЕТ: это OptionRow с тумблером в действиях. Прежний ToggleRow был
// голой парой «подпись слева, тумблер справа» без коробки и без разделителей — четыре такие
// строки подряд в «Часах» и были той самой «старой сборкой» посреди новой. Заливки выбранного у
// неё нет намеренно: включённый тумблер — это состояние, а заливка в разделе означает «выбрано».
function SwitchRow({ title, subtitle, checked, onChange }: {
  title: string; subtitle?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <OptionRow
      title={title}
      subtitle={subtitle}
      actions={<Toggle checked={checked} onChange={() => onChange(!checked)} />}
    />
  );
}

// Строка с ползунком. Живёт ВНУТРИ OptionList — группу держит рамка, соседние строки разделяет
// волосяная линия, как в OptionList.
//
// ⚠️ accentColor обязателен: без него Chromium рисует системно-синий ползунок независимо от
// палитры, и на «Мяте» он оказывался единственным синим элементом на экране — ровно та жалоба,
// из-за которой акцент вообще переехал в палитру (см. цветовой закон).
function SliderRow({ label, value, min, max, step, onChange, format }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; format: (v: number) => string;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: sp(3), padding: pad(3, 4) }}>
      <span style={{ flex: '0 0 120px', ...TEXT.body, fontWeight: 550, color: 'var(--text-strong)' }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, minWidth: 0, accentColor: 'var(--accent)', cursor: 'default' }} />
      <CapsLabel style={{ marginBottom: 0, flex: '0 0 46px', justifyContent: 'flex-end', fontVariantNumeric: 'tabular-nums' }}>
        {format(value)}
      </CapsLabel>
    </div>
  );
}
