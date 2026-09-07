import { KeyRound, FileUp, Loader2 } from 'lucide-react';
import type { CsvPasswordImport } from '../../shared/ipc';
import { islandPlate } from '../styles/island';
import { btnGhost } from './settings/kit';

// Перенос паролей из CSV-экспорта другого браузера — нижняя секция диалога импорта.
//
// ⚠️ Отдельным путём от чтения профиля с диска, и это не дубль. Chrome с версии 127 шифрует пароли
// схемой App-Bound: ключ завёрнут вторым слоем в SYSTEM-DPAPI, и снять его без прав SYSTEM либо
// инъекции в процесс браузера нельзя (см. shared/csvPasswords.ts). Санкционированный Google путь —
// экспорт из самого браузера, его и предлагаем. У Firefox такого слоя нет, его пароли читаются
// прямо из профиля (см. electron/browserImport/firefoxCrypto.ts), и эта секция ему не нужна —
// но она остаётся общей: человек не обязан знать, у какого браузера какая схема.

// Человекочитаемый итог. status 'canceled' сюда не доходит — его гасит вызывающая сторона
// (отмена диалога выбора файла не результат).
function csvResultLine(res: Exclude<CsvPasswordImport, { status: 'canceled' }>): string {
  switch (res.status) {
    case 'ok': {
      const parts = [`добавлено ${res.inserted}`];
      if (res.skipped > 0) parts.push(`пропущено (уже были) ${res.skipped}`);
      return `Пароли из CSV: ${parts.join(', ')}`;
    }
    case 'empty':             return 'В файле не нашлось паролей — это точно CSV-экспорт паролей из браузера?';
    case 'read-error':        return 'Не удалось прочитать файл.';
    case 'vault-unavailable': return 'Хранилище паролей на этом компьютере недоступно.';
  }
}

interface Props {
  running: boolean;
  result: CsvPasswordImport | null;
  onPick: () => void;
}

export default function ImportCsvSection({ running: csvRunning, result: csvResult, onPick: handleCsv }: Props) {
  return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 4, borderTop: '1px solid var(--divider)' }}>
        <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 'var(--ls-caps)' }}>
          Пароли из файла
        </span>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <KeyRound size={16} style={{ color: 'var(--text-muted)', flexShrink: 0, marginTop: 2 }} />
          <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)', lineHeight: 1.5 }}>
            Пароли современного Chrome зашифрованы и с диска не переносятся. Экспортируйте их в
            самом браузере: <b>Настройки → Пароли → ⋮ → Экспорт паролей</b> — и выберите
            полученный CSV-файл здесь.
          </span>
        </div>
        <button
          onClick={handleCsv}
          style={{
            ...btnGhost, alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 8,
            opacity: csvRunning ? 0.5 : 1,
          }}
        >
          {csvRunning
            ? <Loader2 size={14} style={{ animation: 'oblako-spin 1s linear infinite' }} />
            : <FileUp size={14} />}
          Выбрать CSV-файл
        </button>
        {csvResult && csvResult.status !== 'canceled' && (
          <div style={{ ...islandPlate, borderRadius: 'var(--radius-sm)', padding: '10px 14px' }}>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)' }}>
              {csvResultLine(csvResult)}
            </div>
            {csvResult.status === 'ok' && csvResult.inserted > 0 && (
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 4 }}>
                Удалите CSV-файл после импорта — пароли в нём лежат открытым текстом.
              </div>
            )}
          </div>
        )}
      </div>
  );
}
