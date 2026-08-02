import { useState } from 'react';
import { Clock, Star, Download } from 'lucide-react';
import { ModeButton } from './Hub';
import History from './History';
import Bookmarks from './Bookmarks';
import Downloads from './Downloads';
import type { DownloadEntry } from '../../shared/ipc';

type Section = 'history' | 'bookmarks' | 'downloads';

interface Props {
  defaultSection: Section;
  // Список загрузок держит App.tsx (он подписан на DOWNLOADS_CHANGED для точки на кнопке тулбара) —
  // сюда приходит готовым, как и всё остальное в src/components: компоненты только рисуют.
  downloads: DownloadEntry[];
  onClose: () => void;
}

// Объединённая точка входа (сайдбар: одна иконка вместо двух) для Истории и Закладок.
// История/Bookmarks — каждая свой самодостаточный остров (свой header/close/shadow, свой SQLite,
// свои SQLite-запросы) — НЕ трогаем ни то, ни другое, просто переключаем, какой из двух показан.
// Переключатель сверху — та же капсула, что у «Обзор/AI» в Hub.tsx (ModeButton оттуда экспортирован
// и переиспользован, не переизобретён). Секция — локальный React-стейт: createSpecialTab() всегда
// создаёт новую вкладку (не переиспользует существующую), так что при каждом открытии это заведомо
// свежий инстанс — «пережить рестарт» не про что.
export default function HistoryBookmarks({ defaultSection, downloads, onClose }: Props) {
  const [section, setSection] = useState<Section>(defaultSection);

  return (
    // width/maxWidth/overflowX здесь — не декоративно: без них длинный необёрнутый контент
    // внутри История/Закладки (заголовки, URL — свои overflow:hidden+ellipsis есть, но без
    // min-width:0 в цепочке flex-предков не срабатывают, см. фикс в History.tsx/Bookmarks.tsx)
    // раздувает ЭТОТ контейнер шире окна — переключатель ниже, центрируемый через свою
    // 100%-широкую строку, тогда уезжает вместе с ним.
    <div style={{
      height: '100%', width: '100%', maxWidth: '100%', boxSizing: 'border-box', overflowX: 'hidden',
      display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      {/* Отдельная строка над скроллом (не sticky — контент ниже скроллится сам, внутри своих
          островов, не эта строка). width:100% + justifyContent:center — центр ОКНА, не центр
          потенциально раздутого родителя (alignSelf:center на самой капсуле так не гарантирует). */}
      <div style={{ flex: 'none', width: '100%', display: 'flex', justifyContent: 'center' }}>
        <div style={{
          display: 'inline-flex', padding: 3, gap: 2,
          background: 'var(--surface-sunken)', borderRadius: 'var(--radius-pill)',
          border: '1px solid var(--glass-edge)',
        }}>
          <ModeButton active={section === 'history'} onClick={() => setSection('history')} icon={<Clock size={14} />} label="История" />
          <ModeButton active={section === 'bookmarks'} onClick={() => setSection('bookmarks')} icon={<Star size={14} />} label="Закладки" />
          {/* Загрузки — третьим сюда же, а не отдельной вкладкой: это такой же архив «что я уже
              видел/взял», и держать его в стороне от истории значило бы разводить по разным
              экранам вещи, за которыми человек приходит с одним и тем же вопросом. */}
          <ModeButton active={section === 'downloads'} onClick={() => setSection('downloads')} icon={<Download size={14} />} label="Загрузки" />
        </div>
      </div>
      <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
        {section === 'history' ? <History onClose={onClose} />
          : section === 'bookmarks' ? <Bookmarks onClose={onClose} />
          : <Downloads downloads={downloads} onClose={onClose} />}
      </div>
    </div>
  );
}
