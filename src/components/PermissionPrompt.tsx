import { useState } from 'react';
import { Camera, Mic, MapPin, Bell, Maximize2, Clipboard, ShieldAlert, ExternalLink } from 'lucide-react';
import type { PermissionRequest, PermKey } from '../../shared/ipc';
import { PopoverCard, PopoverActions, PrimaryButton, QuietButton } from './popoverKit';
import { sp, RADIUS, TEXT, DISPLAY } from '../styles/system';

// Карточка «сайт просит доступ». Живёт в собственной WebContentsView поверх страницы
// (см. electron/PermissionPopoverManager.ts) — раньше была полосой в чроме, ради которой
// страницу сдвигали вниз на 64 px.

// ⚠️ Заголовок — ВОПРОС, а не название разрешения. «Доступ к камере» — это ярлык раздела
// настроек; здесь у человека спрашивают, и спрашивать надо вопросом, иначе карточка читается
// как сообщение, которое можно не заметить, — а её и не замечали.
const PERM_TITLE: Record<PermKey, string> = {
  'camera':                    'Пустить к камере?',
  'microphone':                'Пустить к микрофону?',
  'camera+microphone':         'Пустить к камере и микрофону?',
  'geolocation':               'Показать, где вы находитесь?',
  'notifications':             'Разрешить уведомления?',
  'fullscreen':                'Развернуть на весь экран?',
  'clipboard-read':            'Дать прочитать буфер обмена?',
  'clipboard-sanitized-write': 'Разрешить писать в буфер обмена?',
  // ⚠️ Формулировка отличается от остальных намеренно: здесь речь не о доступе сайта к чему-то
  // внутри браузера, а о ЗАПУСКЕ ЧУЖОЙ ПРОГРАММЫ на машине с аргументами, которые выбрал сайт.
  'external-app':              'Открыть в другом приложении?',
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
  // Цвет наследуется от плашки: на инверсной плите значок светлый, а не акцентный.
  const props = { size: 23, style: { flexShrink: 0 } };
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
    // ⚠️ ИНВЕРСНАЯ плита и 380 px — единственная такая карточка в браузере. Разбор в
    // popoverKit::PopoverCard и у --overlay-plate-invert: контраст даёт земля, а не статус,
    // и работает он ровно потому, что инверсная поверхность одна на всё приложение.
    // 380 не выдуманы: PermissionPopoverManager резервирует под вью ровно столько и всегда
    // резервировал — карточка просто не занимала оплаченное место.
    <div className="oblako-ask-in">
      <PopoverCard width={380} invert tail>
        <div style={{ display: 'flex', gap: sp(4), alignItems: 'flex-start' }}>
          {/* Плашка значка — на инверсной плите своя: акцентная заливка на тёмном не читается. */}
          <span style={{
            width: 46, height: 46, borderRadius: RADIUS.box, flex: 'none',
            display: 'grid', placeItems: 'center',
            background: 'var(--overlay-invert-quiet)', color: 'var(--overlay-invert-ink)',
          }}>
            <PermIcon perm={request.permission} />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            {/* ⚠️ САЙТ ПЕРВОЙ СТРОКОЙ: решение принимается про него, а не про камеру. Раньше имя
                было спрятано внутрь пояснения мелким — то есть главное стояло вторым. */}
            <div style={{
              ...TEXT.caption, fontFamily: 'var(--font-mono)', letterSpacing: '0.04em',
              color: 'var(--overlay-invert-body)', marginBottom: sp(1),
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{host}</div>
            <div style={{
              ...DISPLAY, fontSize: 20, fontWeight: 700, letterSpacing: '-0.03em',
              lineHeight: 1.14, color: 'var(--overlay-invert-ink)', marginBottom: sp(2),
            }}>{PERM_TITLE[request.permission]}</div>
            <div style={{ ...TEXT.body, color: 'var(--overlay-invert-body)' }}>
              {PERM_HINT[request.permission]}
            </div>
          </div>
        </div>

        <label style={{
          display: 'flex', alignItems: 'center', gap: sp(2),
          ...TEXT.caption, color: 'var(--overlay-invert-body)',
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
            действия здесь нет, а пришёл человек чаще всего разрешить. Обе делят ширину: выбор
            равноправный. Крупные — в них перестаёшь промахиваться. */}
        <PopoverActions>
          <PrimaryButton stretch big onClick={() => onRespond(true, remember)}>Разрешить</PrimaryButton>
          <QuietButton stretch big invert onClick={() => onRespond(false, remember)}>Запретить</QuietButton>
        </PopoverActions>
      </PopoverCard>
    </div>
  );
}
