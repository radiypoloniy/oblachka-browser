import { useEffect, useState } from 'react';
import { useOnboarding } from './onboarding/useOnboarding';
import type React from 'react';
import {
  Loader2, ArrowRight, ArrowLeft,
} from 'lucide-react';
import type {
  ThemeMode, ThemePaletteId, ThemePrefs,
} from '../../shared/ipc';
import { isDarkTheme } from '../../shared/ipc';
import { islandPlate, untintedPlateVars } from '../styles/island';
import { btnPrimary } from './settings/kit';
import { Progress, gb, bigGhost } from './onboarding/parts';
import { ImportStep } from './onboarding/ImportStep';
import { IndexStep, ModelStep } from './onboarding/steps';
import { CAPS, RADIUS, TEXT, DISPLAY, grain, sp } from '../styles/system';

// Экран первого запуска: короткий рассказ о том, чем этот браузер отличается, и перенос данных
// из привычного браузера последним шагом.
//
// Почему рассказ идёт ПЕРЕД переносом: перенос — просьба к человеку, который ещё не понял, зачем
// ему эта программа. Сначала показываем, что он получит, потом просим доступ к его данным.
//
// ⚠️ Экран живёт в чроме (React), а не в своей вью, и это осознанно: на первом запуске активен
// хаб, страницы под ним нет, и нативной вью, которая перекрыла бы разметку, тоже нет. Как только
// человек закроет онбординг, всё вернётся к обычной жизни.

interface Props {
  onFinish: () => void;
}

// ⚠️ Эмодзи в заголовках больше нет. Они были единственной типографикой экрана, которую рисуем
// не мы: системный глиф со своей палитрой рядом с нашим набором читается наклейкой, а на первом
// экране это первое впечатление. Роль «о чём слайд» теперь целиком на иллюстрации.
// ── Иллюстрации ───────────────────────────────────────────────────────────────
// Рисуем разметкой, а не картинками: интерфейс здесь и есть предмет разговора, а нарисованный
// теми же токенами он совпадает с тем, что человек увидит через минуту.








// ── Схема окна для последнего шага ────────────────────────────────────────────
//
// ⚠️ РИСУНОК, А НЕ СКРИНШОТ, и это не лень: снимок протухнет на первом же редизайне и начнёт
// врать про собственный интерфейс. Схема собрана теми же токенами, что и настоящее окно, поэтому
// стареет вместе с ним.
//
// ⚠️ ПОЛОЖЕНИЕ СВЕРЕНО С КОДОМ, а не нарисовано по памяти — в первом макете подсветки стояли не
// там, и это делало схему хуже, чем её отсутствие:
//   • ЩИТ — внутри омнибокса, у его ЛЕВОГО края (Toolbar.tsx: значок замка перед полем ввода);
//   • ИИ — кнопка в ПРАВОМ кластере тулбара, открывает панель у правого края окна
//     (Toolbar.tsx::onToggleAiPanel, панель — AiPanelManager);
//   • ПРИЛОЖЕНИЯ — плитки на самом рабочем столе новой вкладки, в середине области контента
//     (DesktopScreen.tsx);
//   • НАСТРОЙКИ — в ПОДВАЛЕ сайдбара, рядом с «Новой вкладкой» и «Историей»
//     (Sidebar.tsx::iconBtn, onSettings).
// Координаты сверены с самой схемой ниже, а не подобраны на глаз:
//   полоса тулбара — top 0, height 44, padding 0 10, gap 6: кнопка сайдбара 18, навигация 46,
//   омнибокс тянется от x=86, правый кластер 42 у правого края;
//   сайдбар — left 10, top 50, bottom 10, width 96, подвал внизу;
//   область контента — left 116, top 50, плитки от x=126, y=60.
const MAP_SPOTS: { key: string; label: string; box: React.CSSProperties }[] = [
  // Щит стоит у ЛЕВОГО края омнибокса — там же, где замок в Toolbar.tsx.
  { key: 'shield',   label: 'Щит',        box: { left: 86,  top: 12,  width: 52,  height: 20 } },
  // ИИ — правый кластер тулбара; панель он открывает у правого края окна.
  { key: 'ai',       label: 'ИИ',         box: { right: 10, top: 12,  width: 42,  height: 20 } },
  // Приложения и виджеты — плитки на самом столе, в середине области контента.
  { key: 'apps',     label: 'Приложения', box: { left: 126, top: 58,  width: 150, height: 80 } },
  // Настройки — подвал сайдбара, рядом с «Новой вкладкой» и «Историей».
  { key: 'settings', label: 'Настройки',  box: { left: 14,  bottom: 13, width: 88, height: 18 } },
];

