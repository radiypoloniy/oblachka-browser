import { useState } from 'react';
import { Clock, Star } from 'lucide-react';
import { ModeButton } from './Hub';
import History from './History';
import Bookmarks from './Bookmarks';

type Section = 'history' | 'bookmarks';

interface Props {
  defaultSection: Section;
  onClose: () => void;
}

// Объединённая точка входа (сайдбар: одна иконка вместо двух) для Истории и Закладок.
// История/Bookmarks — каждая свой самодостаточный остров (свой header/close/shadow, свой SQLite,
// свои SQLite-запросы) — НЕ трогаем ни то, ни другое, просто переключаем, какой из двух показан.
// Переключатель сверху — та же капсула, что у «Обзор/AI» в Hub.tsx (ModeButton оттуда экспортирован
// и переиспользован, не переизобретён). Секция — локальный React-стейт: createSpecialTab() всегда
// создаёт новую вкладку (не переиспользует существующую), так что при каждом открытии это заведомо
// свежий инстанс — «пережить рестарт» не про что.
export default function HistoryBookmarks({ defaultSection, onClose }: Props) {
  const [section, setSection] = useState<Section>(defaultSection);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        display: 'inline-flex', flex: 'none', alignSelf: 'center', padding: 3, gap: 2,
        background: 'var(--surface-sunken)', borderRadius: 'var(--radius-pill)',
        border: '1px solid var(--glass-edge)',
      }}>
        <ModeButton active={section === 'history'} onClick={() => setSection('history')} icon={<Clock size={14} />} label="История" />
        <ModeButton active={section === 'bookmarks'} onClick={() => setSection('bookmarks')} icon={<Star size={14} />} label="Закладки" />
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {section === 'history' ? <History onClose={onClose} /> : <Bookmarks onClose={onClose} />}
      </div>
    </div>
  );
}
