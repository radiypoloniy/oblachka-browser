import { useEffect, useState } from 'react';
import { RefreshCw, Download, RotateCcw, CheckCircle2, AlertCircle } from 'lucide-react';
import { StatusCard, btnPrimary, btnGhost, InlineHint } from './kit';
import type { UpdateStatus } from '../../../shared/ipc';
import { RADIUS } from '../../styles/system';
import { useLanguage } from '../../i18n';

// Блок «Обновления» раздела «Браузер». Только рисует то, что прислал main (см. CLAUDE.md —
// компоненты без бизнес-логики): вся механика в electron/UpdateManager.ts, сюда приходит
// готовый UpdateStatus, отсюда уходят три команды без параметров.

function formatChecked(ts: number | null, language: 'en' | 'ru'): string | null {
  if (ts === null) return null;
  const mins = Math.floor((Date.now() - ts) / 60_000);
  if (mins < 1) return language === 'en' ? 'just now' : 'только что';
  if (mins < 60) return language === 'en' ? `${mins} min ago` : `${mins} мин назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return language === 'en' ? `${hours} hr ago` : `${hours} ч назад`;
  return new Date(ts).toLocaleDateString(language === 'en' ? 'en-US' : 'ru-RU');
}

export default function UpdatesBlock() {
  const { language, t } = useLanguage();
  const [st, setSt] = useState<UpdateStatus | null>(null);

  useEffect(() => {
    // invoke на монтировании + подписка: между стартом main и открытием настроек статус мог
    // уже смениться (стартовая проверка идёт через 20 с), одной подпиской его не поймать.
    void window.oblako.getUpdateStatus().then(setSt);
    return window.oblako.onUpdateStatusChanged(setSt);
  }, []);

  if (!st) return null;

  const busy = st.kind === 'checking' || st.kind === 'downloading';

  // Иконка слева — единственный носитель «настроения» блока; текст ниже её дублирует словами.
  const icon = st.kind === 'error'
    ? <AlertCircle size={20} style={{ color: 'var(--danger-500)' }} />
    : st.kind === 'downloaded' || st.kind === 'available'
      ? <Download size={20} style={{ color: 'var(--accent)' }} />
      : st.kind === 'not-available'
        ? <CheckCircle2 size={20} style={{ color: 'var(--dot-local)' }} />
        : <RefreshCw size={20} style={{ color: 'var(--text-muted)' }} />;

  let title: string;
  let subtitle: React.ReactNode;
  let actions: React.ReactNode = null;

  switch (st.kind) {
    case 'disabled':
      title = language === 'en' ? `Version ${st.currentVersion}` : `Версия ${st.currentVersion}`;
      subtitle = t('Обновления работают только в установленной версии браузера.');
      break;
    case 'checking':
      title = t('Проверяем обновления…');
      subtitle = language === 'en' ? `Current version: ${st.currentVersion}` : `Текущая версия ${st.currentVersion}`;
      break;
    case 'available':
      title = language === 'en' ? `Version ${st.newVersion} is available` : `Доступна версия ${st.newVersion}`;
      subtitle = language === 'en' ? `You have ${st.currentVersion}. Downloading starts only when you choose.` : `Сейчас установлена ${st.currentVersion}. Загрузка начнётся только по вашей команде.`;
      actions = <button style={btnPrimary} onClick={() => window.oblako.downloadUpdate()}>{t('Скачать')}</button>;
      break;
    case 'downloading':
      title = language === 'en' ? `Downloading version ${st.newVersion}…` : `Загрузка версии ${st.newVersion}…`;
      subtitle = `${st.percent}%`;
      break;
    case 'downloaded':
      title = language === 'en' ? `Version ${st.newVersion} is ready to install` : `Версия ${st.newVersion} готова к установке`;
      subtitle = t('Браузер закроется, установит обновление и запустится снова.');
      actions = (
        <button style={btnPrimary} onClick={() => window.oblako.installUpdate()}>
          <RotateCcw size={14} style={{ marginRight: 6, verticalAlign: -2 }} />
          {t('Перезапустить')}
        </button>
      );
      break;
    case 'error':
      title = t('Не удалось проверить обновления');
      subtitle = st.error;
      actions = <button style={btnGhost} onClick={() => window.oblako.checkForUpdate()}>{t('Повторить')}</button>;
      break;
    case 'not-available':
    case 'idle':
    default: {
      const checked = formatChecked(st.lastCheckedAt, language);
      title = st.kind === 'not-available' ? t('Установлена последняя версия') : (language === 'en' ? `Version ${st.currentVersion}` : `Версия ${st.currentVersion}`);
      subtitle = st.kind === 'not-available'
        ? (language === 'en' ? `Version ${st.currentVersion}${checked ? ` · checked ${checked}` : ''}` : `Версия ${st.currentVersion}${checked ? ` · проверено ${checked}` : ''}`)
        : t('Проверка обновлений ещё не выполнялась.');
      actions = (
        <button style={btnGhost} disabled={busy} onClick={() => window.oblako.checkForUpdate()}>
          {t('Проверить')}
        </button>
      );
      break;
    }
  }

  return (
    <>
      <StatusCard icon={icon} title={title} subtitle={subtitle} actions={actions} />
      {st.kind === 'downloading' && (
        // Полоса прогресса отдельным элементом, а не внутри карточки: StatusCard — общий
        // примитив набора, расширять его ради одного потребителя не стоит.
        <div style={{
          height: 4, borderRadius: RADIUS.tight, background: 'var(--surface-sunken)', overflow: 'hidden', marginTop: 8,
        }}>
          <div style={{ height: '100%', width: `${st.percent}%`, background: 'var(--accent)', transition: 'width .2s' }} />
        </div>
      )}
      {st.kind === 'disabled' && (
        <div style={{ marginTop: 8 }}>
          <InlineHint>{t('Запущена сборка для разработки — обновляться нечему.')}</InlineHint>
        </div>
      )}
    </>
  );
}
