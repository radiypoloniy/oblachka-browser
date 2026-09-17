import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { SectionHeader, Subsection, StatusCard, btnPrimary, FactGrid, Fact, Segmented } from './kit';
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
import { useLanguage } from '../../i18n';

interface GeneralSectionProps {
  onOpenImport: () => void;
}

export default function GeneralSection({ onOpenImport }: GeneralSectionProps) {
  const { language, setLanguage, t } = useLanguage();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(6) }}>
      <SectionHeader title={t('Браузер')}>
        {t('Поиск из адресной строки, бэнги, загрузки и то, как браузер ведёт себя на этом компьютере.')}
      </SectionHeader>
      <BrowserOverview />

      <Subsection
        title={t('Язык интерфейса')}
        description={t('Меняет язык браузера и ответы AI. Язык сайтов не трогает.')}
      >
        <Segmented
          value={language}
          options={[{ id: 'en', label: 'English' }, { id: 'ru', label: 'Русский' }]}
          onChange={(next) => { void setLanguage(next); }}
        />
      </Subsection>

      <Subsection
        blockId="Поиск по умолчанию"
        title={t('Поиск по умолчанию')}
        description={t('Куда уходит запрос из адресной строки, если это не адрес сайта.')}
      >
        <DefaultSearchBlock />
      </Subsection>

      <Subsection
        blockId="Браузер по умолчанию"
        title={t('Браузер по умолчанию')}
        description={t('Кто открывает ссылки из других программ — почты, мессенджеров, документов.')}
      >
        <DefaultBrowserBlock />
      </Subsection>

      {/* ⚠️ Импорт стоит третьим, а не последним. Это разовое дело, но самое раннее:
          человек, только поставивший браузер, идёт в настройки прежде всего за своими закладками
          и паролями. Ниже — то, что настраивают позже и реже. */}
      <Subsection
        blockId="Импорт данных"
        title={t('Импорт данных')}
        description={t('Перенос закладок, истории и сохранённых паролей из другого браузера на этом компьютере.')}
      >
        <StatusCard
          icon={<Download size={20} style={{ color: 'var(--text-muted)' }} />}
          title={t('Импорт из другого браузера')}
          subtitle={t('Chrome, Edge, Brave, Яндекс.Браузер, Opera, Vivaldi')}
          actions={
            <button style={btnPrimary} onClick={onOpenImport}>{t('Импортировать…')}</button>
          }
        />
      </Subsection>

      <Subsection
        blockId="Загрузки"
        title={t('Загрузки')}
        description={t('Куда попадают скачанные файлы и о чём браузер спрашивает заранее.')}
      >
        <DownloadsBlock />
      </Subsection>

      <Subsection
        blockId="Выгрузка вкладок из памяти"
        title={t('Выгрузка вкладок из памяти')}
        description={t('Вкладки, которые давно не открывали, освобождают память и загружаются заново при возврате. Играющее видео, заполненные формы и закреплённые вкладки не трогаются. Сайты ниже не выгружаются никогда.')}
      >
        <NeverSleepBlock />
      </Subsection>

      <Subsection
        blockId="Обновления"
        title={t('Обновления')}
        description={t('Браузер сам проверяет новую версию и спрашивает карточкой. Загрузка и установка — только по вашей команде.')}
      >
        <UpdatesBlock />
      </Subsection>

      <Subsection
        blockId="Бэнги адресной строки"
        title={t('Бэнги адресной строки')}
        description={t('Быстрый переход к поиску по конкретному сайту прямо из адресной строки.')}
      >
        <BangsBlock />
      </Subsection>

      <Subsection
        blockId="Цели быстрого поиска"
        title={t('Цели быстрого поиска')}
        description={t('Поповер Ctrl+E: куда уходит Enter по умолчанию и чем наполнять полосу целей рядом.')}
      >
        <SearchChipsBlock />
      </Subsection>
    </div>
  );
}

function BrowserOverview() {
  const { language, t } = useLanguage();
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
      <Fact label={t('Поиск')} hint={t('Из адресной строки, если это не адрес')} value={engineName} active />
      <Fact
        label={t('Браузер по умолчанию')}
        hint={t('Ссылки из других программ')}
        value={isDefault === null ? '—' : isDefault ? 'Oblako' : t('Другой')}
        active={isDefault === true}
      />
      <Fact
        label={t('Бэнги')}
        hint={bangCount && bangCount.imported > 0
          ? (language === 'en' ? `plus ${bangCount.imported} DuckDuckGo bangs` : `и набор DuckDuckGo: ${bangCount.imported}`)
          : t('свои, встроенные, «!yt котики»')}
        value={bangsValue}
        active
      />
      <Fact label="Ctrl+E" hint={t('Поповер быстрого поиска')} value={t('Цели')} />
    </FactGrid>
  );
}
