import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { SectionHeader, Subsection, StatusCard, btnPrimary, FactGrid, Fact } from './kit';
import UpdatesBlock from './UpdatesBlock';
import BangsBlock from './BangsBlock';
import SearchChipsBlock from './SearchChipsBlock';
import DefaultSearchBlock from './DefaultSearchBlock';
import DefaultBrowserBlock from './DefaultBrowserBlock';
import DownloadsBlock from './DownloadsBlock';
import NeverSleepBlock from './NeverSleepBlock';
import { getSearchEngine, DEFAULT_SEARCH_ENGINE_ID } from '../../../shared/searchEngines';
import type { SearchEngineId } from '../../../shared/searchEngines';
import { subscribeDefaultSearchEngine } from '../../searchEngineSetting';
import { sp } from '../../styles/system';

interface GeneralSectionProps {
  onOpenImport: () => void;
}

export default function GeneralSection({ onOpenImport }: GeneralSectionProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(6) }}>
      <SectionHeader title="Браузер">
        Поиск из адресной строки, бэнги, загрузки и то, как браузер ведёт себя на этом компьютере.
      </SectionHeader>
      <BrowserOverview />

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

      {/* ⚠️ Импорт стоит третьим, а не последним. Это разовое дело, но самое раннее:
          человек, только поставивший браузер, идёт в настройки прежде всего за своими закладками
          и паролями. Ниже — то, что настраивают позже и реже. */}
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

      <Subsection
        title="Загрузки"
        description="Куда попадают скачанные файлы и о чём браузер спрашивает заранее."
      >
        <DownloadsBlock />
      </Subsection>

      <Subsection
        title="Выгрузка вкладок из памяти"
        description="Вкладки, которые давно не открывали, освобождают память и загружаются заново при возврате. Играющее видео, заполненные формы и закреплённые вкладки не трогаются. Сайты ниже не выгружаются никогда."
      >
        <NeverSleepBlock />
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
    </div>
  );
}

function BrowserOverview() {
  const [engineId, setEngineId] = useState<SearchEngineId>(DEFAULT_SEARCH_ENGINE_ID);
  const [isDefault, setIsDefault] = useState<boolean | null>(null);
  const [bangCount, setBangCount] = useState<{ user: number; builtin: number; imported: number } | null>(null);

  useEffect(() => {
    let mounted = true;
    void window.oblako.getSearchEngine().then((id) => { if (mounted) setEngineId(id); });
    void window.oblako.isDefaultBrowser().then((v) => { if (mounted) setIsDefault(v); });
    void window.oblako.listBangs().then((snap) => {
      if (mounted) setBangCount({ user: snap.user.length, builtin: snap.builtin.length, imported: snap.importedCount });
    });
    const offEngine = subscribeDefaultSearchEngine((id) => { if (mounted) setEngineId(id); });
    const onFocus = () => {
      void window.oblako.isDefaultBrowser().then((v) => { if (mounted) setIsDefault(v); });
      void window.oblako.listBangs().then((snap) => {
        if (mounted) setBangCount({ user: snap.user.length, builtin: snap.builtin.length, imported: snap.importedCount });
      });
    };
    window.addEventListener('focus', onFocus);
    return () => { mounted = false; offEngine(); window.removeEventListener('focus', onFocus); };
  }, []);

  const engineName = getSearchEngine(engineId).name;
  const bangsValue = bangCount
    ? (bangCount.user > 0 ? `${bangCount.builtin + bangCount.user}` : String(bangCount.builtin))
    : '—';

  return (
    <FactGrid>
      <Fact label="Поиск" hint="Из адресной строки, если это не адрес" value={engineName} active />
      <Fact
        label="Браузер по умолчанию"
        hint="Ссылки из других программ"
        value={isDefault === null ? '—' : isDefault ? 'Oblako' : 'Другой'}
        active={isDefault === true}
      />
      <Fact
        label="Бэнги"
        hint={bangCount && bangCount.imported > 0 ? `и набор DuckDuckGo: ${bangCount.imported}` : 'свои, встроенные, «!yt котики»'}
        value={bangsValue}
        active
      />
      <Fact label="Ctrl+E" hint="Поповер быстрого поиска" value="Цели" />
    </FactGrid>
  );
}
