import { useCallback, useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { EngineOption, CapsLabel, InlineHint } from './kit';
import type { SearchChipsConfig, SearchChipCandidate } from '../../../shared/ipc';

// Блок «Цели быстрого поиска» раздела «Браузер»: чем наполнять полосу чипов в поповере Ctrl+E.
// Только рисует то, что прислал main (см. CLAUDE.md) — сама сборка целей живёт в
// electron/SearchTargets.ts, хранилище выученных — в electron/SearchTargetStore.ts.

const SOURCE_LABEL: Record<SearchChipCandidate['source'], string> = {
  user: 'свой бэнг',
  learned: 'вы тут искали',
  builtin: 'встроенный',
};

export default function SearchChipsBlock() {
  const [cfg, setCfg] = useState<SearchChipsConfig | null>(null);
  const [candidates, setCandidates] = useState<SearchChipCandidate[]>([]);

  const reload = useCallback(() => {
    void window.oblako.getSearchChips().then(setCfg);
    void window.oblako.listSearchChipCandidates().then(setCandidates);
  }, []);
  useEffect(reload, [reload]);

  const save = (next: SearchChipsConfig) => {
    setCfg(next); // оптимистично: настройка мелкая, ждать диска незачем
    void window.oblako.setSearchChips(next);
  };

  if (!cfg) return null;

  const togglePin = (id: string) => {
    const pinned = cfg.pinned.includes(id)
      ? cfg.pinned.filter((x) => x !== id)
      // В конец, а не в начало: порядок закрепления — это и есть порядок чипов.
      : [...cfg.pinned, id];
    save({ ...cfg, pinned });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <EngineOption
          active={cfg.mode === 'auto'}
          onClick={() => save({ ...cfg, mode: 'auto' })}
          title="По ходу работы"
          subtitle="Сайты, где вы уже искали, и ваши бэнги — частые впереди. Список меняется сам."
        />
        <EngineOption
          active={cfg.mode === 'pinned'}
          onClick={() => save({ ...cfg, mode: 'pinned' })}
          title="Только закреплённые"
          subtitle="Ровно тот набор и в том порядке, что вы отметите ниже."
        />
      </div>

      <InlineHint>
        Текущий сайт и поисковик по умолчанию показываются всегда — в обоих режимах.
      </InlineHint>

      {cfg.mode === 'pinned' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <CapsLabel>Закреплённые ({cfg.pinned.length})</CapsLabel>
          {candidates.length === 0 && <InlineHint>Пока нечего закреплять: заведите бэнг или поищите на любом сайте.</InlineHint>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {candidates.map((c) => {
              const on = cfg.pinned.includes(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => togglePin(c.id)}
                  title={SOURCE_LABEL[c.source]}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '7px 12px', borderRadius: 999, cursor: 'default',
                    border: '1px solid',
                    borderColor: on ? 'transparent' : 'var(--divider-strong)',
                    background: on ? 'var(--accent)' : 'transparent',
                    color: on ? '#fff' : 'var(--text-body)',
                    fontSize: 'var(--fs-sm)', fontWeight: on ? 600 : 500,
                  }}
                >
                  {on && <Check size={13} />}
                  {c.name}
                  <span style={{
                    fontSize: 'var(--fs-xs)', opacity: 0.65,
                  }}>{SOURCE_LABEL[c.source]}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
