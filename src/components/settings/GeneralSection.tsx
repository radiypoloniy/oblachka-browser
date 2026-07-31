import { Download } from 'lucide-react';
import { SectionHeader, Subsection, StatusCard, btnPrimary } from './kit';
import UpdatesBlock from './UpdatesBlock';
import BangsBlock from './BangsBlock';
import SearchChipsBlock from './SearchChipsBlock';

interface GeneralSectionProps {
  // Открыть диалог импорта — состояние живёт в App.tsx (модалка поверх всего chrome), сюда
  // приходит только команда, самого диалога секция не рисует (см. ImportDialog.tsx).
  onOpenImport: () => void;
}

// Раздел «Браузер» — общие настройки браузера. Пока единственный блок — импорт данных из другого
// браузера (закладки/история/пароли, см. electron/browserImport/). Дальше сюда переедут поисковик
// по умолчанию, поведение при старте и т.п.
export default function GeneralSection({ onOpenImport }: GeneralSectionProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SectionHeader title="Браузер">
        Общие настройки браузера.
      </SectionHeader>

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
        description="Что предлагать в полосе целей поповера Ctrl+E: подбирать по ходу работы или показывать закреплённый вами набор."
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
