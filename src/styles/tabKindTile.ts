import { Clock, Star, Settings, Download, type LucideIcon } from 'lucide-react';
import type { TabState } from '../../shared/ipc';

// Единый маппинг kind → цветная плитка для псевдо-вкладок (История/Закладки/Настройки) в
// FaviconTile (Sidebar.tsx) — раньше эти вкладки попадали в ветку «нет favicon → буква домена»
// и падали в new URL('') на пустом url псевдо-вкладки (см. TabState.kind в shared/ipc.ts), давая
// «?». 'hub' сюда намеренно не входит — у него уже своя ветка (Cloud + accent-фон) в FaviconTile,
// не трогаем, чтобы не расширять дифф; по-хорошему потом свести и её сюда же.
//
// Цвет — только var(--accent): отдельного «системного синего» токена в текущей дизайн-системе
// нет (--system упразднён вместе с ролью облако/система, см. colors.css:12-17, «раньше
// фиолетовый держал отдельную роль... в новой системе такой роли нет вообще»). History и
// Bookmarks оба на accent — тот же токен, что уже красит Cloud-иконку хаба; различаются глифом,
// не цветом. Settings — нейтральный var(--neutral-300), тот же серый, что и буква-фолбэк
// favicon чуть ниже в этом же компоненте (визуальная согласованность плиток одного семейства).
// Цвет здесь — опознавательный знак, а не состояние: плитки различаются им так же, как
// значки разделов в iOS. Токены живут в colors.css (--tile-*), в компонентах не хардкодятся.
export const TAB_KIND_TILE: Partial<Record<TabState['kind'], { Icon: LucideIcon; color: string }>> = {
  history:   { Icon: Clock,    color: 'var(--tile-orange)' },
  bookmarks: { Icon: Star,     color: 'var(--tile-pink)' },
  settings:  { Icon: Settings, color: 'var(--tile-grey)' },
  downloads: { Icon: Download, color: 'var(--tile-teal)' },
};
