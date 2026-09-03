import { useCallback, useState } from 'react';
import { Clock, Star, Download, TrendingDown, Plug } from 'lucide-react';
import { RADIUS, TEXT, motion, pad, sp } from '../styles/system';
import History from './History';
import Bookmarks from './Bookmarks';
import Downloads from './Downloads';
import StuffSearchView from './StuffSearchView';
import Tracking from './Tracking';
import Agents from './Agents';
import LibraryShell from './library/LibraryShell';
import type { LibrarySummary, LibraryTone } from './library/kit';
import type { DownloadEntry } from '../../shared/ipc';

type Section = 'history' | 'bookmarks' | 'downloads' | 'search' | 'tracking' | 'agents';

interface Props {
  defaultSection: Section;
  // Список загрузок держит App.tsx (он подписан на DOWNLOADS_CHANGED для точки на кнопке тулбара) —
  // сюда приходит готовым, как и всё остальное в src/components: компоненты только рисуют.
  downloads: DownloadEntry[];
  onClose: () => void;
}

// БИБЛИОТЕКА — объединённая точка входа: История, Закладки, Загрузки, Отслеживание и поиск
// сразу по всем трём архивам.
//
// ⚠️ Состав разделов НЕ меняется и менять его не надо: человек приходит с одним вопросом «где я
// это видел», и разводить ответы по разным экранам значило бы требовать знать ответ заранее.
// Поиск «Везде» отдельно от четвёрки — тоже верно: это не пятый архив, а способ искать.
//
// ⚠️ ЧТО ИЗМЕНИЛОСЬ. Раньше каждый из пяти разделов был самостоятельным островом со своей
// шапкой, своим заголовком (История ролью TEXT.title, Отслеживание своим fs-lg/700, у поиска
// заголовка не было вовсе), своим полем поиска и своей кнопкой «закрыть». Переход между
// разделами читался как переход между приложениями. Теперь оболочка одна (LibraryShell), а
// разделы отдают ей только СВОДКУ и содержимое.
//
// ⚠️ ТОН ЗАКРЕПЛЁН ЗА РАЗДЕЛОМ навсегда — тот же приём, что SECTION_TONE в настройках. Смысл в
// узнаваемости: после третьего открытия раздел находят по цвету, не читая.
const TONE: Record<Section, LibraryTone> = {
  history: 'sky',
  bookmarks: 'mustard',
  downloads: 'tea',
  tracking: 'tangerine',
  // ⚠️ Агентам достаётся ЧАЙ, а не свой пятый тон: у библиотеки их всего пять, и заводить шестой
  // ради раздела, куда заходят реже всех, значило бы размыть узнавание остальных.
  agents: 'tea',
  // Лайм закреплён за ПОИСКОМ: он не архив, и цвета архива у него быть не должно.
  search: 'lime',
};

const TITLE: Record<Section, string> = {
  history: 'История',
  bookmarks: 'Закладки',
  downloads: 'Загрузки',
  tracking: 'Отслеживание',
  agents: 'Агенты',
  search: 'Поиск везде',
};

const PLACEHOLDER: Record<Section, string> = {
  history: 'Искать по истории…',
  bookmarks: 'Искать по закладкам…',
  downloads: 'Искать по загрузкам…',
  tracking: 'Искать по товарам…',
  agents: 'Искать по обращениям…',
  search: 'Один вопрос по истории, закладкам и загрузкам — Enter',
};

const RAIL: { id: Exclude<Section, 'search'>; label: string; icon: JSX.Element }[] = [
  { id: 'history', label: 'История', icon: <Clock size={14} /> },
  { id: 'bookmarks', label: 'Закладки', icon: <Star size={14} /> },
  { id: 'downloads', label: 'Загрузки', icon: <Download size={14} /> },
  { id: 'tracking', label: 'Отслеживание', icon: <TrendingDown size={14} /> },
  // ⚠️ «Кто приходил и что делал» — это библиотека, а не настройки: там отвечают на вопрос
  // «включено ли и как подключиться», здесь — показывают накопленное (см. Agents.tsx).
  { id: 'agents', label: 'Агенты', icon: <Plug size={14} /> },
];

