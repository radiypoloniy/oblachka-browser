import { useState } from 'react';
import { Clock, Star, Download, Search, TrendingDown } from 'lucide-react';
import { ModeButton } from './Hub';
import { sp, panelRoom } from '../styles/system';
import History from './History';
import Bookmarks from './Bookmarks';
import Downloads from './Downloads';
import StuffSearchView from './StuffSearchView';
import Tracking from './Tracking';
import type { DownloadEntry } from '../../shared/ipc';

type Section = 'history' | 'bookmarks' | 'downloads' | 'search' | 'tracking';

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
      {/* ⚠️ ДВЕ капсулы, а не одна. «Везде» — это не пятый архив, а поиск ПО ВСЕМ трём сразу, и
          стоять в одном ряду с ними он не должен: человек читает ряд как «выбери один из
          пяти», хотя выбор здесь другого рода. Тот же приём, что в iOS 26, где поиск вынесен
          отдельной капсулой рядом с сегментами. */}
      <div style={{ flex: 'none', width: '100%', display: 'flex', justifyContent: 'center', gap: sp(2) }}>
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
          {/* «Куда я это дел» (AI-IDEAS.md №4) — четвёртым режимом здесь, а не отдельным экраном:
              вопрос «где я это видел» тот же самый, просто человек не помнит, в каком из трёх
              архивов лежит ответ. Разводить его с ними по разным местам значило бы требовать
              знать ответ заранее — ровно то, от чего фича и избавляет. */}
          {/* Отслеживание — сюда же (PRICE-TRACKING.md): это тот же архив «мои данные», и свой
              вид вкладки ради него не заводится, чтобы не менять формат session.json. */}
          <ModeButton active={section === 'tracking'} onClick={() => setSection('tracking')} icon={<TrendingDown size={14} />} label="Отслеживание" />
        </div>

        {/* Поиск по всем архивам — своя капсула. */}
        <div style={{
          display: 'inline-flex', padding: 3,
          background: 'var(--surface-sunken)', borderRadius: 'var(--radius-pill)',
          border: '1px solid var(--glass-edge)',
        }}>
          <ModeButton active={section === 'search'} onClick={() => setSection('search')} icon={<Search size={14} />} label="Везде" />
        </div>
      </div>
      {/* ⚠️ ПОЛЕ ПОД ТЕНЬ. Родитель выше режет по горизонтали (overflow-x: hidden — защита от
          длинных URL, см. комментарий там же), и панель, занимавшая всю его ширину, теряла тень
          по бокам: оставался только скруглённый угол. У настроек этой беды не было просто потому,
          что там панель лежит в родителе с полем 12 px и overflow: visible — рецепт был один, а
          окружение разное. Поле берём из системы (panelRoom), чтобы «дать тени место» было
          решением системы, а не находкой в каждом экране. */}
      <div style={{ flex: 1, minWidth: 0, minHeight: 0, ...panelRoom, paddingTop: 0 }}>
        {section === 'history' ? <History onClose={onClose} />
          : section === 'bookmarks' ? <Bookmarks onClose={onClose} />
          : section === 'search' ? <StuffSearchView onClose={onClose} />
          : section === 'tracking' ? <Tracking />
          : <Downloads downloads={downloads} onClose={onClose} />}
      </div>
    </div>
  );
}
