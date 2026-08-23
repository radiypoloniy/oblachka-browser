import { useEffect, useState } from 'react';
import { Check, Wifi, RefreshCw, Trash2 } from 'lucide-react';
import type { VpnStatus, VpnServerMeta, VpnConnectionState } from '../../../shared/ipc';
import { stripEmoji } from '../../../shared/text';
import { detectCountry } from '../../../shared/countries';
import CountryFlag from '../CountryFlag';
import {
  btnPrimary, btnGhost, SectionHeader, CapsLabel, LoadingNote, FactGrid, Fact,
  StatusCard, TextField, InputRow, fieldFlex, OptionList, OptionRow,
} from './kit';

// Подписка и список серверов. Ссылка подписки и credential никогда не покидают main —
// сюда приходит только редактированный список (VpnServerMeta) и статусы. «Подключиться»
// поднимает Xray; трафик вкладок переключает applyVpnProxy в main (session.setProxy).
/** Состояние туннеля одним словом — для героя шапки. */
const VPN_STATE_WORD: Record<VpnConnectionState['state'], string> = {
  stopped: 'Выключен',
  starting: 'Подключаюсь',
  running: 'Подключено',
  error: 'Ошибка',
};

export default function VpnSection() {
  const [status, setStatus] = useState<VpnStatus | null>(null);
  const [servers, setServers] = useState<VpnServerMeta[]>([]);
  const [conn, setConn] = useState<VpnConnectionState | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const loadServers = () => { void window.oblako.listVpnServers().then(setServers); };

  useEffect(() => {
    let mounted = true;
    window.oblako.getVpnStatus().then((s) => { if (mounted) setStatus(s); });
    window.oblako.getVpnConnectionState().then((c) => { if (mounted) setConn(c); });
    loadServers();
    const unsubStatus = window.oblako.onVpnStatusChanged((s) => {
      if (!mounted) return;
      setStatus(s);
      loadServers();
    });
    const unsubConn = window.oblako.onVpnConnectionStateChanged((c) => { if (mounted) setConn(c); });
    return () => { mounted = false; unsubStatus(); unsubConn(); };
  }, []);

  async function handleConnect(serverId: string) {
    setConnectingId(serverId);
    await window.oblako.vpnConnect(serverId);
    setConnectingId(null);
  }

  async function handleDisconnect() {
    await window.oblako.vpnDisconnect();
  }

  async function handleSave() {
    const url = urlInput.trim();
    if (!url) { setError('Введите ссылку подписки'); return; }
    setSaving(true); setError(''); setInfo('');
    const res = await window.oblako.setVpnSubscription(url);
    setSaving(false);
    if (res.ok) {
      setUrlInput('');
      setInfo(`Загружено серверов: ${res.count}${res.skipped ? `, не распознано: ${res.skipped}` : ''}`);
    } else {
      setError(res.error ?? 'Не удалось сохранить');
    }
  }

  async function handleRefresh() {
    setRefreshing(true); setError(''); setInfo('');
    const res = await window.oblako.refreshVpnSubscription();
    setRefreshing(false);
    if (res.ok) setInfo(`Обновлено. Серверов: ${res.count}${res.skipped ? `, не распознано: ${res.skipped}` : ''}`);
    else setError(res.error ?? 'Не удалось обновить');
  }

  async function handleDelete() {
    await window.oblako.deleteVpnSubscription();
    setUrlInput(''); setError(''); setInfo('');
  }

  if (status === null) {
    return <LoadingNote />;
  }

  // Один протокол на всю подписку — обычное дело, и тогда его слово в каждой строке лишнее.
  const mixedProtocols = new Set(servers.map((x) => x.protocol)).size > 1;

  // ⚠️ Пока состояние не пришло, считаем туннель выключенным, а не рисуем пустоту: раздел
  // появляется мгновенно, и мигание заглушки в шапке заметнее, чем неточность в первые
  // миллисекунды. Ошибиться в эту сторону безопасно — «выключен» не обещает защиты.
  const connState: VpnConnectionState['state'] = conn?.state ?? 'stopped';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 }}>
      {/* ⚠️ Герой — САМ ФАКТ подключения, а не название раздела: заходя сюда, человек хочет
          знать «я сейчас через туннель или нет», и ответ обязан быть первым, что он видит. */}
      <SectionHeader
        title="VPN"
        hero={connState === 'running' ? (conn?.serverRemark ?? 'Подключено') : VPN_STATE_WORD[connState]}
        heroLabel={connState === 'running'
          ? 'трафик браузера идёт через сервер'
          : connState === 'error'
            ? (conn?.error ?? 'туннель не поднялся')
            : 'трафик идёт напрямую'}
      >
        Ссылка подписки и серверы хранятся зашифрованными на этом устройстве и никуда, кроме
        вашего провайдера, не отправляются.
      </SectionHeader>

      {/* ⚠️ Сетка показывает то, чего в разделе НЕ БЫЛО ВООБЩЕ. Про kill switch и WebRTC человек
          мог узнать только из README, хотя это и есть ответ на вопрос «а точно ли я защищён» —
          главный вопрос, ради которого VPN включают. */}
      <FactGrid>
        <Fact
          label="Kill switch"
          hint="Туннель упал — сеть закрывается"
          value={connState === 'running' ? 'Сторожит' : 'В покое'}
          active={connState === 'running'}
        />
        <Fact
          label="WebRTC"
          hint="Локальный адрес не утекает"
          value={connState === 'running' ? 'Закрыт' : 'Как обычно'}
          active={connState === 'running'}
        />
        <Fact
          label="Серверы"
          hint={status.fetchedAt ? `обновлено ${new Date(status.fetchedAt).toLocaleDateString('ru-RU')}` : 'подписка не добавлена'}
          value={status.hasSubscription ? String(status.serverCount) : 'Нет'}
        />
        <Fact
          label="Протокол"
          hint="Xray-core дочерним процессом"
          value="VLESS"
        />
      </FactGrid>

      {/* Статус */}
      <StatusCard
        icon={status.hasSubscription
          ? <Check size={22} style={{ color: 'var(--success-500)', flex: 'none' }} />
          : <Wifi size={22} style={{ color: 'var(--text-faint)', flex: 'none' }} />}
        title={status.hasSubscription ? 'Подписка сохранена' : 'Подписка не добавлена'}
        // Счётчик и дата — одной подписью: в заголовке «серверов: 10» ломалось переносом ровно
        // между словом и числом, и карточка выглядела сломанной.
        subtitle={status.hasSubscription
          ? [`серверов: ${status.serverCount}`, status.fetchedAt ? `обновлено ${new Date(status.fetchedAt).toLocaleString('ru-RU')}` : null]
            .filter(Boolean).join(' · ')
          : undefined}
        actions={status.hasSubscription && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              style={{ ...btnGhost, display: 'flex', gap: 8, alignItems: 'center' }}
            >
              <RefreshCw size={14} /> {refreshing ? 'Обновление…' : 'Обновить'}
            </button>
            <button onClick={() => void handleDelete()} style={{ ...btnGhost, display: 'flex', gap: 8, alignItems: 'center' }}>
              <Trash2 size={14} /> Удалить
            </button>
          </div>
        )}
      />

      {/* Ввод ссылки — доступен всегда (не только при первом добавлении): пользователь может
          захотеть сменить провайдера, новая ссылка просто перезапишет текущую подписку. */}
      <div>
        <CapsLabel>Ссылка подписки</CapsLabel>
        <InputRow>
          <TextField
            value={urlInput}
            placeholder="https://…/sub"
            mono
            onChange={(v) => { setUrlInput(v); setError(''); }}
            onEnter={() => void handleSave()}
            error={error || undefined}
            info={info || undefined}
            style={fieldFlex}
          />
          <button
            onClick={() => void handleSave()}
            disabled={saving || !urlInput.trim()}
            style={{ ...btnPrimary, alignSelf: 'flex-start', opacity: saving || !urlInput.trim() ? 0.6 : 1 }}
          >
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </InputRow>
      </div>

      {/* Список серверов — только чтение, без credential (см. VpnServerMeta).
          ⚠️ Форма — общий список настроек (OptionList/OptionRow, разбор в kit.tsx). Раньше каждый
          сервер был отдельной залитой плашкой с колонкой «VLESS» и кнопкой «Подключить» — на
          десяти серверах это десять плит, десять одинаковых слов и десять одинаковых кнопок.
          Живая жалоба: «выглядит очень перегруженно». Теперь протокол ушёл в подпись (он у всех
          один и различает строки не он), а подключение — клик по самой строке, как выбор в любом
          другом списке настроек; кнопки остались только там, где действие НЕ равно «выбрать»:
          отключиться и повторить после ошибки. */}
      {servers.length > 0 && (
        <div>
          <CapsLabel>Серверы ({servers.length})</CapsLabel>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', margin: '0 0 8px' }}>
            Нажмите на сервер, чтобы подключиться.
          </div>
          <OptionList>
            {servers.map((s) => {
              const isTarget = conn?.serverId === s.id;
              const isRunning = isTarget && conn?.state === 'running';
              const isStarting = (isTarget && conn?.state === 'starting') || connectingId === s.id;
              const isError = isTarget && conn?.state === 'error';
              const country = detectCountry(s.remark);
              return (
                <OptionRow
                  key={s.id}
                  active={isRunning}
                  icon={country ? <CountryFlag code={country.code} title={country.name} /> : null}
                  onClick={isRunning || isStarting ? undefined : () => void handleConnect(s.id)}
                  title={stripEmoji(s.remark) || s.address}
                  subtitle={
                    <>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{s.address}:{s.port}</span>
                      {/* ⚠️ Протокол показываем ТОЛЬКО когда он в списке не один: у одной
                          подписки все серверы обычно vless, и слово повторялось в каждой строке
                          ровно ничего не различая — прежде оно вообще стояло отдельной колонкой. */}
                      {`${mixedProtocols ? ` · ${s.protocol.toLowerCase()}` : ''} · ${s.transport}/${s.security}`}
                      {isError && conn?.error && (
                        <span style={{ color: 'var(--danger-500)' }}> · {conn.error}</span>
                      )}
                    </>
                  }
                  badge={
                    isRunning ? { text: 'подключён', color: 'var(--success-500)' }
                      : isStarting ? { text: 'подключаюсь…', color: 'var(--text-muted)' }
                        : isError ? { text: 'ошибка', color: 'var(--danger-500)' }
                          : undefined
                  }
                  actions={(isRunning || isError) && (
                    <>
                      {/* ⚠️ «Отключить» доступна и в ошибке, не только при isRunning: kill switch
                          блокирует ВЕСЬ трафик до переподключения, и без этой кнопки выхода из
                          состояния error через интерфейс не остаётся вовсе (живой аудит). */}
                      {isError && (
                        <button
                          onClick={() => void handleConnect(s.id)}
                          disabled={isStarting}
                          style={{ ...btnGhost, padding: '4px 12px', opacity: isStarting ? 0.6 : 1 }}
                        >
                          {isStarting ? 'Подключение…' : 'Повторить'}
                        </button>
                      )}
                      <button onClick={() => void handleDisconnect()} style={{ ...btnGhost, padding: '4px 12px' }}>
                        Отключить
                      </button>
                    </>
                  )}
                />
              );
            })}
          </OptionList>
        </div>
      )}
    </div>
  );
}

