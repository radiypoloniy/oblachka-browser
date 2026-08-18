import { useEffect, useMemo, useState } from 'react';
import { Camera, Clipboard, MapPin, Maximize, Mic, Bell, RotateCcw } from 'lucide-react';
import type { PermissionRecord, PermKey } from '../../../shared/ipc';
import { Favicon, SectionHeader, Subsection } from './kit';

// Раздел «Разрешения сайтов» — что каким сайтам разрешено и как это поменять.
//
// ⚠️ Зачем он вообще понадобился: решение сохранялось навсегда, а посмотреть или отменить его
// было нечем. Сайт, которому один раз сказали «нет», больше не спрашивал никогда — и человек
// видел просто «микрофон не работает», без единого способа это исправить. Необратимое решение
// без экрана отмены — это ошибка, а не строгость.
//
// ⚠️ ТРИ состояния, а не два. «Забыть» ≠ «Запретить»: забытый сайт спросит снова, запрещённый
// не спросит никогда. Если склеить их в одну кнопку, исправить своё же ошибочное «нет» станет
// невозможно — ровно та дыра, из-за которой раздел и появился.

const LABEL: Record<PermKey, string> = {
  'camera': 'Камера',
  'microphone': 'Микрофон',
  'camera+microphone': 'Камера и микрофон',
  'geolocation': 'Местоположение',
  'notifications': 'Уведомления',
  'fullscreen': 'Полный экран',
  'clipboard-read': 'Чтение буфера обмена',
  'clipboard-sanitized-write': 'Запись в буфер обмена',
};

const ICON: Record<PermKey, typeof Camera> = {
  'camera': Camera,
  'microphone': Mic,
  'camera+microphone': Camera,
  'geolocation': MapPin,
  'notifications': Bell,
  'fullscreen': Maximize,
  'clipboard-read': Clipboard,
  'clipboard-sanitized-write': Clipboard,
};

function hostOf(origin: string): string {
  try { return new URL(origin).hostname; } catch { return origin; }
}

