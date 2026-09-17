import { Check, FileUp, Loader2 } from 'lucide-react';
import type { ImportDataType, ImportRunResult, ImportSource } from '../../../shared/ipc';
import { sp, pad, CAPS, TEXT, DISPLAY, RADIUS, motion } from '../../styles/system';
import BrowserLogo from '../BrowserLogo';
import FirefoxPasswordPrompt from '../FirefoxPasswordPrompt';
import { islandPlate } from '../../styles/island';
import { Muted, resultLine, TYPE_LABELS, bigGhost } from './parts';
import { useLanguage } from '../../i18n';

/**
 * Тело шага переноса данных из другого браузера.
 *
 * ⚠️ Самый длинный шаг мастера и единственный, где человек что-то ВЫБИРАЕТ, а не читает. Вынесен
 * отдельно потому же, почему заведён хук useOnboarding: правка одного шага не должна требовать
 * прочитать остальные четыре.
 */
export function ImportStep({
  sources, selected, selectedId, checked, report, csvBusy, csvMsg,
  primaryPassword, needsPassword,
  selectSource, toggleType, handleCsvImport, setPrimaryPassword, handleRun,
}: {
  sources: ImportSource[] | null;
  selected: ImportSource | null;
  selectedId: string | null;
  checked: Set<ImportDataType>;
  report: ImportRunResult | null;
  csvBusy: boolean;
  csvMsg: string;
  primaryPassword: string;
  needsPassword: boolean;
  selectSource: (s: ImportSource) => void;
  toggleType: (t: ImportDataType) => void;
  handleCsvImport: () => void;
  setPrimaryPassword: (v: string) => void;
  handleRun: () => void;
}) {
  const { language, t } = useLanguage();
  return (
        <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: sp(3) }}>
          {sources === null ? (
            <Muted>{t('Ищем браузеры на компьютере…')}</Muted>
          ) : sources.length === 0 ? (
            <Muted>{t('Других браузеров с данными не нашлось — переносить нечего.')}</Muted>
          ) : (
            <>
              {/* ⚠️ ШИРОКИЕ СТРОКИ ВО ВСЮ ШИРИНУ, а не квадратные марки по центру. Прежние
                  карточки были узкими, стояли посередине и оставляли справа и снизу пустоту:
                  правая половина выглядела незаполненной, а сам выбор — мелким. Строка даёт
                  место для того, что человеку и нужно знать, — что именно переедет и сколько
                  записей. */}
              <span style={{ ...CAPS }}>{t('Нашли на этом компьютере')}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2) }}>
                {sources.map((source) => {
                  const active = source.id === selectedId;
                  return (
                    <button
                      key={source.id}
                      onClick={() => selectSource(source)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: sp(4), width: '100%',
                        padding: pad(4), borderRadius: RADIUS.content, cursor: 'default',
                        textAlign: 'left', background: active ? 'var(--surface)' : 'transparent',
                        // Выбранное — ЧЕРНИЛЬНАЯ кромка в два пикселя. Раньше это был акцент,
                        // но экран первого запуска — страница приложения, и обводка здесь
                        // означает «вот это», а не состояние хрома.
                        border: active ? '2px solid var(--text-strong)' : '2px solid var(--divider)',
                        transition: motion.state('border-color', 'background'),
                      }}
                    >
                      <BrowserLogo vendorId={source.id.split('::')[0]} label={source.label} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{
                          display: 'block', ...DISPLAY, fontSize: 20, fontWeight: 700,
                          letterSpacing: '-0.02em', color: 'var(--text-strong)',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{source.label}</span>
                        <span style={{ display: 'block', ...TEXT.body, color: 'var(--text-muted)', marginTop: sp(1) }}>
                          {source.dataTypes.map((type) => t(TYPE_LABELS[type]).toLowerCase()).join(', ')}
                        </span>
                      </span>
                      <span style={{
                        width: 24, height: 24, flex: 'none', borderRadius: RADIUS.control,
                        display: 'grid', placeItems: 'center',
                        background: active ? 'var(--text-strong)' : 'transparent',
                        border: active ? 'none' : '2px solid var(--divider-strong)',
                        color: 'var(--app-bg)',
                      }}>{active && <Check size={15} strokeWidth={3} />}</span>
                    </button>
                  );
                })}
              </div>

              {/* ⚠️ Что именно переносить — ОТДЕЛЬНОЙ строкой под списком, а не пилюлями по
                  центру экрана. Раньше они висели сами по себе и не были связаны ни с одним
                  из браузеров, хотя относятся к ВЫБРАННОМУ. */}
              {selected && !report && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: sp(2), marginTop: sp(2) }}>
                  <span style={{ ...CAPS }}>{t('Что перенести')}</span>
                  <div style={{ display: 'flex', gap: sp(2), flexWrap: 'wrap' }}>
                    {selected.dataTypes.map((type) => {
                      const on = checked.has(type);
                      return (
                        <button
                          key={type}
                          onClick={() => toggleType(type)}
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: sp(2),
                            padding: pad(2, 4), borderRadius: RADIUS.pill, cursor: 'default',
                            ...TEXT.body, fontWeight: 550,
                            background: on ? 'var(--text-strong)' : 'transparent',
                            color: on ? 'var(--app-bg)' : 'var(--text-muted)',
                            border: on ? '2px solid var(--text-strong)' : '2px solid var(--divider)',
                            transition: motion.state('background', 'color', 'border-color'),
                          }}
                        >
                          {on && <Check size={14} strokeWidth={3} />}
                          {t(TYPE_LABELS[type])}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {report && (
                <div style={{
                  ...islandPlate, borderRadius: RADIUS.content, padding: pad(4),
                  display: 'flex', flexDirection: 'column', gap: sp(2),
                }}>
                  {(Object.keys(report) as ImportDataType[]).map((type) => (
                    <div key={type} style={{ ...TEXT.body, color: 'var(--text-body)' }}>
                      ✅ {resultLine(type, report[type] ?? null, language)}
                    </div>
                  ))}
                </div>
              )}

              {/* Мастер-пароль Firefox — общий блок с диалогом импорта в настройках. */}
              {needsPassword && (
                <FirefoxPasswordPrompt
                  value={primaryPassword}
                  onChange={setPrimaryPassword}
                  onSubmit={handleRun}
                />
              )}

              {/* Пароли просили, но перенеслось ноль — почти всегда это v20 (App-Bound) свежего
                  Chrome, диском их не взять. Не бросаем человека с необъяснённым нулём, а прямо
                  здесь даём рабочий путь через CSV — иначе он уйдёт из мастера без паролей и не
                  поймёт почему.
                  ⚠️ Кроме случая с мастер-паролем Firefox: там причина другая, и совет про экспорт
                  из Chrome был бы прямым враньём — человек пошёл бы выполнять бессмысленные шаги. */}
              {report && !needsPassword && 'passwords' in report && (report.passwords?.inserted ?? 0) === 0 && (
                <div style={{
                  ...islandPlate, borderRadius: RADIUS.content, padding: pad(4),
                  display: 'flex', flexDirection: 'column', gap: sp(3),
                }}>
                  <span style={{ ...TEXT.body, color: 'var(--text-body)', lineHeight: 1.5 }}>
                    {language === 'ru' ? <>
                      Пароли современного Chrome зашифрованы и напрямую не переносятся. Экспортируйте
                      их в браузере (<b>Настройки → Пароли → ⋮ → Экспорт паролей</b>) и выберите
                      CSV-файл здесь.
                    </> : <>
                      Recent Chrome passwords cannot be imported directly because they are encrypted.
                      Export them in Chrome (<b>Settings → Password Manager → Export passwords</b>),
                      then choose the CSV file here.
                    </>}
                  </span>
                  <button
                    onClick={() => void handleCsvImport()}
                    disabled={csvBusy}
                    style={{ ...bigGhost, alignSelf: 'flex-start', padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: 7, opacity: csvBusy ? 0.5 : 1 }}
                  >
                    {csvBusy
                      ? <Loader2 size={15} style={{ animation: 'oblako-spin 1s linear infinite' }} />
                      : <FileUp size={15} />}
                    {t('Выбрать CSV-файл')}
                  </button>
                  {csvMsg && (
                    <span style={{ ...TEXT.body, color: 'var(--text-body)' }}>{t(csvMsg)}</span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
  );
}
