import { useEffect, useState } from 'react';
import type { UpdateStatus } from '../../../shared/ipc';
import { chromeCluster } from '../../styles/island';
import { useLanguage } from '../../i18n';

export function UpdateIndicator() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const { language } = useLanguage();
  useEffect(() => {
    let live = true;
    let received = false;
    const stop = window.oblako.onUpdateStatusChanged(s => { received = true; setStatus(s); });
    void window.oblako.getUpdateStatus().then(s => { if (live && !received) setStatus(s); });
    return () => { live = false; stop(); };
  }, []);
  if (!status || (status.kind !== 'downloading' && status.kind !== 'downloaded')) return null;
  const downloading = status.kind === 'downloading';
  const label = downloading
    ? `${language === 'en' ? 'Update' : 'Обновление'} ${status.percent}%`
    : language === 'en' ? 'Update ready' : 'Обновление готово';
  return (
    <button title={label} aria-label={label} onClick={() => void window.oblako.createSpecialTab('settings', 'browser')}
      style={{ ...chromeCluster(), position: 'relative', overflow: 'hidden', padding: '0 10px',
        border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 'var(--fs-xs)', whiteSpace: 'nowrap' }}>
      {label}
      {downloading && <span role="progressbar" aria-label={language === 'en' ? 'Browser update' : 'Обновление браузера'}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={status.percent}
        style={{ position: 'absolute', bottom: 0, left: 0, height: 2, width: `${status.percent}%`,
          background: 'var(--accent)', transition: 'width var(--dur-base)' }} />}
    </button>
  );
}
