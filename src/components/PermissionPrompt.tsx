import { useState } from 'react';
import type React from 'react';
import { Camera, Mic, MapPin, Bell, Maximize2, Clipboard, ShieldAlert } from 'lucide-react';
import type { PermissionRequest, PermKey } from '../../shared/ipc';
import { islandPlate } from '../styles/island';

// Карточка «сайт просит доступ». Живёт в собственной WebContentsView поверх страницы
// (см. electron/PermissionPopoverManager.ts) — раньше была полосой в чроме, ради которой
// страницу сдвигали вниз на 64 px.

// Заголовок вопроса — именительный падеж, крупной строкой.
const PERM_TITLE: Record<PermKey, string> = {
  'camera':                    'Доступ к камере',
  'microphone':                'Доступ к микрофону',
  'camera+microphone':         'Доступ к камере и микрофону',
  'geolocation':               'Доступ к вашему местоположению',
  'notifications':             'Показ уведомлений',
  'fullscreen':                'Полноэкранный режим',
  'clipboard-read':            'Чтение буфера обмена',
  'clipboard-sanitized-write': 'Запись в буфер обмена',
};

// Вторая строка — что это значит на деле. Формулировка бытовая: человек решает не про
// «разрешение браузера», а про то, будет ли сайт его видеть и слышать.
const PERM_HINT: Record<PermKey, string> = {
  'camera':                    'Сайт сможет видеть изображение с камеры',
  'microphone':                'Сайт сможет слышать звук с микрофона',
  'camera+microphone':         'Сайт сможет видеть и слышать вас',
  'geolocation':               'Сайт узнает, где вы находитесь',
  'notifications':             'Сайт сможет присылать уведомления',
  'fullscreen':                'Страница развернётся на весь экран',
  'clipboard-read':            'Сайт прочитает то, что вы скопировали',
  'clipboard-sanitized-write': 'Сайт сможет положить текст в буфер обмена',
};

function PermIcon({ perm }: { perm: PermKey }) {
  const props = { size: 18, style: { flexShrink: 0, color: 'var(--accent)' } };
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

  // Показываем только hostname: в origin есть схема и порт, а решение человек принимает про сайт.
  // ⚠️ У локального файла origin — строка «null» (так его отдаёт Chromium), и в карточке
  // получалось буквальное «null запрашивает доступ». Для таких страниц имени сайта нет вовсе.
  let host = request.origin;
  try { host = new URL(request.origin).hostname || request.origin; } catch { /* origin мог прийти не-URL */ }
  if (!host || host === 'null') host = 'Эта страница';

  return (
    <div style={{
      ...islandPlate,
      borderRadius: 'var(--radius-card)',
      padding: 16,
      display: 'flex', flexDirection: 'column', gap: 12,
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        {/* Иконка в кружке-подложке — тот же приём, что у карточек настроек: она читается как
            предмет разговора, а не как декор строки. */}
        <div style={{
          width: 34, height: 34, borderRadius: 'var(--radius-pill)', flex: 'none',
          background: 'var(--accent-soft)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <PermIcon perm={request.permission} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
            {PERM_TITLE[request.permission]}
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', marginTop: 3, wordBreak: 'break-word' }}>
            <b style={{ color: 'var(--text-body)' }}>{host}</b>
            {' — '}{PERM_HINT[request.permission]}
          </div>
        </div>
      </div>

      <label style={{
        display: 'flex', alignItems: 'center', gap: 7,
        fontSize: 'var(--fs-xs)', color: 'var(--text-muted)',
        cursor: 'default', userSelect: 'none',
      }}>
        <input
          type="checkbox"
          checked={remember}
          onChange={(e) => setRemember(e.target.checked)}
          style={{ cursor: 'default', accentColor: 'var(--accent)' }}
        />
        Запомнить выбор для этого сайта
      </label>

      {/* Разрешить — акцентная, Запретить — тихая. Порядок именно такой: разрушительного
          действия здесь нет, а по умолчанию человек чаще всего и пришёл разрешить. */}
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => onRespond(true, remember)}
          style={{ ...actionBtn, background: 'var(--accent)', color: 'var(--on-accent)', flex: 1 }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.88'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
        >
          Разрешить
        </button>
        <button
          onClick={() => onRespond(false, remember)}
          style={{ ...actionBtn, background: 'var(--surface-sunken)', color: 'var(--text-body)', flex: 1 }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-sunken)'; }}
        >
          Запретить
        </button>
      </div>
    </div>
  );
}

const actionBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  padding: '8px 14px', border: 'none', cursor: 'default',
  borderRadius: 'var(--radius-pill)',
  fontSize: 'var(--fs-sm)', fontWeight: 500,
  transition: 'opacity var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard)',
};
