import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Search, X, Globe, Compass } from 'lucide-react';
import { OptionList, OptionRow, CapsLabel, InlineHint, TextField, Favicon, Panel, MonoChip,
  SpotCard, StatusCard, btnGhost,
} from './kit';
import { TEXT, pad, selected as selectedStyle, motion, sp } from '../../styles/system';
import type { SearchChipsConfig, SearchChipCandidate } from '../../../shared/ipc';
import { getSearchEngine, DEFAULT_SEARCH_ENGINE_ID } from '../../../shared/searchEngines';
import type { SearchEngineId } from '../../../shared/searchEngines';
import { subscribeDefaultSearchEngine } from '../../searchEngineSetting';

// Блок «Цели быстрого поиска» раздела «Браузер»: на какой цели открывается поповер Ctrl+E и чем
// наполнять полосу целей рядом. Только рисует то, что прислал main (см. CLAUDE.md) — сборка
// целей живёт в electron/SearchTargets.ts, хранилище выученных — в electron/SearchTargetStore.ts.
//
// Почему поиск, а не список: целей вместе с импортированным набором DuckDuckGo — тысячи, стеной
// чипов такое не показать (и раньше, до поиска, из импортированных нельзя было выбрать вообще
// ничего). Поэтому наружу из main только короткая выдача на запрос, а выбранное разрешается
// точечно по id — см. каналы SEARCH_CHIPS_SEARCH/SEARCH_CHIPS_RESOLVE.
//
// ⚠️ Вид строки цели переписан вместе с дизайн-системой 2.0. Живой отзыв: «очень мелкий и
// старомодный список сайтов». Причина была не в плотности, а в том, что строка несла ЧЕТЫРЕ
// равноправных куска текста подряд (имя, !ключ, источник, галочка) кеглем 13 и 11 — то есть
// читалась таблицей, а не списком мест, куда уйдёт запрос. Теперь имя и источник стоят
// лестницей, ключ — моночипом, значок сайта крупнее: строка узнаётся по логотипу, как в
// самом поповере Ctrl+E.

const SOURCE_LABEL: Record<SearchChipCandidate['source'], string> = {
  user: 'свой бэнг',
  learned: 'вы тут искали',
  builtin: 'встроенный',
  imported: 'из DuckDuckGo',
};

const SEARCH_DEBOUNCE = 150;

