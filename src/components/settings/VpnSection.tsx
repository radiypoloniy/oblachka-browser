import { useEffect, useState } from 'react';
import { Check, Wifi, RefreshCw, Trash2 } from 'lucide-react';
import type { VpnStatus, VpnServerMeta, VpnConnectionState } from '../../../shared/ipc';
import { islandPlate } from '../../styles/island';
import { stripEmoji } from '../../../shared/text';
import {
  btnPrimary, btnGhost, SectionHeader, CapsLabel, LoadingNote, InlineError,
  StatusCard, TextField, InputRow, fieldFlex,
} from './kit';

// VPN, шаг 2 — подписка/список серверов (шаг 1) + подключение процесса Xray (шаг 2). Ссылка
// подписки и credential каждого сервера никогда не покидают main — сюда приходит только
// редактированный список (VpnServerMeta) и статусы (VpnStatus/VpnConnectionState), тот же
// приём, что у PasswordMeta/AiKeyStore. ⚠️ "Подключиться" пока НЕ переключает трафик вкладок
// (session.setProxy — шаг 3, ещё не реализован) — только поднимает локальный процесс Xray.
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 }}>
      <SectionHeader title="VPN">
        Вставьте ссылку подписки от вашего VPN-сервиса (vless/trojan) — так же, как в Happ или
        Hiddify. Ссылка и серверы хранятся зашифрованными на этом устройстве, никуда, кроме
        вашего провайдера, не отправляются. Подключение пока экспериментальное: поднимает
        локальный туннель, но ещё не переключает на него трафик вкладок — это следующий шаг.
      </SectionHeader>

      {/* Статус */}
      <StatusCard
        icon={status.hasSubscription
          ? <Check size={22} style={{ color: 'var(--success-500)', flex: 'none' }} />
          : <Wifi size={22} style={{ color: 'var(--text-faint)', flex: 'none' }} />}
        title={status.hasSubscription ? `Подписка сохранена — серверов: ${status.serverCount}` : 'Подписка не добавлена'}
        subtitle={status.fetchedAt ? `Обновлено: ${new Date(status.fetchedAt).toLocaleString('ru-RU')}` : undefined}
        actions={status.hasSubscription && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              onClick={() => void handleRefresh()}
              disabled={refreshing}
              style={{ ...btnGhost, display: 'flex', gap: 6, alignItems: 'center' }}
            >
              <RefreshCw size={14} /> {refreshing ? 'Обновление…' : 'Обновить'}
            </button>
            <button onClick={() => void handleDelete()} style={{ ...btnGhost, display: 'flex', gap: 6, alignItems: 'center' }}>
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

      {/* Список серверов — только чтение, без credential (см. VpnServerMeta). */}
      {servers.length > 0 && (
        <div>
          <CapsLabel>Серверы ({servers.length})</CapsLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {servers.map((s) => {
              const isTarget = conn?.serverId === s.id;
              const isRunning = isTarget && conn?.state === 'running';
              const isStarting = (isTarget && conn?.state === 'starting') || connectingId === s.id;
              const isError = isTarget && conn?.state === 'error';
              return (
                <div key={s.id}>
                  <div
                    style={{
                      ...islandPlate, borderRadius: 'var(--radius-sm)', padding: '9px 14px',
                      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                      boxShadow: isRunning ? '0 0 0 1.5px var(--success-500) inset' : undefined,
                    }}
                  >
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: 'var(--ls-caps)', textTransform: 'uppercase',
                      color: 'var(--text-faint)', flex: 'none', width: 44,
                    }}>
                      {s.protocol}
                    </span>
                    {/* Название и «адрес · транспорт» — одна сжимаемая колонка (как у StatusCard):
                        кнопки во всех рядах стоят в одном месте на любой ширине, длинный текст
                        обрезается многоточием, а не растаскивает ряд по строкам вразнобой. */}
                    <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                      <div style={{
                        fontSize: 'var(--fs-sm)', color: 'var(--text-strong)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {stripEmoji(s.remark) || s.address}
                      </div>
                      <div style={{
                        fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        <span style={{ fontFamily: 'monospace' }}>{s.address}:{s.port}</span>
                        {' · '}{s.transport}/{s.security}
                      </div>
                    </div>
                    {isRunning ? (
                      <button onClick={() => void handleDisconnect()} style={{ ...btnGhost, flex: 'none', padding: '5px 10px' }}>
                        Отключить
                      </button>
                    ) : isError ? (
                      // ⚠️ «Отключить» видна и здесь, не только при isRunning — иначе после
                      // неудачной попытки нет способа выйти из состояния error через UI вообще
                      // (см. живой аудит: kill switch блокирует ВЕСЬ трафик до переподключения,
                      // а без этой кнопки переподключиться — единственный доступный выход).
                      <div style={{ display: 'flex', gap: 6, flex: 'none' }}>
                        <button
                          onClick={() => void handleConnect(s.id)}
                          disabled={isStarting}
                          style={{ ...btnGhost, padding: '5px 10px', opacity: isStarting ? 0.6 : 1 }}
                        >
                          {isStarting ? 'Подключение…' : 'Повторить'}
                        </button>
                        <button onClick={() => void handleDisconnect()} style={{ ...btnGhost, padding: '5px 10px' }}>
                          Отключить
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => void handleConnect(s.id)}
                        disabled={isStarting}
                        style={{ ...btnGhost, flex: 'none', padding: '5px 10px', opacity: isStarting ? 0.6 : 1 }}
                      >
                        {isStarting ? 'Подключение…' : 'Подключить'}
                      </button>
                    )}
                  </div>
                  {isError && conn?.error && (
                    <div style={{ padding: '3px 14px 0' }}>
                      <InlineError>{conn.error}</InlineError>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

