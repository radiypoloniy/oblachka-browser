import { useState } from 'react';
import { Search, Clock, Star, FileText, Sparkles } from 'lucide-react';
import type { StuffHit } from '../../shared/ipc';
import { islandPlate } from '../styles/island';

// «Куда я это дел» (AI-IDEAS.md №4) — один вопрос сразу по истории, закладкам и загрузкам.
// Компонент только рисует и зовёт window.oblako.searchStuff: вся логика (сбор кандидатов из трёх
// источников и переранжирование) живёт в main (electron/StuffSearch.ts).
//
// ⚠️ Поиск по ENTER, а не на каждую букву: он ходит к модели, а это секунды, не миллисекунды —
// то же правило, что у умного поиска истории и смыслового Ctrl+F.

const KIND_ICON = {
  history: Clock,
  bookmark: Star,
  download: FileText,
} as const;

const KIND_LABEL = {
  history: 'История',
  bookmark: 'Закладка',
  download: 'Загрузка',
} as const;

export default function StuffSearchView({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<StuffHit[] | null>(null);
  const [working, setWorking] = useState(false);
  const [degraded, setDegraded] = useState(false);

  async function run() {
    const q = query.trim();
    if (!q || working) return;
    setWorking(true);
    const res = await window.oblako.searchStuff(q).catch(() => ({ hits: [], degraded: true }));
    setHits(res.hits);
    setDegraded(res.degraded);
    setWorking(false);
  }

  function open(hit: StuffHit) {
    // ⚠️ Загрузку открываем штатным путём по её id: там уже есть перепроверка «файл ещё на месте»
    // в момент клика. Своим open по пути мы бы эту проверку потеряли.
    if (hit.kind === 'download') { if (hit.downloadId) void window.oblako.openDownloadFile(hit.downloadId); }
    else void window.oblako.createTab(hit.url);
    onClose();
  }

  return (
    <div style={{
      height: '100%', display: 'flex', flexDirection: 'column',
      ...islandPlate, borderRadius: 'var(--radius-island)',
      boxShadow: 'var(--shadow-island)', background: 'var(--surface-solid)',
      overflow: 'hidden',
    }}>
      <div style={{ padding: '18px 24px 12px', borderBottom: '1px solid var(--divider-strong)', flex: 'none' }}>
        <div style={{ position: 'relative' }}>
          <Search size={16} style={{
            position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
            color: 'var(--text-faint)', pointerEvents: 'none',
          }} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void run(); }}
            placeholder="Где та штука про ипотеку…"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '10px 12px 10px 34px', borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--divider-strong)', background: 'var(--surface)',
              color: 'var(--text-strong)', fontSize: 'var(--fs-md)', fontFamily: 'inherit',
              outline: 'none',
            }}
          />
        </div>
        <div style={{ marginTop: 6, fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
          Ищет сразу по истории, закладкам и загрузкам. Enter — искать.
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px 16px' }}>
        {working && (
          <div style={{ padding: '20px 12px', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
            Ищу…
          </div>
        )}
        {!working && hits !== null && hits.length === 0 && (
          <div style={{ padding: '20px 12px', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
            Ничего не нашлось
          </div>
        )}
        {!working && hits !== null && hits.length > 0 && degraded && (
          // Честно говорим, что модель не участвовала: иначе человек решит, что так она и отобрала.
          <div style={{ padding: '6px 12px', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
            Показано найденное по словам — модель не отвечала
          </div>
        )}
        {!working && hits?.map((hit, i) => {
          const Icon = KIND_ICON[hit.kind];
          return (
            <button
              key={`${hit.kind}-${hit.url}-${i}`}
              onClick={() => open(hit)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                padding: '9px 12px', borderRadius: 'var(--radius-sm)', border: 'none',
                background: 'transparent', cursor: 'default', textAlign: 'left',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <Icon size={16} style={{ color: 'var(--text-muted)', flex: 'none' }} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                  display: 'block', fontSize: 'var(--fs-sm)', color: 'var(--text-strong)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{hit.title}</span>
                <span style={{
                  display: 'block', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{[KIND_LABEL[hit.kind], hit.subtitle].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          );
        })}
        {!working && hits === null && (
          <div style={{
            padding: '28px 12px', display: 'flex', alignItems: 'center', gap: 8,
            fontSize: 'var(--fs-sm)', color: 'var(--text-faint)',
          }}>
            <Sparkles size={15} />
            Спросите словами — например «та статья про ипотеку» или «договор, который я скачивал»
          </div>
        )}
      </div>
    </div>
  );
}