export default function PermissionsSection() {
  const [records, setRecords] = useState<PermissionRecord[]>([]);
  // Сайты, которым человек сам разрешил корень Минцифры (см. electron/CertTrustStore.ts).
  // ⚠️ Экран отзыва — не украшение: разрешение постоянное, и без него оно превратилось бы в то,
  // что человек однажды выдал, а найти и отменить уже не может.
  const [certTrust, setCertTrust] = useState<Array<{ domain: string; addedAt: number }>>([]);

  const load = async (): Promise<void> => setRecords(await window.oblako.listPermissions());
  const loadCertTrust = async (): Promise<void> => setCertTrust(await window.oblako.listCertTrust());
  useEffect(() => { void load(); void loadCertTrust(); }, []);

  // Группируем по сайту: человек думает про сайт («что можно телемосту»), а не про разрешение.
  const sites = useMemo(() => {
    const map = new Map<string, PermissionRecord[]>();
    for (const r of records) {
      // ⚠️ Записи с битым origin («null» строкой) отбрасываем из показа: строка, у которой нет
      // сайта, человеку ничего не говорит и починить её через этот экран нельзя.
      if (!r.origin || r.origin === 'null') continue;
      const list = map.get(r.origin) ?? [];
      list.push(r);
      map.set(r.origin, list);
    }
    return [...map.entries()].sort((a, b) => hostOf(a[0]).localeCompare(hostOf(b[0]), 'ru'));
  }, [records]);

  const setDecision = async (origin: string, key: PermKey, decision: 'granted' | 'denied'): Promise<void> => {
    await window.oblako.setPermission(origin, key, decision);
    void load();
  };
  const forget = async (origin: string, key?: PermKey): Promise<void> => {
    await window.oblako.revokePermission(origin, key);
    void load();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SectionHeader title="Разрешения сайтов">
        Что сайты могут запрашивать у браузера. Решение запоминается, когда вы отвечаете на вопрос
        с галочкой «запомнить», — здесь его можно посмотреть и изменить.
      </SectionHeader>

      <Subsection
        title="Сайты"
        description="«Забыть» вернёт вопрос: сайт спросит снова при следующей попытке. «Запретить» закрывает вопрос насовсем."
      >
        {sites.length === 0 ? (
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            Пока ни одно решение не сохранено. Сайты будут спрашивать при первой попытке.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sites.map(([origin, list]) => (
              <div key={origin} style={{
                border: '1px solid var(--divider)', borderRadius: 'var(--radius-sm)', overflow: 'hidden',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', background: 'var(--surface-hover)',
                }}>
                  <Favicon host={hostOf(origin)} size={18} />
                  <span style={{
                    flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', fontWeight: 600,
                    color: 'var(--text-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{hostOf(origin)}</span>
                  <button
                    onClick={() => void forget(origin)}
                    title="Забыть все решения по этому сайту"
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5, border: 'none',
                      background: 'none', cursor: 'default', padding: '3px 6px',
                      borderRadius: 6, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
                  >
                    <RotateCcw size={12} strokeWidth={2} /> Сбросить всё
                  </button>
                </div>

                {list.map((r) => {
                  const Icon = ICON[r.permission];
                  return (
                    <div key={r.permission} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                      borderTop: '1px solid var(--divider)',
                    }}>
                      <Icon size={14} strokeWidth={2} style={{ flexShrink: 0, color: 'var(--text-faint)' }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-body)' }}>
                        {LABEL[r.permission] ?? r.permission}
                      </span>
                      {/* Три кнопки на строку, а не тумблер: у состояния три значения, и
                          двухпозиционный переключатель не смог бы выразить «спрашивать». */}
                      <Seg active={r.decision === 'granted'} onClick={() => void setDecision(r.origin, r.permission, 'granted')}>
                        Разрешено
                      </Seg>
                      <Seg active={r.decision === 'denied'} onClick={() => void setDecision(r.origin, r.permission, 'denied')} danger>
                        Запрещено
                      </Seg>
                      <Seg active={false} onClick={() => void forget(r.origin, r.permission)}>
                        Спрашивать
                      </Seg>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </Subsection>
      {/* ⚠️ Сертификаты — ПОД списком сайтов: раздел про разрешения, и главное в нём — сайты.
          Блок появляется, только когда что-то разрешено: пустой раздел про сертификаты пугал бы
          человека вопросом, которого у него нет. */}
      {certTrust.length > 0 && (
        <Subsection
          title="Сертификаты Минцифры"
          description="Сайты, которым вы разрешили сертификаты удостоверяющего центра Минцифры — ответив «доверять» на вопрос браузера. Банки, у которых другого сертификата не бывает, работают и без этого списка."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {certTrust.map((t) => (
              <div key={t.domain} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', border: '1px solid var(--divider)', borderRadius: 'var(--radius-sm)',
              }}>
                <Favicon host={t.domain} size={18} />
                <span style={{
                  flex: 1, minWidth: 0, fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{t.domain}</span>
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', flexShrink: 0 }}>
                  {new Date(t.addedAt).toLocaleDateString('ru-RU')}
                </span>
                <button
                  onClick={() => { void window.oblako.removeCertTrust(t.domain).then(loadCertTrust); }}
                  title="Отозвать доверие"
                  style={{
                    border: 'none', background: 'none', cursor: 'default', padding: '3px 6px',
                    borderRadius: 6, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', flexShrink: 0,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'none'; }}
                >
                  Отозвать
                </button>
              </div>
            ))}
          </div>
        </Subsection>
      )}
    </div>
  );
}

function Seg({ active, danger, onClick, children }: {
  active: boolean; danger?: boolean; onClick: () => void; children: React.ReactNode;
}) {
  const color = active ? (danger ? 'var(--danger-500)' : 'var(--accent)') : 'var(--text-muted)';
  return (
    <button
      onClick={onClick}
      style={{
        flex: 'none', padding: '4px 9px', borderRadius: 'var(--radius-sm)', border: 'none',
        cursor: 'default', fontSize: 'var(--fs-xs)', fontWeight: active ? 600 : 400,
        background: active ? 'var(--surface)' : 'transparent',
        boxShadow: active ? 'var(--shadow-card)' : 'none',
        color,
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--surface-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = active ? 'var(--surface)' : 'transparent'; }}
    >{children}</button>
  );
}
