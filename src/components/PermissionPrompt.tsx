import { useState } from 'react';
import { Camera, Mic, MapPin, Bell, Maximize2, Clipboard, ShieldAlert } from 'lucide-react';
import type { PermissionRequest, PermKey } from '../../shared/ipc';

// Человекочитаемые описания разрешений (родительный падеж — «доступ к …»).
const PERM_LABEL: Record<PermKey, string> = {
  'camera':                    'камере',
  'microphone':                'микрофону',
  'camera+microphone':         'камере и микрофону',
  'geolocation':               'геолокации',
  'notifications':             'уведомлениям',
  'fullscreen':                'полноэкранному режиму',
  'clipboard-read':            'буферу обмена',
  'clipboard-sanitized-write': 'буферу обмена',
};

function PermIcon({ perm }: { perm: PermKey }) {
  const props = { size: 15, style: { flexShrink: 0, color: 'var(--text-muted)' } };
  switch (perm) {
    case 'camera':
    case 'camera+microphone': return <Camera {...props} />;
    case 'microphone':        return <Mic {...props} />;
    case 'geolocation':       return <MapPin {...props} />;
    case 'notifications':     return <Bell {...props} />;
    case 'fullscreen':        return <Maximize2 {...props} />;
    default:                  return perm.startsWith('clipboard')
      ? <Clipboard {...props} />
      : <ShieldAlert {...props} />;
  }
}

interface Props {
  request: PermissionRequest;
  onRespond: (granted: boolean, remember: boolean) => void;
}

export default function PermissionPrompt({ request, onRespond }: Props) {
  const [remember, setRemember] = useState(false);

  // Безопасно отображаем только hostname.
  let host = request.origin;
  try { host = new URL(request.origin).hostname; } catch { /* noop */ }

  return (
    <div style={{
      position: 'absolute',
      top: 0, left: 0, right: 0,
      height: 56,
      zIndex: 500,
      background: 'var(--surface-solid)',
      borderBottom: '1px solid var(--divider)',
      boxShadow: 'var(--shadow-card)',
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '0 16px',
      overflow: 'hidden',
    }}>
      <PermIcon perm={request.permission} />

      <span style={{
        fontSize: 'var(--fs-sm)', color: 'var(--text-body)',
        flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        <b style={{ color: 'var(--text-strong)' }}>{host}</b>
        {' '}запрашивает доступ к{' '}
        <b style={{ color: 'var(--text-strong)' }}>{PERM_LABEL[request.permission]}</b>
      </span>

      {/* «Запомнить» перед кнопками */}
      <label style={{
        display: 'flex', alignItems: 'center', gap: 5,
        fontSize: 'var(--fs-xs)', color: 'var(--text-muted)',
        cursor: 'default', flexShrink: 0, userSelect: 'none',
      }}>
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          style={{ cursor: 'default', accentColor: 'var(--accent)' }}
        />
        Запомнить
      </label>

      <button
        onClick={() => onRespond(true, remember)}
        style={actionBtn('var(--accent)', '#fff')}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
      >
        Разрешить
      </button>
      <button
        onClick={() => onRespond(false, remember)}
        style={actionBtn('var(--surface-sunken)', 'var(--text-body)')}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-sunken)'; }}
      >
        Запретить
      </button>
    </div>
  );
}

function actionBtn(bg: string, color: string): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center',
    padding: '5px 12px', border: 'none', cursor: 'default',
    borderRadius: 'var(--radius-pill)',
    background: bg, color,
    fontSize: 'var(--fs-sm)', fontWeight: 500, flexShrink: 0,
    transition: 'opacity 0.1s',
  };
}