// Домен поисковика — чтобы у его строки был такой же favicon, как у остальных целей.
function engineHost(id: SearchEngineId): string {
  try { return new URL(getSearchEngine(id).buildUrl('q')).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// Строка цели в выдаче/выборе. Favicon тянется с самого сайта (см. kit → FaviconService),
// поэтому по десять строк за раз и с дебаунсом: список открыт — уже десять запросов.
function TargetRow({ candidate, selected, action, title, onClick }: {
  candidate: SearchChipCandidate;
  selected?: boolean;
  action?: React.ReactNode;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      title={title}
      style={{
        display: 'flex', alignItems: 'center', gap: sp(3), padding: pad(3, 4), cursor: 'default',
        // Заливка только у выбранного и только тоном раздела — общее правило (см. selected()).
        ...selectedStyle(selected === true),
        transition: motion.state('background'),
      }}
    >
      <Favicon host={candidate.host} size={26} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          ...TEXT.body, fontWeight: 650, color: 'var(--text-strong)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {candidate.name}
        </div>
        <div style={{ ...TEXT.caption, color: 'var(--text-muted)' }}>
          {SOURCE_LABEL[candidate.source]}
        </div>
      </div>
      {candidate.bangKey && <MonoChip>!{candidate.bangKey}</MonoChip>}
      {action}
      {selected && <Check size={16} style={{ flex: 'none', color: 'var(--accent)' }} />}
    </div>
  );
}

// Поиск по целям с короткой выдачей. Своё состояние строки держит сам — потребителю отдаёт
// только выбор; так один и тот же виджет обслуживает и цель по умолчанию, и закрепления.
function TargetSearch({ placeholder, isPicked, onPick }: {
  placeholder: string;
  isPicked: (id: string) => boolean;
  onPick: (c: SearchChipCandidate) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchChipCandidate[]>([]);
  // Ответы асинхронные и могут разъехаться с текущим вводом — применяем только последний
  // (тот же приём, что в поповере Ctrl+E).
  const seqRef = useRef(0);

  useEffect(() => {
    const seq = ++seqRef.current;
    const t = setTimeout(() => {
      void window.oblako.searchSearchChipCandidates(query).then((r) => {
        if (seq === seqRef.current) setResults(r);
      });
    }, SEARCH_DEBOUNCE);
    return () => clearTimeout(t);
  }, [query]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: sp(2) }}>
        <Search size={16} style={{ flex: 'none', color: 'var(--text-faint)' }} />
        <TextField value={query} onChange={setQuery} placeholder={placeholder} style={{ flex: 1 }} />
      </div>
      {/* Пустая выдача на пустой строке — это первый кадр до ответа main, а не «ничего нет»:
          подсказку показываем только когда человек реально что-то искал. */}
      {results.length === 0 && query.trim().length > 0 && (
        <InlineHint>
          Ничего не нашлось. Полный набор DuckDuckGo (~13 000 целей) подгружается кнопкой
          в «Бэнгах адресной строки» выше.
        </InlineHint>
      )}
      {/* ⚠️ Выдача — в рамке с волосяными разделителями, а не стопкой голых строк: без коробки
          десять строк подряд читались продолжением поля ввода, а не отдельным списком. */}
      {results.length > 0 && (
        <Panel>
          {results.map((c, i) => (
            <div key={c.id}>
              {i > 0 && <div style={{ height: 1, background: 'var(--divider)' }} />}
              <TargetRow candidate={c} selected={isPicked(c.id)} onClick={() => onPick(c)} />
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}

export default function SearchChipsBlock() {
  const [cfg, setCfg] = useState<SearchChipsConfig | null>(null);
  // Разрешённые карточки для выбранного: имя и домен цели по id знает только main.
  const [picked, setPicked] = useState<Map<string, SearchChipCandidate>>(new Map());
  // Имя поисковика — для строки «искать в <поисковике>»: сам движок выбирается в блоке «Поиск
  // по умолчанию» выше и может смениться, пока настройки открыты.
  const [engineId, setEngineId] = useState<SearchEngineId>(DEFAULT_SEARCH_ENGINE_ID);

  useEffect(() => {
    void window.oblako.getSearchChips().then(setCfg);
    void window.oblako.getSearchEngine().then(setEngineId);
    return subscribeDefaultSearchEngine(setEngineId);
  }, []);

  // Разрешаем ровно то, что выбрано (цель по умолчанию + закреплённые), и только когда состав
  // меняется — эти id и есть весь запрос, тысячи целей ради подписи двух строк не нужны.
  const ids = cfg ? [...(cfg.defaultId && cfg.defaultId !== 'engine' ? [cfg.defaultId] : []), ...cfg.pinned] : [];
  const idsKey = ids.join('|');
  useEffect(() => {
    if (!idsKey) { setPicked(new Map()); return; }
    void window.oblako.resolveSearchChipCandidates(idsKey.split('|')).then((list) => {
      setPicked(new Map(list.map((c) => [c.id, c])));
    });
  }, [idsKey]);

  const save = useCallback((next: SearchChipsConfig) => {
    setCfg(next); // оптимистично: настройка мелкая, ждать диска незачем
    void window.oblako.setSearchChips(next);
  }, []);

  if (!cfg) return null;

  const engineName = getSearchEngine(engineId).name;
  const defaultCard = cfg.defaultId ? picked.get(cfg.defaultId) ?? null : null;

  const togglePin = (id: string) => {
    const pinned = cfg.pinned.includes(id)
      ? cfg.pinned.filter((x) => x !== id)
      // В конец, а не в начало: порядок закрепления — это и есть порядок чипов.
      : [...cfg.pinned, id];
    save({ ...cfg, pinned });
  };

  // Что происходит по Enter в поповере Ctrl+E — карточкой, а не строкой в общей стопке.
  // ⚠️ Это ответ на главный вопрос блока, и он обязан выглядеть иначе, чем варианты выбора под
  // ним: раньше выбранная цель была такой же строкой, как кандидаты в выдаче, и отличалась
  // только галочкой — то есть «что у меня стоит» и «из чего выбрать» читались одинаково.
  const defaultSummary = (): React.ReactNode => {
    const reset = (
      <button
        onClick={() => save({ ...cfg, defaultId: null })}
        title="Вернуть поведение по умолчанию"
        style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: sp(1) }}
      >
        <X size={13} /> Сбросить
      </button>
    );
    if (cfg.defaultId === 'engine') {
      return (
        <SpotCard
          compact
          stain="var(--tile-blue)"
          icon={<Favicon host={engineHost(engineId)} size={28} />}
          title={engineName}
          subtitle="Enter в Ctrl+E всегда уходит в поисковик"
          actions={reset}
        />
      );
    }
    if (defaultCard) {
      return (
        <SpotCard
          compact
          stain="var(--tile-teal)"
          icon={<Favicon host={defaultCard.host} size={28} />}
          title={defaultCard.name}
          subtitle={`Enter в Ctrl+E уходит сюда · ${SOURCE_LABEL[defaultCard.source]}`}
          actions={reset}
        />
      );
    }
    if (cfg.defaultId) {
      // id есть, а цели уже нет: бэнг удалили или сайт вытеснили из выученных.
      return (
        <StatusCard
          icon={<Compass size={20} style={{ color: 'var(--text-muted)' }} />}
          title="Цель потерялась"
          subtitle="Бэнг удалили или сайт вытеснили из выученных — поповер откроется как обычно"
          actions={reset}
        />
      );
    }
    return (
      <StatusCard
        icon={<Compass size={20} style={{ color: 'var(--text-muted)' }} />}
        title="Сайт, на котором вы сейчас"
        subtitle={`А если поиска по нему нет — ${engineName}`}
        actions={<CapsLabel style={{ marginBottom: 0 }}>Как было</CapsLabel>}
      />
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(6) }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: sp(3) }}>
        <CapsLabel>Цель по умолчанию</CapsLabel>
        <InlineHint>
          На ней поповер Ctrl+E открывается: набрали запрос, нажали Enter — ушло туда, без клика
          по полосе и без набора бэнга. Бэнг «!ключ» прямо в строке по-прежнему перебивает выбор.
        </InlineHint>
        {defaultSummary()}
        {cfg.defaultId !== 'engine' && (
          <button
            onClick={() => save({ ...cfg, defaultId: 'engine' })}
            style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: sp(2), alignSelf: 'flex-start' }}
          >
            <Globe size={14} /> Всегда искать в {engineName}
          </button>
        )}
        <TargetSearch
          placeholder="Найти сайт: wildberries, ozon, github…"
          isPicked={(id) => cfg.defaultId === id}
          onPick={(c) => save({ ...cfg, defaultId: cfg.defaultId === c.id ? null : c.id })}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: sp(3) }}>
        <CapsLabel>Что ещё показывать в полосе</CapsLabel>
        <OptionList>
        <OptionRow
          active={cfg.mode === 'auto'}
          onClick={() => save({ ...cfg, mode: 'auto' })}
          title="По ходу работы"
          subtitle="Сайты, где вы уже искали, и ваши бэнги — частые впереди. Список меняется сам."
        />
        <OptionRow
          active={cfg.mode === 'pinned'}
          onClick={() => save({ ...cfg, mode: 'pinned' })}
          title="Только закреплённые"
          subtitle="Ровно тот набор и в том порядке, что вы отметите ниже."
        />
        </OptionList>
        <InlineHint>
          Текущий сайт и поисковик по умолчанию показываются всегда — в обоих режимах.
        </InlineHint>
      </div>

      {cfg.mode === 'pinned' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: sp(3) }}>
          <CapsLabel>Закреплённые ({cfg.pinned.length})</CapsLabel>
          {cfg.pinned.length === 0 && <InlineHint>Пока ничего не закреплено — найдите цель ниже и нажмите на неё.</InlineHint>}
          {cfg.pinned.length > 0 && (
            <Panel>
              {cfg.pinned.map((id, i) => {
                const c = picked.get(id);
                if (!c) return null; // цель исчезла (удалённый бэнг) — молча не показываем
                return (
                  <div key={id}>
                    {i > 0 && <div style={{ height: 1, background: 'var(--divider)' }} />}
                    <TargetRow
                      candidate={c}
                      title="Убрать из закреплённых"
                      onClick={() => togglePin(id)}
                      action={<X size={15} style={{ flex: 'none', color: 'var(--text-muted)' }} />}
                    />
                  </div>
                );
              })}
            </Panel>
          )}
          <TargetSearch
            placeholder="Добавить цель в полосу…"
            isPicked={(id) => cfg.pinned.includes(id)}
            onPick={(c) => togglePin(c.id)}
          />
        </div>
      )}
    </div>
  );
}
