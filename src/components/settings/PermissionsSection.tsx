import { useEffect, useMemo, useState } from 'react';
import { Camera, Clipboard, MapPin, Maximize, Mic, Bell, RotateCcw, ExternalLink } from 'lucide-react';
import type { PermissionRecord, PermKey } from '../../../shared/ipc';
import { siteHue } from '../desktop/siteTint';
import {
  Favicon, SectionHeader, Subsection, SegTrack, segBtnStyle,
  FactGrid, Fact, SpotCard, SpotLine, btnGhost, Read,
} from './kit';
import { TEXT, sp } from '../../styles/system';

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
//
// Карточка сайта — тот же SpotCard, что у профиля: пятно, шапка, тело со строками. Не рисовать
// второй вид «пропуска».

const LABEL: Record<PermKey, string> = {
  'camera': 'Камера',
  'microphone': 'Микрофон',
  'camera+microphone': 'Камера и микрофон',
  'external-app': 'Открытие приложений',
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
  'external-app': ExternalLink,
  'geolocation': MapPin,
  'notifications': Bell,
  'fullscreen': Maximize,
  'clipboard-read': Clipboard,
  'clipboard-sanitized-write': Clipboard,
};

function hostOf(origin: string): string {
  try { return new URL(origin).hostname; } catch { return origin; }
}

/** Пятно из того же набора оттенков, что плитки сайтов на столе — без сиреневого сектора. */
function stainOf(host: string): string {
  return `hsl(${siteHue(host)} 58% 48%)`;
}

export default function PermissionsSection() {
  const [records, setRecords] = useState<PermissionRecord[]>([]);
  const [certTrust, setCertTrust] = useState<Array<{ domain: string; addedAt: number }>>([]);

  const load = async (): Promise<void> => setRecords(await window.oblako.listPermissions());
  const loadCertTrust = async (): Promise<void> => setCertTrust(await window.oblako.listCertTrust());
  useEffect(() => { void load(); void loadCertTrust(); }, []);

  const sites = useMemo(() => {
    const map = new Map<string, PermissionRecord[]>();
    for (const r of records) {
      if (!r.origin || r.origin === 'null') continue;
      const list = map.get(r.origin) ?? [];
      list.push(r);
      map.set(r.origin, list);
    }
    return [...map.entries()].sort((a, b) => hostOf(a[0]).localeCompare(hostOf(b[0]), 'ru'));
  }, [records]);

  const granted = records.filter((r) => r.decision === 'granted').length;
  const denied = records.filter((r) => r.decision === 'denied').length;

  const setDecision = async (origin: string, key: PermKey, decision: 'granted' | 'denied'): Promise<void> => {
    await window.oblako.setPermission(origin, key, decision);
    void load();
  };
  const forget = async (origin: string, key?: PermKey): Promise<void> => {
    await window.oblako.revokePermission(origin, key);
    void load();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(6) }}>
      <SectionHeader
        title="Разрешения"
        hero={sites.length === 0 ? 'Пусто' : String(sites.length)}
        heroLabel={sites.length === 1 ? 'сайт с сохранённым решением' : 'сайтов с сохранённым решением'}
      >
        Что сайты могут запрашивать у браузера. Решение запоминается, когда вы отвечаете на вопрос
        с галочкой «запомнить», — здесь его можно посмотреть и изменить.
      </SectionHeader>

      <FactGrid>
        <Fact label="Сайты" hint="Есть сохранённое решение" value={String(sites.length)} active={sites.length > 0} />
        <Fact label="Разрешено" hint="Больше не спрашиваем" value={String(granted)} active={granted > 0} />
        <Fact label="Запрещено" hint="Сайт не спросит снова" value={String(denied)} />
        <Fact
          label="Минцифры"
          hint="Корни, которым сказали «доверять»"
          value={certTrust.length === 0 ? 'Нет' : String(certTrust.length)}
        />
      </FactGrid>

      <Subsection
        title="Сайты"
        description="«Забыть» вернёт вопрос: сайт спросит снова при следующей попытке. «Запретить» закрывает вопрос насовсем."
      >
        {sites.length === 0 ? (
          <Read>
            <span style={{ ...TEXT.body, color: 'var(--text-muted)' }}>
              Пока ни одно решение не сохранено. Сайты будут спрашивать при первой попытке.
            </span>
          </Read>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: sp(4) }}>
            {sites.map(([origin, list]) => {
              const host = hostOf(origin);
              return (
                <SpotCard
                  key={origin}
                  stain={stainOf(host)}
                  icon={<Favicon host={host} size={28} />}
                  title={host}
                  subtitle={`${list.length} ${list.length === 1 ? 'решение' : 'решения'}`}
                  actions={(
                    <button
                      onClick={() => void forget(origin)}
                      title="Забыть все решения по этому сайту"
                      style={{ ...btnGhost, display: 'inline-flex', alignItems: 'center', gap: sp(1) }}
                    >
                      <RotateCcw size={14} strokeWidth={2} /> Сбросить всё
                    </button>
                  )}
                >
                  {list.map((r) => {
                    const Icon = ICON[r.permission];
                    return (
                      <SpotLine
                        key={r.permission}
                        title={(
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: sp(2) }}>
                            <Icon size={14} strokeWidth={2} style={{ color: 'var(--text-faint)' }} />
                            {LABEL[r.permission] ?? r.permission}
                          </span>
                        )}
                        control={(
                          <SegTrack>
                            <button
                              onClick={() => void setDecision(r.origin, r.permission, 'granted')}
                              style={segBtnStyle(r.decision === 'granted')}
                            >Разрешено</button>
                            <button
                              onClick={() => void setDecision(r.origin, r.permission, 'denied')}
                              style={segBtnStyle(r.decision === 'denied', r.decision === 'denied' ? 'var(--danger-500)' : undefined)}
                            >Запрещено</button>
                            <button
                              onClick={() => void forget(r.origin, r.permission)}
                              style={segBtnStyle(false)}
                            >Спрашивать</button>
                          </SegTrack>
                        )}
                      />
                    );
                  })}
                </SpotCard>
              );
            })}
          </div>
        )}
      </Subsection>

      {certTrust.length > 0 && (
        <Subsection
          title="Сертификаты Минцифры"
          description="Сайты, которым вы разрешили сертификаты удостоверяющего центра Минцифры — ответив «доверять» на вопрос браузера. Банки, у которых другого сертификата не бывает, работают и без этого списка."
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: sp(3) }}>
            {certTrust.map((t) => (
              <SpotCard
                key={t.domain}
                compact
                stain={stainOf(t.domain)}
                icon={<Favicon host={t.domain} size={28} />}
                title={t.domain}
                subtitle={new Date(t.addedAt).toLocaleDateString('ru-RU')}
                actions={(
                  <button
                    onClick={() => { void window.oblako.removeCertTrust(t.domain).then(loadCertTrust); }}
                    title="Отозвать доверие"
                    style={btnGhost}
                  >Отозвать</button>
                )}
              />
            ))}
          </div>
        </Subsection>
      )}
    </div>
  );
}
