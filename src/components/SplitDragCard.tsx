// Карточка, которую человек несёт в руке, перетаскивая половину сплита за шапку или вкладку из
// сайдбара: миниатюра самой страницы, а не подпись. Так жест читается как «я взял эту страницу и
// несу», а не как «система что-то там отслеживает».
//
// ⚠️ Компонент отдельным файлом, потому что рисуется в ДВУХ рендерерах: чром ведёт карточку над
// собой (src/App.tsx), оверлей — над областью контента (src/dropzones.tsx), где чром не виден в
// принципе. На границе они подменяют друг друга, и разъедься их вид — переход бросался бы в глаза.
//
// ⚠️ Почему миниатюра, а не сама вьюха. Уменьшить нативную вьюху на лету нельзя: смена размера
// заставляет страницу пересчитывать вёрстку на каждом кадре (тот же закон, что в
// TabManager.slideViews, где ради этого двигают только x). Снимок же — обычная картинка, её
// рендерер наклоняет и масштабирует бесплатно.
import { useEffect, useState } from 'react';
import { SPLIT_PANE_RADIUS } from '../../shared/layout';

// Ширина карточки в CSS-пикселях. Нужна обеим сторонам: карточку держат за верхний край по центру,
// то есть смещение под курсором считается от ширины.
export const SPLIT_DRAG_CARD_WIDTH = 240;
// Высоту режем: панель сплита узкая и высокая, и честная пропорция дала бы карточку в пол-экрана.
// Обрезаем снизу (objectPosition: top) — узнают страницу по её шапке, а не по подвалу.
const CARD_BODY_HEIGHT = 170;
// Снимок берём вдвое крупнее — на HiDPI карточка иначе выглядит замыленной. Обрезается он ТАМ ЖЕ,
// где делается (TabManager.capturePaneThumb): гонять через IPC то, чего не увидят, незачем.
export const SPLIT_DRAG_CARD_CAPTURE_WIDTH = SPLIT_DRAG_CARD_WIDTH * 2;
export const SPLIT_DRAG_CARD_CAPTURE_MAX_HEIGHT = CARD_BODY_HEIGHT * 2;

// Значок страницы в бланке. Своего favicon может не быть (или он ещё не пришёл) — тогда буква,
// как в сайдбаре. Полноценный FaviconTile сюда не годится: он требует целый TabState, а у оверлея
// его нет и быть не должно, ему через IPC уходит ровно то, что нужно нарисовать.
function CardIcon({ favicon, title }: { favicon: string | null; title: string }) {
  const size = 30;
  if (favicon) {
    return <img src={favicon} alt="" width={size} height={size} style={{ display: 'block', borderRadius: 6 }} />;
  }
  return (
    <span style={{
      width: size, height: size, borderRadius: 6, flex: 'none',
      background: 'var(--surface-sunken)', color: 'var(--text-muted)',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-medium)',
    }}>{(title.trim()[0] ?? '?').toUpperCase()}</span>
  );
}

export function SplitDragCard({ thumb, favicon, title, label, intro }: {
  // Снимок страницы (data-URL) или null. Пока его нет — бланк: рамка, значок и имя.
  thumb: string | null;
  favicon: string | null;
  title: string;
  // Что случится, если отпустить сейчас. null — курсор не над исходом, и карточка молчит: пустая
  // подсказка на каждом кадре превращается в шум.
  label: string | null;
  // Играть подъём при появлении. Только у той карточки, которая появляется в НАЧАЛЕ жеста —
  // почему именно так, см. .oblako-drag-card-in в src/styles/global.css.
  intro?: boolean;
}) {
  // ⚠️ Снимок проявляется ПОВЕРХ бланка, а не подменяет его. Геометрия карточки при этом ни на
  // пиксель не меняется — иначе в момент прихода снимка (первый жест за сессию, capturePage ждёт
  // кадр) карточка на глазах бы перестраивалась. Ждём именно onLoad, а не появления строки: у
  // data-URL декодирование тоже занимает кадр, и без этого первый кадр был бы пустым прямоугольником.
  const [shotShown, setShotShown] = useState(false);
  useEffect(() => { if (!thumb) setShotShown(false); }, [thumb]);

  return (
    <div className={intro ? 'oblako-drag-card oblako-drag-card-in' : 'oblako-drag-card'} style={{
      width: SPLIT_DRAG_CARD_WIDTH,
      borderRadius: SPLIT_PANE_RADIUS,
      background: 'var(--surface-solid)',
      border: '1px solid var(--divider)',
      boxShadow: 'var(--shadow-pop)',
      overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Бланк: то же окно, только пустое. Он же — единственное содержимое карточки для вкладки,
          которую вытянули из сайдбара: у неоткрытой страницы снимка нет и взять его негде. */}
      <div style={{
        height: CARD_BODY_HEIGHT,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 10, padding: '0 16px',
      }}>
        <CardIcon favicon={favicon} title={title} />
        <span style={{
          maxWidth: '100%', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{title}</span>
      </div>

      {thumb && (
        <img
          src={thumb}
          alt=""
          onLoad={() => setShotShown(true)}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover', objectPosition: 'top',
            opacity: shotShown ? 1 : 0,
            transition: 'opacity 140ms var(--ease-out)',
          }}
        />
      )}

      {label && (
        <div style={{
          position: 'absolute', left: 8, right: 8, bottom: 8,
          padding: '5px 10px', borderRadius: 'var(--radius-pill)',
          background: 'var(--accent)', color: 'var(--on-accent)',
          fontSize: 'var(--fs-xs)', fontWeight: 'var(--fw-medium)',
          textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{label}</div>
      )}
    </div>
  );
}
