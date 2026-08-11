// Карточка, которую человек несёт в руке, перетаскивая половину сплита за шапку: миниатюра самой
// страницы, а не подпись. Так жест читается как «я взял эту страницу и несу», а не как «система
// что-то там отслеживает».
//
// ⚠️ Компонент отдельным файлом, потому что рисуется в ДВУХ рендерерах: чром ведёт карточку над
// собой (src/App.tsx), оверлей — над областью контента (src/dropzones.tsx), где чром не виден в
// принципе. На границе они подменяют друг друга, и разъедься их вид — переход бросался бы в глаза.
//
// ⚠️ Почему миниатюра, а не сама вьюха. Уменьшить нативную вьюху на лету нельзя: смена размера
// заставляет страницу пересчитывать вёрстку на каждом кадре (тот же закон, что в
// TabManager.slideViews, где ради этого двигают только x). Снимок же — обычная картинка, её
// рендерер наклоняет и масштабирует бесплатно.
import { SPLIT_PANE_RADIUS } from '../../shared/layout';

// Ширина карточки в CSS-пикселях. Нужна обеим сторонам: карточку держат за верхний край по центру,
// то есть смещение под курсором считается от ширины.
export const SPLIT_DRAG_CARD_WIDTH = 240;
// Высоту режем: панель сплита узкая и высокая, и честная пропорция дала бы карточку в пол-экрана.
// Обрезаем снизу (objectPosition: top) — узнают страницу по её шапке, а не по подвалу.
const CARD_MAX_HEIGHT = 170;
// Снимок берём вдвое крупнее — на HiDPI карточка иначе выглядит замыленной. Обрезается он ТАМ ЖЕ,
// где делается (TabManager.capturePaneThumb): гонять через IPC то, чего не увидят, незачем.
export const SPLIT_DRAG_CARD_CAPTURE_WIDTH = SPLIT_DRAG_CARD_WIDTH * 2;
export const SPLIT_DRAG_CARD_CAPTURE_MAX_HEIGHT = CARD_MAX_HEIGHT * 2;

export function SplitDragCard({ thumb, title, label, intro }: {
  // Снимок страницы (data-URL) или null, пока capturePage не ответил — карточка тогда с подписью.
  thumb: string | null;
  title: string;
  // Что случится, если отпустить сейчас. null — курсор не над исходом, и карточка молчит: пустая
  // подсказка на каждом кадре превращается в шум.
  label: string | null;
  // Играть подъём при появлении. Только у той карточки, которая появляется в НАЧАЛЕ жеста —
  // почему именно так, см. .oblako-drag-card-in в src/styles/global.css.
  intro?: boolean;
}) {
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
      {thumb ? (
        <img
          src={thumb}
          alt=""
          style={{
            display: 'block', width: '100%', maxHeight: CARD_MAX_HEIGHT,
            objectFit: 'cover', objectPosition: 'top',
          }}
        />
      ) : (
        <div style={{
          padding: '7px 12px', fontSize: 'var(--fs-xs)', color: 'var(--text-body)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{label ?? title}</div>
      )}

      {thumb && label && (
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