function WindowMap() {
  return (
    <div style={{
      position: 'relative', width: '100%', height: 300,
      borderRadius: RADIUS.content, border: '1px solid var(--divider)',
      background: 'var(--surface-sunken)', overflow: 'hidden',
    }}>
      {/* Полоса тулбара: слева кнопка сайдбара, затем навигация, омнибокс и правый кластер. */}
      <div style={{
        position: 'absolute', left: 0, right: 0, top: 0, height: 44,
        display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px',
      }}>
        <span style={{ ...mapChip, width: 18 }} />
        <span style={{ ...mapChip, width: 46 }} />
        <span style={{ ...mapChip, flex: 1, background: 'var(--surface-solid)' }} />
        <span style={{ ...mapChip, width: 42 }} />
      </div>
      {/* Сайдбар: переключатель, сетка закреплённых, список вкладок и подвал. */}
      <div style={{
        position: 'absolute', left: 10, top: 50, bottom: 10, width: 96,
        borderRadius: RADIUS.control, background: 'var(--surface)',
        display: 'flex', flexDirection: 'column', gap: 4, padding: 7,
      }}>
        <span style={{ ...mapChip, height: 12 }} />
        <span style={{ ...mapChip, height: 20 }} />
        {[0, 1, 2, 3].map((i) => (
          <span key={i} style={{
            ...mapChip, height: 10,
            background: i === 0 ? 'color-mix(in srgb, var(--accent) 28%, transparent)' : undefined,
          }} />
        ))}
        <span style={{ flex: 1 }} />
        <span style={{ ...mapChip, height: 12 }} />
      </div>
      {/* Область контента: рабочий стол с плитками. */}
      <div style={{
        position: 'absolute', left: 116, right: 10, top: 50, bottom: 10,
        borderRadius: RADIUS.control, background: 'var(--surface)',
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, padding: 10,
        alignContent: 'start',
      }}>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
          <span key={i} style={{
            height: i < 4 ? 34 : 24, borderRadius: RADIUS.control,
            background: 'var(--surface-sunken)',
          }} />
        ))}
      </div>

      {/* Подсветки. ⚠️ Грубые намеренно: схема говорит «примерно здесь», и обещать пиксель в
          пиксель она не имеет права — окно у каждого своей ширины. */}
      {MAP_SPOTS.map((s) => (
        <span key={s.key} style={{
          position: 'absolute', ...s.box,
          border: '2px solid var(--poster-tangerine)', borderRadius: RADIUS.control,
          background: 'color-mix(in srgb, var(--poster-tangerine) 12%, transparent)',
          pointerEvents: 'none',
        }}>
          <span style={{
            position: 'absolute', top: -9, left: 5, ...CAPS,
            background: 'var(--poster-tangerine)', color: 'var(--on-poster-dark)',
            padding: '1px 6px', borderRadius: RADIUS.tight, whiteSpace: 'nowrap',
          }}>{s.label}</span>
        </span>
      ))}
    </div>
  );
}

const mapChip: React.CSSProperties = {
  height: 20, borderRadius: RADIUS.tight, background: 'var(--surface-sunken)', flex: 'none',
};

// ⚠️ ЧЕТЫРЕХ СЛАЙДОВ РАССКАЗА БОЛЬШЕ НЕТ. Они шли ПЕРЕД переносом закладок — то есть перед тем,
// ради чего браузер и ставят, — и до дела долистывали не все. Содержание не выброшено, а
// перенесено туда, где оно к месту: про защиту и вкладки сказано на схеме окна последним шагом,
// про локальный ИИ — на шаге модели. Рассказывать отдельно то, что человек через минуту увидит
// сам, и значит сделать экраны, которые пролистывают.

/** Плакатный тон шага. ⚠️ Закреплён за шагом — тот же приём, что SECTION_TONE в настройках. */
type StepTone = 'sky' | 'tea' | 'mustard' | 'lime' | 'tangerine';

