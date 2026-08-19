import { useState } from 'react';
import { Camera, Mic, MapPin, Bell, Maximize2, Clipboard, ShieldAlert, ExternalLink } from 'lucide-react';
import type { PermissionRequest, PermKey } from '../../shared/ipc';
import {
  PopoverCard, PopoverIcon, PopoverTitle, PopoverHint, PopoverActions,
  PrimaryButton, QuietButton,
} from './popoverKit';

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
  // ⚠️ Формулировка отличается от остальных намеренно: здесь речь не о доступе сайта к чему-то
  // внутри браузера, а о ЗАПУСКЕ ЧУЖОЙ ПРОГРАММЫ на машине с аргументами, которые выбрал сайт.
  'external-app':              'Открыть в другом приложении',
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
  'external-app':              'Сайт запустит установленное у вас приложение',
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
    case 'external-app':      return <ExternalLink {...props} />;
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
    <PopoverCard width={300}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <PopoverIcon><PermIcon perm={request.permission} /></PopoverIcon>
        <div style={{ minWidth: 0, flex: 1 }}>
          <PopoverTitle>{PERM_TITLE[request.permission]}</PopoverTitle>
          <PopoverHint>
            <b style={{ color: 'var(--text-body)' }}>{host}</b>
            {' — '}{PERM_HINT[request.permission]}
          </PopoverHint>
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

      {/* Разрешить — акцентная, Запретить — тихая. Порядок именно такой: разрушительного действия
          здесь нет, а пришёл человек чаще всего разрешить. Обе делят ширину: выбор равноправный. */}
      <PopoverActions>
        <PrimaryButton stretch onClick={() => onRespond(true, remember)}>Разрешить</PrimaryButton>
        <QuietButton stretch onClick={() => onRespond(false, remember)}>Запретить</QuietButton>
      </PopoverActions>
    </PopoverCard>
  );
}

