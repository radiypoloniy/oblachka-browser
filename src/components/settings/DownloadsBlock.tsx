import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import Toggle from '../Toggle';
import { StatusCard } from './kit';

// Блок «Загрузки» в разделе «Браузер».
//
// ⚠️ Тумблер выключен по умолчанию, и это главное изменение: раньше системный диалог «Сохранить
// как» открывался на КАЖДЫЙ файл — на картинку с фотостока в том числе. Теперь файл сразу едет
// в папку загрузок, а спросить браузер по-прежнему может, если человек этого хочет.
export default function DownloadsBlock() {
  const [ask, setAsk] = useState(false);

  useEffect(() => { void window.oblako.getAskDownloadLocation().then(setAsk); }, []);

  function toggle(value: boolean) {
    setAsk(value);
    void window.oblako.setAskDownloadLocation(value);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <label style={{
        display: 'flex', alignItems: 'center', gap: 12, cursor: 'default',
      }}>
        <Toggle checked={ask} onChange={() => toggle(!ask)} />
        <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-strong)' }}>
            Спрашивать, куда сохранять каждый файл
          </span>
          <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
            Выключено — файлы сразу попадают в папку «Загрузки», а прогресс виден в панели загрузок.
          </span>
        </span>
      </label>

      <StatusCard
        icon={<ShieldCheck size={20} style={{ color: 'var(--success-500)' }} />}
        title="Скачанные файлы помечаются как пришедшие из интернета"
        subtitle="Windows проверяет такие файлы при запуске, а документы Office открывает в защищённом просмотре. Программы и скрипты браузер спрашивает отдельно — даже когда выбор папки выключен."
      />
    </div>
  );
}
