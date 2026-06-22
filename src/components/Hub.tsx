import { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';
import { getTopSites } from '../../shared/frecency';
import type { TileSite } from '../../shared/frecency';

interface HubProps {
  onSubmit: (input: string) => void;
  onOpenHistory: () => void;
}

export default function Hub({ onSubmit, onOpenHistory }: HubProps) {
  const [tiles, setTiles] = useState<TileSite[]>([]);

  useEffect(() => {
    window.oblako.getHistory().then((entries) => {
      setTiles(getTopSites(entries, 8));
    }).catch(() => { /* история недоступна — плитки пустые */ });
  }, []);

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '32px 48px', overflowY: 'auto', gap: 32,
    }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{
          margin: '0 0 6px', fontSize: 'var(--fs-3xl)', fontWeight: 700,
          letterSpacing: 'var(--ls-tight)', color: 'var(--text-strong)',
        }}>
          Чем займёмся, <span style={{ color: 'var(--accent)' }}>Антон</span>?
        </h1>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 'var(--fs-md)' }}>
          Введите адрес или запрос в строке выше
        </p>
      </div>

      {tiles.length > 0 && (
        <div style={{ width: '100%', maxWidth: 680 }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 12,
          }}>
            {tiles.map((site) => (
              <TileCard key={site.origin} site={site} onClick={() => onSubmit(site.url)} />
            ))}
          </div>

          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <button
              onClick={onOpenHistory}
              style={{
                background: 'none', border: 'none', cursor: 'default',
                color: 'var(--text-faint)', fontSize: 'var(--fs-xs)',
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '4px 8px', borderRadius: 'var(--radius-sm)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-faint)')}
            >
              <Clock size={12} /> Вся история
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function TileCard({ site, onClick }: { site: TileSite; onClick: () => void }) {
  const [faviconOk, setFaviconOk] = useState(true);
  const faviconSrc = `${site.origin}/favicon.ico`;
  // Первая буква домена для фолбэка
  const letter = site.origin.replace(/^https?:\/\//, '').charAt(0).toUpperCase();
  // Человекочитаемый домен (без схемы)
  const domain = site.origin.replace(/^https?:\/\//, '');

  return (
    <button
      onClick={onClick}
      title={site.title || domain}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
        padding: '14px 10px',
        background: 'var(--surface-island)',
        backdropFilter: 'var(--glass-filter)',
        WebkitBackdropFilter: 'var(--glass-filter)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-card)',
        border: '1px solid var(--glass-edge)',
        cursor: 'default',
        minWidth: 0,
        transition: 'box-shadow 0.15s, transform 0.1s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.boxShadow = 'var(--shadow-island)';
        e.currentTarget.style.transform = 'translateY(-1px)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.boxShadow = 'var(--shadow-card)';
        e.currentTarget.style.transform = '';
      }}
    >
      {faviconOk ? (
        <img
          src={faviconSrc}
          alt=""
          width={24} height={24}
          style={{ borderRadius: 4, display: 'block' }}
          onError={() => setFaviconOk(false)}
        />
      ) : (
        <div style={{
          width: 24, height: 24, borderRadius: 6,
          background: 'var(--accent-soft)',
          color: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700,
        }}>
          {letter}
        </div>
      )}
      <span style={{
        fontSize: 'var(--fs-xs)', color: 'var(--text-muted)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        width: '100%', textAlign: 'center',
      }}>
        {domain}
      </span>
    </button>
  );
}
