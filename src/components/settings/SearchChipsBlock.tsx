import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Search, X, Globe, Compass } from 'lucide-react';
import { OptionList, OptionRow, CapsLabel, InlineHint, TextField, Favicon } from './kit';
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
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
        borderRadius: 'var(--radius-sm)', cursor: 'default',
        background: selected ? 'var(--accent-soft)' : 'var(--surface)',
        boxShadow: selected ? '0 0 0 1.5px var(--accent) inset' : undefined,
      }}
    >
      <Favicon host={candidate.host} />
      <span style={{
        flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', fontWeight: 500, color: 'var(--text-strong)',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {candidate.name}
      </span>
      {candidate.bangKey && (
        <span style={{ flex: 'none', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
          !{candidate.bangKey}
        </span>
      )}
      <span style={{ flex: 'none', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
        {SOURCE_LABEL[candidate.source]}
      </span>
      {action}
      {selected && <Check size={15} style={{ flex: 'none', color: 'var(--accent)' }} />}
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Search size={15} style={{ flex: 'none', color: 'var(--text-faint)' }} />
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
      {results.map((c) => (
        <TargetRow key={c.id} candidate={c} selected={isPicked(c.id)} onClick={() => onPick(c)} />
      ))}
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

  // Строка выбранной цели по умолчанию: что сейчас, и кнопка вернуться к контекстному поведению.
  const defaultSummary = (): React.ReactNode => {
    const reset = (
      <button
        onClick={() => save({ ...cfg, defaultId: null })}
        title="Вернуть поведение по умолчанию"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4, flex: 'none',
          border: 'none', background: 'transparent', color: 'var(--text-muted)',
          fontSize: 'var(--fs-xs)', cursor: 'default', padding: '2px 4px',
        }}
      >
        <X size={13} />сбросить
      </button>
    );
    if (cfg.defaultId === 'engine') {
      return (
        <TargetRow
          selected
          action={reset}
          candidate={{ id: 'engine', name: engineName, kind: 'bang', source: 'builtin', host: engineHost(engineId) }}
        />
      );
    }
    if (defaultCard) return <TargetRow candidate={defaultCard} selected action={reset} />;
    if (cfg.defaultId) {
      // id есть, а цели уже нет: бэнг удалили или сайт вытеснили из выученных.
      return <InlineHint>Выбранная цель больше не существует — поповер откроется как обычно.{' '}{reset}</InlineHint>;
    }
    return (
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px',
        borderRadius: 'var(--radius-sm)', background: 'var(--surface)',
      }}>
        <Compass size={18} style={{ flex: 'none', color: 'var(--text-muted)' }} />
        <span style={{ flex: 1, fontSize: 'var(--fs-sm)', color: 'var(--text-body)' }}>
          Сайт, на котором вы сейчас — а если поиска по нему нет, то {engineName}
        </span>
        <span style={{ flex: 'none', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>как было</span>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <CapsLabel>Цель по умолчанию</CapsLabel>
        <InlineHint>
          На ней поповер Ctrl+E открывается: набрали запрос, нажали Enter — ушло туда, без клика
          по полосе и без набора бэнга. Бэнг «!ключ» прямо в строке по-прежнему перебивает выбор.
        </InlineHint>
        {defaultSummary()}
        {cfg.defaultId !== 'engine' && (
          <button
            onClick={() => save({ ...cfg, defaultId: 'engine' })}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
              padding: '6px 10px', borderRadius: 'var(--radius-sm)', cursor: 'default',
              border: '1px solid var(--divider-strong)', background: 'transparent',
              color: 'var(--text-body)', fontSize: 'var(--fs-xs)',
            }}
          >
            <Globe size={14} />всегда искать в {engineName}
          </button>
        )}
        <TargetSearch
          placeholder="Найти сайт: wildberries, ozon, github…"
          isPicked={(id) => cfg.defaultId === id}
          onPick={(c) => save({ ...cfg, defaultId: cfg.defaultId === c.id ? null : c.id })}
        />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <CapsLabel>Закреплённые ({cfg.pinned.length})</CapsLabel>
          {cfg.pinned.length === 0 && <InlineHint>Пока ничего не закреплено — найдите цель ниже и нажмите на неё.</InlineHint>}
          {cfg.pinned.map((id) => {
            const c = picked.get(id);
            if (!c) return null; // цель исчезла (удалённый бэнг) — молча не показываем
            return (
              <TargetRow
                key={id}
                candidate={c}
                title="Убрать из закреплённых"
                onClick={() => togglePin(id)}
                action={<X size={14} style={{ flex: 'none', color: 'var(--text-muted)' }} />}
              />
            );
          })}
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
