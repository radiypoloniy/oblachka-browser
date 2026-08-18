import { useEffect, useState } from 'react';
import { OptionList, OptionRow, InlineHint } from './kit';
import { SEARCH_ENGINES, DEFAULT_SEARCH_ENGINE_ID } from '../../../shared/searchEngines';
import type { SearchEngineId } from '../../../shared/searchEngines';
import { setDefaultSearchEngine, subscribeDefaultSearchEngine } from '../../searchEngineSetting';

// Блок «Поиск по умолчанию» раздела «Браузер». До него выбор жил ТОЛЬКО в капсуле омнибокса, и
// та видна лишь на новой вкладке — с обычной страницы сменить поисковик было негде.
// Секция только рисует: список движков — общий (shared/searchEngines.ts), хранение — в main.

// Зачем строка про каждый движок: выбор поисковика — это выбор, кому уходят запросы, и это
// стоит сказать прямо, а не оставлять человека угадывать по названию.
const ENGINE_NOTE: Record<SearchEngineId, string> = {
  duckduckgo: 'Не профилирует и не хранит историю запросов. Разумный выбор по умолчанию.',
  google: 'Самая полная выдача. Запросы и подсказки уходят в Google.',
  yandex: 'Сильнее в русскоязычной выдаче и местных сервисах. Запросы уходят в Яндекс.',
};

export default function DefaultSearchBlock() {
  const [engineId, setEngineId] = useState<SearchEngineId>(DEFAULT_SEARCH_ENGINE_ID);

  useEffect(() => {
    let mounted = true;
    void window.oblako.getSearchEngine().then((id) => { if (mounted) setEngineId(id); });
    // Тот же выбор меняется капсулой в омнибоксе — держим строку в актуальном состоянии.
    const off = subscribeDefaultSearchEngine((id) => { if (mounted) setEngineId(id); });
    return () => { mounted = false; off(); };
  }, []);

  const pick = (id: SearchEngineId) => {
    setEngineId(id); // оптимистично: настройка мелкая, ждать диска незачем (как в SearchChipsBlock)
    setDefaultSearchEngine(id);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <OptionList>
        {SEARCH_ENGINES.map((engine) => (
          <OptionRow
            key={engine.id}
            active={engine.id === engineId}
            onClick={() => pick(engine.id)}
            title={engine.name}
            subtitle={ENGINE_NOTE[engine.id]}
          />
        ))}
      </OptionList>

      <InlineHint>
        Сюда уходит всё, что не похоже на адрес: ввод в адресной строке, «Искать…» из
        контекстного меню и чип поисковика в поповере Ctrl+E. Отдельный сайт по-прежнему
        доступен без смены этой настройки — бэнгом «!ключ» в строке.
      </InlineHint>
    </div>
  );
}
