import { Download } from 'lucide-react';
import { SectionHeader, Subsection, StatusCard, btnPrimary } from './kit';
import UpdatesBlock from './UpdatesBlock';
import BangsBlock from './BangsBlock';
import SearchChipsBlock from './SearchChipsBlock';
import DefaultSearchBlock from './DefaultSearchBlock';
import DefaultBrowserBlock from './DefaultBrowserBlock';
import DownloadsBlock from './DownloadsBlock';

interface GeneralSectionProps {
  // Открыть диалог импорта — состояние живёт в App.tsx (модалка поверх всего chrome), сюда
  // приходит только команда, самого диалога секция не рисует (см. ImportDialog.tsx).
  onOpenImport: () => void;
}

// Раздел «Браузер» — общие настройки браузера: поиск по умолчанию, обновления, бэнги, цели
// быстрого поиска, импорт данных из другого браузера (закладки/история/пароли, см.
// electron/browserImport/). Дальше сюда же — поведение при старте и т.п.
export default function GeneralSection({ onOpenImport }: GeneralSectionProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SectionHeader title="Браузер">
        Общие настройки браузера.
      </SectionHeader>

      <Subsection
        title="Поиск по умолчанию"
        description="Куда уходит запрос из адресной строки, если это не адрес сайта."
      >
        <DefaultSearchBlock />
      </Subsection>

      <Subsection
        title="Браузер по умолчанию"
        description="Кто открывает ссылки из других программ — почты, мессенджеров, документов."
      >
        <DefaultBrowserBlock />
      </Subsection>

      <Subsection
        title="Загрузки"
        description="Куда попадают скачанные файлы и о чём браузер спрашивает заранее."
      >
        <DownloadsBlock />
      </Subsection>

      <Subsection
        title="Обновления"
        description="Браузер проверяет наличие новой версии при запуске. Загрузка и установка — только по вашей команде."
      >
        <UpdatesBlock />
      </Subsection>

      <Subsection
        title="Бэнги адресной строки"
        description="Быстрый переход к поиску по конкретному сайту прямо из адресной строки."
      >
        <BangsBlock />
      </Subsection>

      <Subsection
        title="Цели быстрого поиска"
        description="Поповер Ctrl+E: куда уходит Enter по умолчанию и чем наполнять полосу целей рядом."
      >
        <SearchChipsBlock />
      </Subsection>

      <Subsection
        title="Импорт данных"
        description="Перенос закладок, истории и сохранённых паролей из другого браузера на этом компьютере."
      >
        <StatusCard
          icon={<Download size={20} style={{ color: 'var(--text-muted)' }} />}
          title="Импорт из другого браузера"
          subtitle="Chrome, Edge, Brave, Яндекс.Браузер, Opera, Vivaldi"
          actions={
            <button style={btnPrimary} onClick={onOpenImport}>Импортировать…</button>
          }
        />
      </Subsection>
    </div>
  );
}
