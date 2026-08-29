import type { CSSProperties } from 'react'
import { grain } from '../../styles/system'
import { AppGlyph, hasGlyph } from '../appGlyphs'
import type { AppDef } from './types'

// ── Домашний экран: виджеты + сетка иконок ───────────────────────────────────────────────────
// labelTone: чем красить подписи иконок.
// ⚠️ Раньше решение принималось по факту «обои есть» — и белая подпись ложилась в том числе на
// Горчицу, Лайм, Небо, Персик, Жемчуг и три Бумаги, где её не прочитать. Светлоту объявляет сам
// пресет (флаг light в WALLPAPER_PRESETS), панель просто перестала это игнорировать; живой
// градиент и своя картинка светлоты не объявляют — там остаётся белая с тенью.
// Иконка приложения: lucide-глиф либо первая буква названия (пользовательские веб-приложения).
// Плитки приложений.
//
// ⚠️ Форма — SQUIRCLE (суперэллипс), а не border-radius. Это не придирка: у Apple иконки
// строятся по суперэллипсу, где кривизна нарастает плавно, а обычное скругление даёт прямые
// участки сторон и заметный «стык» с дугой. Именно этот силуэт первым выдаёт самоделку, даже
// когда цвет и глиф подобраны верно. Задаётся маской с data-URI: id-шный clipPath работал бы
// только в своём документе, а плитки живут в двух разных (чром и AI-панель).
const SQUIRCLE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' preserveAspectRatio='none'%3E%3Cpath d='M50 0C77.6 0 88.8 3.4 94.2 11.8C98.4 18.4 100 27.4 100 50C100 72.6 98.4 81.6 94.2 88.2C88.8 96.6 77.6 100 50 100C22.4 100 11.2 96.6 5.8 88.2C1.6 81.6 0 72.6 0 50C0 27.4 1.6 18.4 5.8 11.8C11.2 3.4 22.4 0 50 0Z' fill='%23000'/%3E%3C/svg%3E"

// ⚠️ Глиф рисуется CSS-МАСКОЙ, а не <img>: файлы Phosphor чёрные, а на цветной плитке нужен
// белый силуэт. Маска красит его заливкой родителя и не требует ни правки самих SVG, ни
// filter-хаков вроде invert. Если файла нет (пользовательское веб-приложение) — остаётся
// прежняя буквенная подпись.
// Свои составные глифы (см. src/components/appGlyphs.tsx) — они рисуют сам предмет, а не его
// силуэт. Маски Phosphor остались только запасным путём для приложений без своего глифа.
const PHOSPHOR_APPS = new Set(['calc', 'convert', 'timer', 'color', 'kitten', 'counter'])

// Краска глифа там, где светлая не годится. ⚠️ Ходит ПАРОЙ к плитке, как и везде в системе:
// на горчице, небе и бумаге белый силуэт даёт меньше 3:1 — то же правило, что у fillInk на
// плитках стола и у краски погоды.
const GLYPH_TINT: Record<string, string> = {
  counter: 'var(--appicon-glyph-dark)',
  kitten: 'var(--appicon-glyph-dark)',
  webcustom: 'var(--appicon-glyph-dark)',
  // Бумажная плитка: цвет целиком берёт на себя глиф. Страсть из плакатного набора —
  // фиолетового в системе нет, см. --tile-* в colors.css.
  color: 'var(--poster-passion)',
  // ⚠️ «Пояса» — плитка ТЁМНАЯ, а не светлая, но глиф на ней всё равно цветной: янтарное
  // солнце на ночном небе. Единственная такая пара в наборе, ради неё PAPER_TILES ниже
  // перечисляется руками, а не выводится из ключей этой таблицы.
  zones: '#F5B544',   // тёплый янтарь
}

