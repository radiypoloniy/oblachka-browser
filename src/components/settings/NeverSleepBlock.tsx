import { useCallback, useEffect, useState } from 'react';
import { X, MemoryStick } from 'lucide-react';
import { Favicon, InlineHint } from './kit';

// Сайты, которым запрещено выгружаться из памяти (ПКМ по вкладке → «Не выгружать из памяти»).
//
// ⚠️ Зачем экран вообще нужен: галочка в контекстном меню — решение НЕВИДИМОЕ. Отметив пару
// сайтов за месяц, человек их не помнит, а снять отметку можно было бы только открыв ту же
// вкладку заново — то есть, закрыв её, он терял доступ к собственной настройке. Ровно та же
// дыра, из-за которой появился раздел разрешений сайтов (см. PermissionsSection.tsx).
//
// ⚠️ Правило про САЙТ, а не про вкладку — поэтому список переживает и закрытие вкладки, и
// перезапуск браузера, и лежит в settings.json, а не в session.json (чью поломку человек
// оплачивает потерянными вкладками).
export default function NeverSleepBlock() {
  const [hosts, setHosts] = useState<string[] | null>(null);

  const load = useCallback(() => {
    void window.oblako.listNeverSleepSites()
      .then(setHosts)
      .catch(() => setHosts([]));
  }, []);

  useEffect(load, [load]);
  // Отметку ставят из МЕНЮ вкладки, а этот раздел мог быть открыт соседней вкладкой — без
  // подписки он показывал бы устаревший список до перезахода в настройки.
  useEffect(() => window.oblako.onNeverSleepChanged(load), [load]);

  if (hosts === null) return <InlineHint>Загрузка…</InlineHint>;

  if (hosts.length === 0) {
    return (
      <InlineHint>
        Пока таких сайтов нет. Правый клик по вкладке → «Не выгружать из памяти».
      </InlineHint>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {hosts.map((host) => (
        <div key={host} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 12px', border: '1px solid var(--divider)', borderRadius: 'var(--radius-sm)',
        }}>
          <Favicon host={host} size={18} />
          <span style={{
            flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{host}</span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
            fontSize: 'var(--fs-xs)', color: 'var(--text-faint)',
          }}>
            <MemoryStick size={12} /> всегда в памяти
          </span>
          <button
            onClick={() => { void window.oblako.removeNeverSleepSite(host).then(load); }}
            title="Разрешить выгружать этот сайт"
            style={{
              border: 'none', background: 'none', cursor: 'default', padding: '4px 8px',
              borderRadius: 6, color: 'var(--text-muted)', flexShrink: 0,
              display: 'inline-flex', alignItems: 'center',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
