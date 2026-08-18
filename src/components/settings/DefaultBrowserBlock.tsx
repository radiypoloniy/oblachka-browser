import { useEffect, useState } from 'react';
import { Check, ExternalLink, Globe } from 'lucide-react';
import { StatusCard, btnPrimary } from './kit';

// Блок «Браузер по умолчанию» в разделе «Браузер».
//
// ⚠️ Кнопка честно называется «Открыть настройки Windows», а не «Сделать по умолчанию»: назначить
// себя программно система не даёт (подробности — в electron/DefaultBrowser.ts), и кнопка с таким
// названием обманывала бы — человек нажал бы её и не понял, почему ничего не изменилось.

export default function DefaultBrowserBlock() {
  const [isDefault, setIsDefault] = useState<boolean | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const refresh = () => { void window.oblako.isDefaultBrowser().then(setIsDefault); };

  useEffect(() => {
    refresh();
    // Человек уходит в системные настройки и возвращается в окно — самое время перепроверить,
    // выбрал ли он нас. Опроса по таймеру нет: событие возврата фокуса точнее и дешевле.
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);

  async function handleRequest() {
    const result = await window.oblako.requestDefaultBrowser();
    if (result === 'already') { setHint(null); refresh(); return; }
    if (result === 'unsupported') {
      setHint('В режиме разработки Windows не покажет Oblako в списке — проверяйте на установленной сборке.');
      return;
    }
    setHint('Открылись «Приложения по умолчанию». Найдите там пункт «Браузер» и выберите Oblako.');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <StatusCard
        icon={<Globe size={20} style={{ color: isDefault ? 'var(--success-500)' : 'var(--text-faint)' }} />}
        title={isDefault === null ? 'Проверяем…' : isDefault ? 'Oblako — браузер по умолчанию' : 'Ссылки открывает другой браузер'}
        subtitle={isDefault
          ? 'Ссылки из почты, мессенджеров и документов открываются здесь.'
          : 'Windows не разрешает программам назначать себя самим — выбрать нас нужно в системном окне.'}
      />
      {!isDefault && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            style={{ ...btnPrimary, display: 'inline-flex', alignItems: 'center', gap: 8 }}
            onClick={() => void handleRequest()}
          >
            <ExternalLink size={15} /> Открыть настройки Windows
          </button>
          {hint && (
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', flex: '1 1 240px' }}>
              {hint}
            </span>
          )}
        </div>
      )}
      {isDefault && hint === null && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
          <Check size={13} style={{ color: 'var(--success-500)' }} /> Ничего делать не нужно.
        </span>
      )}
    </div>
  );
}
