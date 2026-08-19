import { useEffect, useMemo, useState } from 'react';
import { X, Download, Loader2, Check, KeyRound, FileUp } from 'lucide-react';
import type { ImportSource, ImportDataType, ImportRunResult, ImportTypeResult, CsvPasswordImport } from '../../shared/ipc';
import { islandPlate, untintedPlateVars } from '../styles/island';
import { btnPrimary, btnGhost } from './settings/kit';
import { RADIUS } from '../styles/system';

// Диалог импорта данных из другого браузера. Открывается ТОЛЬКО из раздела настроек «Браузер»:
// первый запуск ведёт свой экран (см. src/components/Onboarding.tsx), с другим тоном и объёмом. Вся вендор-специфика — в main;
// здесь только выбор источника, выбор типов данных галочками и отчёт. Модалка поверх всего chrome
// (fixed) — вызывается только когда контент-область не перекрыта WebContentsView (Настройки/Хаб).

interface ImportDialogProps {
  onClose: () => void;
}

const TYPE_LABELS: Record<ImportDataType, string> = {
  bookmarks: 'Закладки',
  history: 'История',
  passwords: 'Пароли',
};

// Человекочитаемая строка результата по одному типу. unsupported выносим отдельно — это не «уже
// были» (skipped), а «физически нельзя перенести» (напр. пароли с App-Bound-шифрованием).
function resultLine(type: ImportDataType, res: ImportTypeResult | null): string {
  const label = TYPE_LABELS[type];
  if (res === null) return `${label}: не удалось прочитать`;
  const parts = [`добавлено ${res.inserted}`];
  if (res.skipped > 0) parts.push(`пропущено (уже были) ${res.skipped}`);
  if (res.unsupported && res.unsupported > 0) parts.push(`не поддержано ${res.unsupported}`);
  return `${label}: ${parts.join(', ')}`;
}

// Человекочитаемый итог импорта паролей из CSV. status 'canceled' сюда не доходит — его гасит
// handleCsv (отмена диалога не результат).
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