// БУМАЖНЫМ плиткам нужна собственная кромка: на светлых обоях они иначе сливаются с фоном.
// ⚠️ Список явный, а не производный от GLYPH_TINT: тёмный глиф есть и у горчицы с небом, но
// кромка им не нужна — они сами по себе краска.
const PAPER_TILES = new Set(['color', 'webcustom'])

export function AppIconBadge({ app, size, radius, iconSize, shadow }: {
  app: AppDef
  size: number
  /** Оставлен для совместимости с вызовами; форму задаёт squircle-маска, а не радиус. */
  radius?: number | string
  iconSize: number
  shadow?: boolean
}) {
  void radius
  const Icon = app.icon
  const maskFile = PHOSPHOR_APPS.has(app.id) ? app.id : app.kind === 'web' ? 'web' : null
  const glyphColor = GLYPH_TINT[app.id] ?? 'var(--appicon-glyph)'
  const paper = PAPER_TILES.has(app.id)
  const squircle: CSSProperties = {
    WebkitMaskImage: `url("${SQUIRCLE}")`,
    maskImage: `url("${SQUIRCLE}")`,
    WebkitMaskSize: '100% 100%',
    maskSize: '100% 100%',
    WebkitMaskRepeat: 'no-repeat',
    maskRepeat: 'no-repeat',
  }

  return (
    // Внешняя обёртка несёт ТЕНЬ: тень от элемента с маской обрезается вместе с ним, поэтому
    // отбрасывать её должен слой снаружи маски (drop-shadow, а не box-shadow — он повторяет
    // форму суперэллипса, а не прямоугольника).
    <span style={{
      display: 'inline-flex', width: size, height: size, flexShrink: 0, position: 'relative',
      filter: shadow ? 'drop-shadow(0 2px 5px rgba(12,14,24,0.22))' : undefined,
    }}>
      <span style={{
        ...squircle,
        position: 'relative', width: size, height: size,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: app.gradient,
        // Кромка ВНУТРЕННЕЙ тенью, а не border: border лёг бы поверх маски прямоугольником.
        boxShadow: paper ? 'inset 0 0 0 1px rgba(20,20,15,0.12)' : undefined,
      }}>
        {/* ⚠️ Слоёв света здесь БОЛЬШЕ НЕТ. Их было три (радиальная засветка сверху-слева,
            светлая кромка по верху, затемнение к низу) — язык иконок iOS, который и читался как
            «переливы». Материал теперь даёт ЗЕРНО: тот же рецепт, что на плитках стола и на
            земле окна, — плоская краска плюс фактура, а не имитация освещения. */}
        <span aria-hidden style={{ ...grain, borderRadius: 'inherit' }} />

        {hasGlyph(app.id) || (app.kind === 'web' && hasGlyph('web')) ? (
          <span style={{ position: 'relative', display: 'inline-flex' }}>
            <AppGlyph id={hasGlyph(app.id) ? app.id : 'web'} size={iconSize} color={glyphColor} />
          </span>
        ) : maskFile ? (
          <span style={{
            width: iconSize, height: iconSize, position: 'relative',
            background: glyphColor,
            WebkitMaskImage: `url("./appicons/${maskFile}.svg")`,
            maskImage: `url("./appicons/${maskFile}.svg")`,
            WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
            WebkitMaskPosition: 'center', maskPosition: 'center',
            WebkitMaskSize: 'contain', maskSize: 'contain',
          }} />
        ) : Icon !== null ? (
          <Icon size={iconSize} strokeWidth={2.4} style={{ color: glyphColor, position: 'relative' }} />
        ) : (
          <span style={{
            fontSize: Math.round(iconSize * 0.82), fontWeight: 600, lineHeight: 1,
            color: glyphColor, position: 'relative',
          }}>
            {app.label.charAt(0).toUpperCase()}
          </span>
        )}
      </span>
    </span>
  )
}


// Столбцов в сетке иконок. Держится рядом с самой сеткой: по нему же ходят стрелки вверх/вниз,
// и разъехавшись, они бы прыгали через ряд.