// Пара «цвет + краска» обязательна: на небе, горчице, лайме и мандарине контраст чернил выше 7:1,
// а белого ниже 3:1; на чае наоборот (см. colors.css).
const TONE_INK: Record<StepTone, string> = {
  sky: 'var(--on-poster-dark)',
  mustard: 'var(--on-poster-dark)',
  lime: 'var(--on-poster-dark)',
  tangerine: 'var(--on-poster-dark)',
  tea: 'var(--on-poster-light)',
};



// Шаги мастера. ⚠️ Список СОБИРАЕТСЯ, а не пронумерован константами: два последних шага
// условные — модель не предлагаем, если она уже стоит или не поедет на этом железе, а индексацию
// не предлагаем, если человек не переносил историю. Оба добавляются ПОСЛЕ текущей позиции
// (появиться они могут только на шаге переноса или раньше), поэтому пересборка списка никогда не
// сдвигает шаг под ногами.
export type StepKind = 'import' | 'model' | 'index' | 'look' | 'guide';

/**
 * Что показать в конце разговора — четыре места, ради которых стоит заглянуть в интерфейс.
 *
 * ⚠️ Ровно четыре и ни одним больше. Это не справка, а «куда смотреть в первую минуту»: список из
 * десяти пунктов на первом запуске не читают вовсе, а прочитанные четыре человек действительно
 * находит потом глазами. Всё остальное живёт в настройках и находится по ходу.
 */
/**
 * Четыре места, ради которых стоит заглянуть в интерфейс.
 *
 * ⚠️ Ровно четыре и ни одним больше. Это не справка, а «куда смотреть в первую минуту»: список
 * из десяти пунктов на первом запуске не читают вовсе.
 *
 * ⚠️ ПОДПИСИ КОРОТКИЕ — по одной фразе. Раньше здесь стояли абзацы, и вместе со схемой окна выше
 * шаг превращался в стену текста, которую надо прокручивать. Где эти места находятся, показывает
 * схема; подписи отвечают только на «что там».
 *
 * ⚠️ Значков нет: они дублировали бы подписи схемы и добавляли на экран чужую графику.
 */
const GUIDE: { title: string; text: string }[] = [
  { title: 'Щит',         text: 'VPN и блокировщик' },
  { title: 'ИИ',          text: 'Спросить о странице' },
  { title: 'Приложения',  text: 'Плитки и виджеты стола' },
  { title: 'Настройки',   text: 'Тема, палитра, обои' },
];