export default function HistoryBookmarks({ defaultSection, downloads, onClose }: Props) {
  const [section, setSection] = useState<Section>(defaultSection === 'search' ? 'history' : defaultSection);
  const [everywhere, setEverywhere] = useState(defaultSection === 'search');
  const [query, setQuery] = useState('');
  // Поиск «Везде» ходит к модели и работает по Enter — токен и есть сигнал «ищи сейчас».
  const [runToken, setRunToken] = useState(0);
  // Сводка приходит СНИЗУ: числа знает раздел, а шапка — нет. Через эффект в разделе, а не
  // вызовом в его рендере: setState чужого компонента во время своего рендера React запрещает.
  const [summary, setSummary] = useState<LibrarySummary>({ hero: '—', heroLabel: '' });
  const onSummary = useCallback((s: LibrarySummary) => setSummary(s), []);

  const shown: Section = everywhere ? 'search' : section;

  const rail = (
    <div style={{
      display: 'inline-flex', padding: 3, gap: 2, flex: 'none',
      background: 'var(--surface)', borderRadius: RADIUS.pill,
      border: '1px solid var(--divider)',
    }}>
      {RAIL.map((item) => {
        const on = !everywhere && section === item.id;
        return (
          <button
            key={item.id}
            onClick={() => { setSection(item.id); setEverywhere(false); setQuery(''); }}
            style={{
              display: 'flex', alignItems: 'center', gap: sp(2), padding: pad(2, 3),
              border: 'none', borderRadius: RADIUS.pill, cursor: 'default',
              ...TEXT.caption, fontWeight: 650,
              background: on ? 'var(--surface-sunken)' : 'transparent',
              color: on ? 'var(--text-strong)' : 'var(--text-muted)',
              transition: motion.state('background', 'color'),
            }}
          >{item.icon}{item.label}</button>
        );
      })}
    </div>
  );

  return (
    // width/maxWidth/minWidth здесь — не декоративно: без них длинный необёрнутый контент внутри
    // разделов раздувает контейнер шире окна.
    //
    // ⚠️ ЗДЕСЬ НЕТ overflowX: 'hidden', и это ключ ко всей истории с «тенью, которой нет». По
    // спецификации CSS, если одна ось получает значение отличное от visible, ВТОРАЯ тоже
    // перестаёт быть visible и вычисляется как auto — то есть один overflowX молча превращал
    // контейнер в прокрутку по обеим осям, а прокрутка режет всё, включая тень острова.
    <div style={{
      height: '100%', width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box',
    }}>
      <LibraryShell
        tone={TONE[shown]}
        title={TITLE[shown]}
        summary={summary}
        query={query}
        onQuery={setQuery}
        searchPlaceholder={PLACEHOLDER[shown]}
        everywhere={everywhere}
        onEverywhere={(v) => { setEverywhere(v); if (v) setRunToken((t) => t + 1); }}
        onSubmit={() => { if (everywhere) setRunToken((t) => t + 1); }}
        rail={rail}
        onClose={onClose}
      >
        {shown === 'search' ? <StuffSearchView query={query} runToken={runToken} onSummary={onSummary} onClose={onClose} />
          : shown === 'history' ? <History query={query} onSummary={onSummary} />
            : shown === 'bookmarks' ? <Bookmarks query={query} onSummary={onSummary} />
              : shown === 'tracking' ? <Tracking query={query} onSummary={onSummary} />
                : shown === 'agents' ? <Agents query={query} onSummary={onSummary} />
                : <Downloads downloads={downloads} query={query} onSummary={onSummary} />}
      </LibraryShell>
    </div>
  );
}
