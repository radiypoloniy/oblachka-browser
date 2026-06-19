import { AlertTriangle, WifiOff, Globe, RotateCcw } from 'lucide-react';
import type { TabErrorState } from '../../shared/ipc';

interface Props {
  error: TabErrorState;
  url: string;
  onRetry: () => void;
}

function errorInfo(error: TabErrorState): { Icon: typeof Globe; title: string; detail: string } {
  if (error.type === 'crash') {
    return { Icon: AlertTriangle, title: 'Вкладка упала', detail: 'Рендер-процесс завершился неожиданно.' };
  }
  switch (error.code) {
    case -105: return { Icon: Globe, title: 'Не удалось найти сервер', detail: `DNS не нашёл адрес для ${new URL(error.url).hostname}.` };
    case -106: return { Icon: WifiOff, title: 'Нет подключения к интернету', detail: 'Проверьте сетевой кабель или Wi-Fi.' };
    case -200:
    case -201:
    case -202: return { Icon: AlertTriangle, title: 'Ошибка безопасности', detail: `Сертификат сервера недействителен (код ${error.code}).` };
    default:   return { Icon: AlertTriangle, title: 'Не удалось открыть страницу', detail: `Код ошибки: ${error.code}.` };
  }
}

export default function TabError({ error, url, onRetry }: Props) {
  const { Icon, title, detail } = errorInfo(error);
  const displayUrl = url.length > 60 ? url.slice(0, 57) + '…' : url;

  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--app-bg)',
    }}>
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12,
        padding: '32px 40px',
        background: 'var(--surface)',
        backdropFilter: 'var(--glass-filter)',
        WebkitBackdropFilter: 'var(--glass-filter)',
        borderRadius: 'var(--radius-card)',
        boxShadow: 'var(--shadow-card)',
        border: '1px solid var(--glass-edge)',
        maxWidth: 420, textAlign: 'center',
      }}>
        <Icon size={36} color="var(--text-faint)" strokeWidth={1.5} />
        <p style={{ margin: 0, fontSize: 'var(--fs-lg)', fontWeight: 600, color: 'var(--text-strong)' }}>
          {title}
        </p>
        <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {detail}
        </p>
        {url && (
          <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', wordBreak: 'break-all' }}>
            {displayUrl}
          </p>
        )}
        <button
          onClick={onRetry}
          style={{
            marginTop: 4,
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 20px',
            background: 'var(--accent)',
            color: '#fff',
            border: 'none',
            borderRadius: 'calc(var(--radius-card) / 2)',
            fontSize: 'var(--fs-sm)',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          <RotateCcw size={14} strokeWidth={2} />
          Повторить
        </button>
      </div>
    </div>
  );
}