export default function Onboarding({ onFinish }: Props) {
  const o = useOnboarding();
  const {
    step, setStep, steps, kind, importStep, isLastStep,
    sources, selected, selectedId, checked, running, report, csvBusy, csvMsg,
    dl, backfill, indexAsked, modelOffer, modelDone,
    selectSource, toggleType, handleRun, handleCsvImport, handleDownload, handleIndex,
  } = o;

  // Шапка шага: тон, заголовок, подпись. ⚠️ Ровно одна точка на все виды шагов — раньше здесь
  // стоял тернарник «слайд или импорт», и любой третий вид шага уронил бы экран на слайде,
  // которого у него нет.
  //
  // ⚠️ `art` больше НЕ картинка сверху, а содержимое ПРАВОЙ половины: то, что на шаге делают.
  // Левая половина осталась плакатной и несёт только тон, заголовок и одну фразу.
  const head: { art: React.ReactNode; title: string; text: string } =
    kind === 'import' ? {
      art: null,
      title: 'Перенесём ваши данные?',
      text: 'Закладки, история и пароли переедут из привычного браузера. В нём ничего не изменится — данные только копируются.',
    } : kind === 'model' ? {
      art: null,
      title: modelOffer ? 'Скачать локальную модель?' : 'Про локальную модель',
      text: modelOffer
        ? 'Перевод, пересказ и поиск по смыслу работают прямо на вашем компьютере — для этого нужен один файл модели. Качается в фоне, пользоваться браузером можно сразу.'
        // ⚠️ «Не тянет» — честный ответ, а не повод предложить что-нибудь полегче: человек скачает
        // гигабайты и будет судить о браузере по результату, которого железо не вытянет.
        : 'На этом устройстве локальная модель не пойдёт — видеопамяти не хватит даже самой лёгкой. Всё остальное работает как обычно, без неё.',
    } : kind === 'guide' ? {
      art: <ArtGuide />,
      title: dl?.running ? 'Пока скачивается модель' : 'Напоследок — четыре места',
      text: dl?.running
        ? 'Загрузка идёт в фоне и переживёт этот экран — браузером можно пользоваться прямо сейчас. А пока покажем, где что лежит.'
        : 'Ничего настраивать не нужно, но эти четыре вещи стоит знать заранее — потом найдёте их глазами.',
    } : kind === 'index' ? {
      art: null,
      title: 'Подготовить историю к поиску?',
      text: 'Из другого браузера переехали адреса и заголовки. Чтобы искать по смыслу — «та статья про ипотеку», — страницы нужно один раз прочитать.',
    } : {
      art: <LookStep />,
      title: 'Как ему выглядеть?',
      text: 'Тему и палитру можно поменять когда угодно — раздел «Интерфейс» в настройках.',
    };

  // Тон и номер шага. ⚠️ Тон закреплён за ВИДОМ шага, а не за его номером: список собирается, и
  // при отсутствии модели «третий шаг» — это уже другой шаг, а цвет обязан остаться его.
  const TONE: Record<StepKind, StepTone> = {
    import: 'sky', model: 'tea', index: 'tangerine', look: 'mustard', guide: 'lime',
  };
  const tone = TONE[kind];
  const ink = TONE_INK[tone];

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 600,
      background: 'var(--scrim, rgba(0,0,0,0.4))',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      // Экран нельзя закрыть кликом мимо: это не диалог, а первый разговор — выход из него
      // есть, но осознанный («Пропустить»/«Начать»).
    }}>
      {/* ⚠️ ДВЕ ПОЛОВИНЫ, а не картинка над текстом. Слева плакатная плоскость со своим тоном на
          каждый шаг, справа — то, что на шаге ДЕЛАЮТ. До этого все восемь шагов выглядели
          одинаково: белая карточка, иллюстрация 260 px, заголовок и абзац по центру, — и
          отличить «рассказ» от «сделай выбор» можно было только прочитав.
          ⚠️ Кнопки, списки и галочки на цвете НЕ лежат: выбор — это работа, а не плакат. Цветная
          половина отвечает за «где я и о чём речь», правая — за «что нажать».
          ⚠️ Полноэкранным экран не делается: он висит поверх уже восстановленной сессии, и
          содержимое под ним прячется отдельным флагом (setChromeModal в ProfilePicker/App) — это
          разобранный живой баг, а не запас осторожности. */}
      <div style={{
        position: 'relative',
        // ⚠️ КРУПНО. Экран первого запуска не экономит место: он показывается один раз, и
        // впихивать в него побольше информации мелким кеглем — ровно то, из-за чего он и
        // читался «невзрачным». Лучше меньше слов и больше воздуха.
        width: 1040, maxWidth: 'calc(100vw - 64px)', height: 680, maxHeight: 'calc(100vh - 64px)',
        display: 'flex', overflow: 'hidden',
        ...islandPlate,
        borderRadius: 'var(--radius-island)',
        boxShadow: 'var(--shadow-island)',
        ...untintedPlateVars,
        background: 'var(--surface-solid)',
      }}>
        {/* «Пропустить» — в углу, а не в ряду кнопок: это выход из разговора, а не шаг в нём.
            Внизу тогда остаются только «Назад» и «Дальше», и ряд читается как одно движение. */}
        {/* ⚠️ «Пропустить» стоит на ПЛАКАТНОЙ половине, а не в правом углу карточки. Справа он
            налезал на содержимое шага — на схеме окна буквально перекрывал подсветку «ИИ». Слева
            воздуха вдоволь, и это по-прежнему выход из разговора, а не шаг в нём. */}
        <button
          onClick={onFinish}
          style={{
            position: 'absolute', top: sp(6), left: sp(8), zIndex: 2,
            border: 'none', background: 'transparent', cursor: 'default',
            color: ink, opacity: 0.6, ...TEXT.body, padding: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; }}
        >
          Пропустить
        </button>

        {/* ── Левая половина: тон, номер шага, заголовок, одна фраза ── */}
        <div key={`side-${step}`} style={{
          width: '38%', flex: 'none', position: 'relative', overflow: 'hidden',
          background: `var(--poster-${tone})`, color: ink,
          padding: `${sp(8)}px ${sp(8)}px ${sp(6)}px`,
          display: 'flex', flexDirection: 'column',
          animation: 'oblako-onb-rise var(--dur-slow) var(--ease-out)',
        }}>
          {/* Зерно — та же текстура, что на шапках настроек и библиотеки: она и отличает
              «напечатано» от «залито в макете». */}
          <div style={grain} />
          <span style={{ ...CAPS, color: 'inherit', opacity: 0.66, position: 'relative', marginTop: sp(6) }}>
            Шаг {step + 1} из {steps.length}
          </span>
          {/* ⚠️ Дисплейная гарнитура — онбординг один из трёх экранов, где она разрешена (см.
              CLAUDE.md): это «лицо» продукта, а не интерфейс. lineHeight поднят против её
              фирменного 1: на двух строках заголовка плотный интерлиньяж слипается. */}
          <div style={{
            ...DISPLAY, fontSize: 44, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.04,
            marginTop: sp(3), color: 'inherit', position: 'relative',
          }}>
            {head.title}
          </div>
          <div style={{
            // Кегль РОЛИ «section» (16), но обычным весом: это лид-абзац, а не заголовок.
            // Свой размер тут завести нельзя — шкала одна на продукт (см. typography-check).
            marginTop: sp(4), ...TEXT.section, fontWeight: 400, lineHeight: 1.6, opacity: 0.82,
            color: 'inherit', position: 'relative', maxWidth: '32ch',
          }}>
            {head.text}
          </div>
          <div style={{ marginTop: 'auto', display: 'flex', gap: 6, position: 'relative' }}>
            {steps.map((_, i) => (
              <span key={i} style={{
                width: i === step ? 28 : 9, height: 9, borderRadius: RADIUS.pill,
                background: 'currentColor', opacity: i === step ? 0.9 : 0.3,
                transition: 'width var(--dur-base) var(--ease-out), opacity var(--dur-base) var(--ease-standard)',
              }} />
            ))}
          </div>
        </div>

        {/* ── Правая половина: дело шага ── */}
        <div style={{
          flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column',
          padding: `${sp(8)}px ${sp(8)}px ${sp(6)}px`, overflowY: 'auto',
        }}>
        <div key={step} style={{ flex: 'none', animation: 'oblako-onb-rise var(--dur-slow) var(--ease-out)' }}>
          {head.art}
        </div>

        {/* Тело шага переноса. На слайдах пусто — рассказ не должен прокручиваться.
            ⚠️ flex+minHeight:0 обязательны: карточка с overflow:hidden и фиксированной maxHeight
            обрезала бы длинный отчёт (у Chrome-аккаунта это отчёт + блок CSV), а голый overflowY:auto
            без ограниченной высоты не прокручивается — тело просто вылезало за обрез, и кнопка
            «Выбрать CSV-файл» уходила под край. Теперь тело занимает место между шапкой и подвалом
            и прокручивается внутри себя. */}
        {importStep && (
          <ImportStep
            sources={sources} selected={selected} selectedId={selectedId}
            checked={checked} report={report} csvBusy={csvBusy} csvMsg={csvMsg}
            selectSource={selectSource} toggleType={toggleType}
            handleCsvImport={() => void handleCsvImport()}
          />
        )}

        {/* Тело шага модели.
            ⚠️ Карточка КРУПНАЯ и во всю ширину, потому что решение здесь дорогое: человек
            соглашается на многогигабайтную загрузку. Прежняя версия сообщала имя модели тем же
            кеглем, что и подпись под ним, а размер и требования прятала в серую строку через
            «·» — то есть ровно то, ради чего экран и существует, было самым мелким на нём. */}
        {kind === 'model' && modelOffer && <ModelStep modelOffer={modelOffer} dl={dl} modelDone={modelDone} />}

        {/* Тело шага индексации. */}
        {kind === 'index' && <IndexStep backfill={backfill} indexAsked={indexAsked} />}

        {/* ⚠️ Карточек с четырьмя местами здесь БОЛЬШЕ НЕТ. Они дублировали то же самое, что
            уже показано схемой окна выше: на экране одновременно стояли и схема с подписями, и
            сетка 2×2 с теми же четырьмя абзацами — из-за этого шаг превращался в кашу из текста
            и требовал прокрутки. Схема и есть ответ, повторять его словами не надо. */}

        {/* Ход загрузки — здесь же, а не на шаге модели: человек уже ушёл с него, а знать,
            что процесс идёт и переживёт закрытие экрана, ему по-прежнему нужно. */}
        {kind === 'guide' && dl?.running && (
          <div style={{ marginTop: sp(4) }}>
            <Progress
              done={dl.receivedBytes} total={dl.totalBytes}
              label={`Модель качается — ${gb(dl.receivedBytes)}${dl.totalBytes ? ` из ${gb(dl.totalBytes)}` : ''}`}
              hint="Можно закрывать этот экран: загрузка продолжится в фоне."
            />
          </div>
        )}

        {/* Подвал. ⚠️ Всё по ЦЕНТРУ, в колонку: точки слева и кнопка справа тянули взгляд к
            краям, хотя весь экран выстроен по центральной оси, — от этого он и читался
            перекошенным. Здесь одна ось, и она совпадает с осью текста. */}
        {/* ⚠️ Точек шага здесь БОЛЬШЕ НЕТ — они стоят на плакатной половине. Две одинаковые
            дорожки на одном экране читались как два разных счётчика. */}
        <div style={{
          marginTop: 'auto', paddingTop: sp(6), flex: 'none',
          display: 'flex', alignItems: 'center', gap: sp(3),
        }}>
          <span style={{ flex: 1 }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: sp(3) }}>
            {/* Назад. ⚠️ Прячем только там, где возвращаться некуда (первый шаг) или уже
                бессмысленно (перенос сделан): предлагать «назад» после отчёта значило бы
                звать повторить импорт. */}
            {step > 0 && !report && !running && (
              <button
                style={{ ...bigGhost, display: 'inline-flex', alignItems: 'center', gap: 7 }}
                onClick={() => setStep((s) => s - 1)}
              >
                <ArrowLeft size={16} /> Назад
              </button>
            )}
            {/* Тихий отказ от предложения этого шага. ⚠️ Ведёт ДАЛЬШЕ по мастеру, а не наружу:
                отказаться от переноса — не то же самое, что закончить разговор, а следом может
                идти предложение модели, которого человек ещё не видел. */}
            {((importStep && !report && sources && sources.length > 0)
              || (kind === 'model' && modelOffer && !dl?.running && !modelDone)
              || (kind === 'index' && !backfill?.running && !indexAsked)) && (
              <button style={bigGhost} onClick={() => (isLastStep ? onFinish() : setStep((s) => s + 1))}>
                Не сейчас
              </button>
            )}

            {importStep && sources && sources.length > 0 && !report ? (
              <button
                style={{ ...bigPrimary, opacity: (checked.size === 0 || running) ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: 8 }}
                onClick={() => void handleRun()}
              >
                {running && <Loader2 size={15} style={{ animation: 'oblako-spin 1s linear infinite' }} />}
                {running ? 'Переносим…' : 'Перенести'}
              </button>
            ) : kind === 'model' && modelOffer && !dl?.running && !modelDone ? (
              <button style={bigPrimary} onClick={() => handleDownload()}>Скачать модель</button>
            ) : kind === 'index' && !backfill?.running && !indexAsked ? (
              <button style={bigPrimary} onClick={() => handleIndex()}>Проиндексировать</button>
            ) : isLastStep ? (
              <button style={bigPrimary} onClick={onFinish}>Начать пользоваться</button>
            ) : (
              <button
                style={{ ...bigPrimary, display: 'inline-flex', alignItems: 'center', gap: 8 }}
                onClick={() => setStep((s) => s + 1)}
              >
                Дальше <ArrowRight size={16} />
              </button>
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

// Главная кнопка экрана крупнее обычной из kit.tsx: здесь она единственное действие на весь
// экран, и мелкая пилюля рядом с 26-пиксельным заголовком выглядела бы приставленной.
const bigPrimary: React.CSSProperties = {
  ...btnPrimary,
  padding: '11px 22px',
  fontSize: 'var(--fs-md)',
};

// Пара к ней: тихие кнопки того же роста, иначе ряд «Назад | Дальше» выглядит ступенькой.




/**
 * Схема окна для гайда.
 *
 * ⚠️ Схема обязана СОВПАДАТЬ С РЕАЛЬНЫМ ОКНОМ, иначе она вредна: человек ищет глазами то, что
 * увидел здесь, и не находит. Первая версия была абстрактным набором прямоугольников (полоса
 * вкладок слева во всю высоту, плитки по центру, значки где придётся) — «нагромождение», которое
 * ни на что не показывало. Здесь повторена настоящая раскладка Oblako:
 *   • верхняя полоса ВО ВСЮ ШИРИНУ: кнопка сайдбара, стрелки навигации, широкая пилюля адреса со
 *     ЩИТОМ внутри слева, справа кластер значков (последний — ИИ);
 *   • ниже слева сайдбар: пара «Вкладки | Закладки» сверху, список, кнопка «Новая вкладка» внизу;
 *   • справа сцена с плитками рабочего стола;
 *   • у правого края — полоса ИИ-панели.
 * Подсвечены ровно те три места, на которые показывают карточки под схемой; четвёртая карточка
 * (цвет) ведёт в настройки, и подсвечивать в окне ей нечего — врать точкой на схеме не будем.
 */
// Последний шаг: САМО ОКНО с подсветками, а не четыре строки со значками.
//
// ⚠️ Человек ищет эти места потом ГЛАЗАМИ, а не по памяти о списке. Список из четырёх абзацев
// он прочитает и забудет; схему — узнает, когда через минуту увидит настоящее окно.
// Последний шаг: САМО ОКНО с подсветками, а не список абзацев.
//
// ⚠️ Человек ищет эти места потом ГЛАЗАМИ, а не по памяти о тексте. Схема показывает ГДЕ,
// четыре подписи под ней — ЧТО, одной фразой. Раньше здесь одновременно стояли и схема, и сетка
// карточек с теми же четырьмя абзацами: шаг читался кашей и требовал прокрутки.
function ArtGuide() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(6) }}>
      <WindowMap />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: `${sp(4)}px ${sp(6)}px` }}>
        {GUIDE.map((g) => (
          <div key={g.title}>
            <div style={{ ...DISPLAY, fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text-strong)' }}>
              {g.title}
            </div>
            <div style={{ marginTop: sp(1), ...TEXT.body, color: 'var(--text-muted)' }}>{g.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Иллюстрация шага переноса: данные перетекают из чужого браузера в наш.
// ── Шаг «Облик»: тема и палитра ───────────────────────────────────────────────
//
// ⚠️ ЕДИНСТВЕННЫЙ ДОБАВЛЕННЫЙ ШАГ, и он заменяет собой четыре слайда рассказа. Причина не в
// красоте: тему и палитру человек всё равно выбирает в первые минуты, а узнать о них было
// неоткуда — он находил их в настройках сам, если находил.
//
// ⚠️ Выбор ПРИМЕНЯЕТСЯ СРАЗУ, а не запоминается «на потом»: тема живёт в main и красит всё окно,
// поэтому результат виден в ту же секунду прямо за карточкой. Отложенное применение здесь
// означало бы выбор вслепую.
//
// ⚠️ Образцы рисуются ТОЙ ЖЕ лестницей, что настоящий интерфейс (земля → остров → строка текста),
// и значения продублированы из palettes.css: прочитать переменные НЕ применённой сейчас палитры
// нельзя в принципе. Ровно тот же приём и тот же разбор, что в разделе «Интерфейс».
const LOOK_PALETTES: { id: ThemePaletteId; label: string; light: [string, string, string]; dark: [string, string, string] }[] = [
  { id: 'charcoal', label: 'Уголь',  light: ['#F2F2F7', '#FFFFFF', '#3C3C43'], dark: ['#121214', '#1C1C1E', '#EBEBF5'] },
  { id: 'graphite', label: 'Графит', light: ['#ECECEC', '#FFFFFF', '#3C3C43'], dark: ['#1E1E1E', '#2C2C2C', '#EBEBF5'] },
  { id: 'slate',    label: 'Сланец', light: ['#E5E9F0', '#FFFFFF', '#3B4252'], dark: ['#2E3440', '#3B4252', '#E5E9F0'] },
  { id: 'paper',    label: 'Бумага', light: ['#F1EDE4', '#FDFBF6', '#3A332A'], dark: ['#14120F', '#1C1917', '#E9E3D9'] },
  { id: 'mint',     label: 'Мята',   light: ['#E9F2EC', '#FFFFFF', '#2C3A31'], dark: ['#101613', '#18201B', '#DDE9E1'] },
  { id: 'sky',      label: 'Небо',   light: ['#E8EEFA', '#FFFFFF', '#2C3550'], dark: ['#0F1319', '#171C24', '#DEE5F0'] },
];

const LOOK_MODES: { id: ThemeMode; label: string }[] = [
  { id: 'light', label: 'Светлая' },
  { id: 'dark', label: 'Тёмная' },
  { id: 'system', label: 'Как в системе' },
];

function LookSwatch({ swatch }: { swatch: [string, string, string] }) {
  const [ground, surface, text] = swatch;
  return (
    <span style={{
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
      width: '100%', height: 46, borderRadius: RADIUS.box, background: ground,
      paddingBottom: 7, boxShadow: 'inset 0 0 0 1px var(--divider)', boxSizing: 'border-box',
    }}>
      <span style={{
        width: 46, height: 22, borderRadius: RADIUS.control, background: surface,
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3, padding: '0 6px',
        boxSizing: 'border-box',
      }}>
        <span style={{ height: 3, borderRadius: RADIUS.tight, background: text, opacity: 0.85 }} />
        <span style={{ height: 3, borderRadius: RADIUS.tight, background: text, opacity: 0.45, width: '65%' }} />
      </span>
    </span>
  );
}

function LookStep() {
  const [theme, setTheme] = useState<ThemePrefs>({ mode: 'light', palette: 'charcoal', systemDark: false });
  useEffect(() => {
    void window.oblako.getTheme().then(setTheme).catch(() => { /* останется дефолт */ });
    return window.oblako.onThemeChanged(setTheme);
  }, []);
  const apply = (mode: ThemeMode, palette: ThemePaletteId) => {
    setTheme((t) => ({ ...t, mode, palette }));   // сразу, не дожидаясь ответа: кнопка не должна залипать
    void window.oblako.setTheme(mode, palette);
  };
  const dark = isDarkTheme(theme);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(4) }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
        <span style={{ ...CAPS }}>Тема</span>
        <div style={{ display: 'flex', gap: sp(2) }}>
          {LOOK_MODES.map((m) => {
            const on = theme.mode === m.id;
            return (
              <button
                key={m.id}
                onClick={() => apply(m.id, theme.palette)}
                style={{
                  flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: sp(2),
                  padding: sp(2), borderRadius: RADIUS.box, cursor: 'default', textAlign: 'left',
                  border: on ? '2px solid var(--text-strong)' : '2px solid var(--divider)',
                  background: 'transparent', boxSizing: 'border-box',
                }}
              >
                {/* «Как в системе» показана РАЗРЕЗАННОЙ пополам: смысл варианта в том, что вид
                    меняется сам, и показывать только нынешнюю половину значило бы рисовать её
                    неотличимой от «Светлой». */}
                {m.id === 'system' ? (
                  <span style={{
                    display: 'flex', width: '100%', height: 46, borderRadius: RADIUS.box,
                    overflow: 'hidden', boxShadow: 'inset 0 0 0 1px var(--divider)',
                  }}>
                    <span style={{ width: '50%', background: '#F2F2F7' }} />
                    <span style={{ width: '50%', background: '#1C1C1E' }} />
                  </span>
                ) : (
                  <LookSwatch swatch={m.id === 'dark' ? LOOK_PALETTES[0].dark : LOOK_PALETTES[0].light} />
                )}
                <span style={{ ...TEXT.body, fontWeight: on ? 650 : 450, color: 'var(--text-strong)' }}>
                  {m.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
        <span style={{ ...CAPS }}>Палитра</span>
        <div style={{ display: 'flex', gap: sp(2), flexWrap: 'wrap' }}>
          {LOOK_PALETTES.map((pal) => {
            const on = theme.palette === pal.id;
            return (
              <button
                key={pal.id}
                title={pal.label}
                onClick={() => apply(theme.mode, pal.id)}
                style={{
                  width: 76, padding: 0, border: 'none', background: 'none', cursor: 'default',
                  display: 'flex', flexDirection: 'column', gap: sp(1), alignItems: 'center',
                }}
              >
                <span style={{
                  width: '100%', borderRadius: RADIUS.box, display: 'block',
                  outline: on ? '2px solid var(--text-strong)' : '2px solid transparent',
                  outlineOffset: 2,
                }}>
                  <LookSwatch swatch={dark ? pal.dark : pal.light} />
                </span>
                <span style={{ ...TEXT.caption, color: on ? 'var(--text-strong)' : 'var(--text-muted)' }}>
                  {pal.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