export default function ImportDialog({ onClose }: ImportDialogProps) {
  const [sources, setSources] = useState<ImportSource[] | null>(null); // null — ещё грузим
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Выбранные типы для текущего источника. Ключ — sourceId, чтобы смена источника не тащила
  // чужой набор галочек. По умолчанию отмечены все доступные типы источника.
  const [checked, setChecked] = useState<Set<ImportDataType>>(new Set());
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ImportRunResult | null>(null);
  // Импорт паролей из CSV — свой путь, свой прогресс и свой результат (см. handleCsv).
  const [csvRunning, setCsvRunning] = useState(false);
  const [csvResult, setCsvResult] = useState<CsvPasswordImport | null>(null);

  useEffect(() => {
    let mounted = true;
    void window.oblako.listImportSources().then((list) => {
      if (!mounted) return;
      setSources(list);
      if (list.length > 0) selectSource(list[0]!);
    });
    return () => { mounted = false; };
  }, []);

  const selected = useMemo(
    () => sources?.find((s) => s.id === selectedId) ?? null,
    [sources, selectedId],
  );

  function selectSource(source: ImportSource) {
    setSelectedId(source.id);
    setChecked(new Set(source.dataTypes)); // по умолчанию — всё, что источник умеет отдать
    setReport(null);
  }

  function toggleType(type: ImportDataType) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  }

  async function handleRun() {
    if (!selected || checked.size === 0 || running) return;
    setRunning(true);
    setReport(null);
    try {
      const types = selected.dataTypes.filter((t) => checked.has(t)); // порядок и валидность — от источника
      const result = await window.oblako.runImport(selected.id, types);
      setReport(result);
    } finally {
      setRunning(false);
    }
  }

  async function handleCsv() {
    if (csvRunning) return;
    setCsvRunning(true);
    try {
      const res = await window.oblako.importPasswordsCsv();
      // Отмена диалога выбора файла — не результат, ничего не показываем.
      setCsvResult(res.status === 'canceled' ? null : res);
    } finally {
      setCsvRunning(false);
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'var(--scrim, rgba(0,0,0,0.4))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 440, maxWidth: 'calc(100vw - 48px)', maxHeight: 'calc(100vh - 96px)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          ...islandPlate,
          borderRadius: 'var(--radius-island)',
          boxShadow: 'var(--shadow-island)',
          ...untintedPlateVars,
          background: 'var(--surface-solid)',
        }}
      >
        {/* Шапка */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '16px 20px',
          borderBottom: '1px solid var(--divider-strong)', flex: 'none',
        }}>
          <Download size={16} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
          <span style={{ fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-strong)', flex: 1 }}>
            Импорт из другого браузера
          </span>
          <button
            onClick={onClose}
            style={{
              border: 'none', background: 'transparent', cursor: 'default', padding: 6,
              borderRadius: 'var(--radius-sm)', color: 'var(--text-faint)', display: 'inline-flex',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          ><X size={16} /></button>
        </div>

        {/* Тело */}
        <div style={{ padding: '18px 20px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {sources === null ? (
            <div style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>Поиск браузеров…</div>
          ) : sources.length === 0 ? (
            <div style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>
              Ни один браузер с данными не найден на этом компьютере.
            </div>
          ) : (
            <>
              {/* Выбор источника */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 'var(--ls-caps)' }}>
                  Откуда
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {sources.map((source) => {
                    const active = source.id === selectedId;
                    return (
                      <button
                        key={source.id}
                        onClick={() => selectSource(source)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                          padding: '9px 12px', borderRadius: 'var(--radius-sm)', border: 'none',
                          background: active ? 'var(--surface)' : 'transparent',
                          boxShadow: active ? 'var(--shadow-card)' : 'none',
                          color: 'var(--text-strong)', cursor: 'default',
                          fontSize: 'var(--fs-sm)', fontWeight: active ? 600 : 400,
                        }}
                        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--surface-hover)'; }}
                        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                      >
                        <span style={{
                          width: 22, height: 22, borderRadius: 'var(--radius-sm)', flexShrink: 0,
                          background: 'var(--neutral-300)', color: 'var(--text-body)',
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 'var(--fs-xs)', fontWeight: 700,
                        }}>{source.label.charAt(0)}</span>
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {source.label}
                        </span>
                        {active && <Check size={15} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Выбор типов данных */}
              {selected && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontSize: 'var(--fs-xs)', fontWeight: 600, color: 'var(--text-faint)', textTransform: 'uppercase', letterSpacing: 'var(--ls-caps)' }}>
                    Что перенести
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {selected.dataTypes.map((type) => {
                      const on = checked.has(type);
                      return (
                        <button
                          key={type}
                          onClick={() => toggleType(type)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                            padding: '9px 12px', borderRadius: 'var(--radius-sm)', border: 'none',
                            background: 'transparent', color: 'var(--text-body)', cursor: 'default',
                            fontSize: 'var(--fs-sm)',
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
                          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                        >
                          <span style={{
                            width: 18, height: 18, borderRadius: RADIUS.tight, flexShrink: 0,
                            border: on ? 'none' : '1.5px solid var(--divider-strong)',
                            background: on ? 'var(--accent)' : 'transparent',
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {on && <Check size={13} style={{ color: '#fff' }} />}
                          </span>
                          {TYPE_LABELS[type]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Отчёт */}
              {report && (
                <div style={{
                  ...islandPlate, borderRadius: 'var(--radius-sm)', padding: '12px 14px',
                  display: 'flex', flexDirection: 'column', gap: 4,
                }}>
                  {(Object.keys(report) as ImportDataType[]).map((type) => (
                    <div key={type} style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)' }}>
                      {resultLine(type, report[type] ?? null)}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Пароли из CSV — отдельный путь, всегда доступен. Chrome 127+ шифрует пароли схемой,
              которую с диска не прочитать (см. shared/csvPasswords.ts), поэтому единственный
              честный способ перенести их — экспорт CSV из самого браузера. */}
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
              onClick={() => void handleCsv()}
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
        </div>

        {/* Подвал */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px',
          borderTop: '1px solid var(--divider-strong)', flex: 'none',
        }}>
          <div style={{ flex: 1 }} />
          <button style={btnGhost} onClick={onClose}>
            Закрыть
          </button>
          {sources && sources.length > 0 && !report && (
            <button
              style={{ ...btnPrimary, opacity: (checked.size === 0 || running) ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', gap: 8 }}
              onClick={() => void handleRun()}
            >
              {running && <Loader2 size={14} style={{ animation: 'oblako-spin 1s linear infinite' }} />}
              Импортировать
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
