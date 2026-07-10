import { useEffect, useRef, useState } from 'react';
import { X, Shield, ShieldOff, Wifi, Cpu, Palette, Plus, Trash2, RotateCcw, KeyRound, Check, Lock, Eye, EyeOff, Copy, Pencil, RefreshCw, Download, Upload, type LucideIcon } from 'lucide-react';
import type { AdBlockState, BackfillProgress, HistoryContentCoverage, PasswordMeta, PasswordCopyField } from '../../shared/ipc';
import { islandPlate } from '../styles/island';

interface SettingsProps {
  onClose: () => void;
}

// Секции левого меню — «Блокировка» и «AI» рабочие, VPN/Интерфейс — placeholder для будущих
// этапов. soon — единственный флаг, гоняющий и активность, и клик, и стиль (см. рендер-цикл
// ниже) — точечно снят только у 'ai', остальные пункты и их поведение не тронуты.
type NavItem = { id: string; label: string; Icon: LucideIcon; soon?: boolean };
const NAV_ITEMS: NavItem[] = [
  { id: 'adblock',    label: 'Блокировка', Icon: Shield },
  { id: 'vpn',        label: 'VPN',         Icon: Wifi,    soon: true },
  { id: 'ai',         label: 'AI',          Icon: Cpu },
  { id: 'passwords',  label: 'Пароли',      Icon: Lock },
  { id: 'appearance', label: 'Интерфейс',   Icon: Palette, soon: true },
];
type SectionId = 'adblock' | 'vpn' | 'ai' | 'passwords' | 'appearance';

export default function Settings({ onClose }: SettingsProps) {
  const [section, setSection] = useState<SectionId>('adblock');
  const [state, setState] = useState<AdBlockState | null>(null);
  const [domainInput, setDomainInput] = useState('');
  const [inputError, setInputError] = useState('');
  // 'all' → перезагрузить все; string → перезагрузить только этот домен; null → нет pending
  const [pendingReload, setPendingReload] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Подписываемся на push-обновления из main (счётчик, whitelist, enabled)
  useEffect(() => {
    let mounted = true;
    window.oblako.getAdBlockState().then((s) => { if (mounted) setState(s); });
    const unsub = window.oblako.onAdBlockStateChanged((s) => { if (mounted) setState(s); });
    return () => { mounted = false; unsub(); };
  }, []);

  function handleToggle() {
    if (!state) return;
    void window.oblako.setAdBlockEnabled(!state.enabled);
    setPendingReload('all');
  }

  function handleAddDomain() {
    const raw = domainInput.trim();
    if (!raw) return;
    // Базовая проверка на что-то похожее на домен
    const cleaned = raw.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0]!;
    if (!cleaned || !cleaned.includes('.')) {
      setInputError('Введите домен, например: reddit.com');
      return;
    }
    setInputError('');
    void window.oblako.adBlockAddDomain(raw);
    setDomainInput('');
    setPendingReload(cleaned.toLowerCase());
    inputRef.current?.focus();
  }

  function handleRemoveDomain(domain: string) {
    void window.oblako.adBlockRemoveDomain(domain);
    setPendingReload(domain);
  }

  function handleReload() {
    if (pendingReload === null) return;
    void window.oblako.adBlockReloadTabs(pendingReload === 'all' ? undefined : pendingReload);
    setPendingReload(null);
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      overflow: 'hidden',
      // Тот же "остров", что у сайдбара (Sidebar.tsx::asideBase) — см. подробный комментарий
      // в History.tsx (тот же приём). Отступ по периметру не здесь — уже даёт contentRef margin
      // в App.tsx.
      ...islandPlate,
      borderRadius: 'var(--radius-island)',
      boxShadow: 'var(--shadow-island)',
      background: 'var(--surface-solid)',
    }}>
      {/* Шапка */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '18px 24px',
        borderBottom: '1px solid var(--divider-strong)', flex: 'none',
      }}>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 700, color: 'var(--text-strong)', flex: 1 }}>
          Настройки
        </span>
        <button
          onClick={onClose}
          style={{
            border: 'none', background: 'transparent', cursor: 'default', padding: 6,
            borderRadius: 'var(--radius-sm)', color: 'var(--text-faint)', display: 'inline-flex',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        ><X size={18} /></button>
      </div>

      {/* Тело: левое меню + контент */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* Левая навигация */}
        <nav style={{
          width: 200, flex: 'none', borderRight: '1px solid var(--divider-strong)',
          padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2,
        }}>
          {NAV_ITEMS.map(({ id, label, Icon, soon }) => {
            const active = section === id && !soon;
            return (
              <button
                key={id}
                disabled={!!soon}
                onClick={() => { if (!soon) setSection(id as SectionId); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '9px 12px', borderRadius: 'var(--radius-sm)', border: 'none',
                  background: active ? 'var(--surface)' : 'transparent',
                  boxShadow: active ? 'var(--shadow-card)' : 'none',
                  color: soon ? 'var(--text-faint)' : active ? 'var(--text-strong)' : 'var(--text-body)',
                  cursor: soon ? 'default' : 'default',
                  fontWeight: active ? 600 : 400,
                  fontSize: 'var(--fs-sm)',
                  textAlign: 'left', width: '100%',
                  opacity: soon ? 0.45 : 1,
                }}
                onMouseEnter={(e) => { if (!active && !soon) e.currentTarget.style.background = 'var(--surface-hover)'; }}
                onMouseLeave={(e) => { if (!active && !soon) e.currentTarget.style.background = 'transparent'; }}
              >
                <Icon size={15} />
                {label}
                {soon && (
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-faint)', fontWeight: 400 }}>
                    скоро
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Контент выбранной секции */}
        <div style={{ flex: 1, overflow: 'auto', padding: '24px 32px' }}>
          {section === 'adblock' && (
            <AdBlockSection
              state={state}
              domainInput={domainInput}
              inputError={inputError}
              pendingReload={pendingReload}
              inputRef={inputRef}
              onToggle={handleToggle}
              onDomainChange={(v) => { setDomainInput(v); setInputError(''); }}
              onAddDomain={handleAddDomain}
              onRemoveDomain={handleRemoveDomain}
              onReload={handleReload}
              onDismissReload={() => setPendingReload(null)}
            />
          )}
          {section === 'ai' && <AiSection />}
          {section === 'passwords' && <PasswordsSection />}
        </div>
      </div>
    </div>
  );
}

// ── Секция «Блокировка рекламы» ───────────────────────────────────────────────

interface AdBlockSectionProps {
  state: AdBlockState | null;
  domainInput: string;
  inputError: string;
  pendingReload: string | null;
  inputRef: React.RefObject<HTMLInputElement>;
  onToggle: () => void;
  onDomainChange: (v: string) => void;
  onAddDomain: () => void;
  onRemoveDomain: (domain: string) => void;
  onReload: () => void;
  onDismissReload: () => void;
}

function AdBlockSection({
  state, domainInput, inputError, pendingReload, inputRef,
  onToggle, onDomainChange, onAddDomain, onRemoveDomain, onReload, onDismissReload,
}: AdBlockSectionProps) {
  if (!state) {
    return <div style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>Загрузка…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-strong)' }}>
          Блокировка рекламы и трекеров
        </h2>
        <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
          Фильтрует рекламу и трекеры через EasyList / EasyPrivacy.
          Работает на уровне сетевых запросов — быстрее расширений браузера.
        </p>
      </div>

      {/* Уведомление о перезагрузке */}
      {pendingReload !== null && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
          ...islandPlate,
          borderRadius: 'var(--radius-sm)', fontSize: 'var(--fs-sm)',
        }}>
          <RotateCcw size={15} style={{ color: 'var(--accent)', flex: 'none' }} />
          <span style={{ flex: 1, color: 'var(--text-body)' }}>
            {pendingReload === 'all'
              ? 'Обновить открытые вкладки, чтобы применить изменения?'
              : `Обновить вкладки ${pendingReload}?`}
          </span>
          <button onClick={onReload} style={btnPrimary}>Обновить</button>
          <button onClick={onDismissReload} style={btnGhost}>Позже</button>
        </div>
      )}

      {/* Тумблер */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px',
        ...islandPlate,
        borderRadius: 'var(--radius-sm)',
      }}>
        {state.enabled
          ? <Shield size={22} style={{ color: 'var(--accent)', flex: 'none' }} />
          : <ShieldOff size={22} style={{ color: 'var(--text-faint)', flex: 'none' }} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
            {state.enabled ? 'Блокировка включена' : 'Блокировка выключена'}
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2 }}>
            Заблокировано за сессию: {state.sessionBlockCount.toLocaleString('ru')}
          </div>
        </div>
        <Toggle checked={state.enabled} onChange={onToggle} />
      </div>

      {/* Исключения */}
      <div>
        <div style={{
          fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: 'var(--ls-caps)',
          textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8,
        }}>
          Исключения
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
          На этих сайтах реклама блокироваться не будет.
          Домен покрывает и все поддомены (например, www.example.com).
        </p>

        {/* Список исключений */}
        {state.whitelist.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
            {state.whitelist.map((domain) => (
              <div key={domain} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                borderRadius: 'var(--radius-sm)', background: 'var(--surface)',
              }}>
                <span style={{ flex: 1, fontSize: 'var(--fs-sm)', color: 'var(--text-body)', fontFamily: 'monospace' }}>
                  {domain}
                </span>
                <button
                  onClick={() => onRemoveDomain(domain)}
                  title="Убрать из исключений"
                  style={{
                    border: 'none', background: 'transparent', cursor: 'default', padding: 4,
                    borderRadius: 4, display: 'inline-flex', color: 'var(--text-faint)', flex: 'none',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-body)'; e.currentTarget.style.background = 'var(--surface-hover)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-faint)'; e.currentTarget.style.background = 'transparent'; }}
                ><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}

        {/* Добавить домен */}
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <input
              ref={inputRef}
              type="text"
              value={domainInput}
              placeholder="example.com"
              onChange={(e) => onDomainChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onAddDomain(); }}
              style={{
                padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                border: inputError ? '1.5px solid var(--error, #e05)' : '1.5px solid var(--divider-strong)',
                background: 'var(--surface)', color: 'var(--text-strong)',
                fontSize: 'var(--fs-sm)', outline: 'none',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = inputError ? 'var(--error, #e05)' : 'var(--divider-strong)')}
            />
            {inputError && (
              <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--error, #e05)' }}>{inputError}</span>
            )}
          </div>
          <button onClick={onAddDomain} style={{ ...btnPrimary, alignSelf: 'flex-start', display: 'flex', gap: 6, alignItems: 'center' }}>
            <Plus size={14} /> Добавить
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Секция «AI» — ключ Gemini для фактчека ────────────────────────────────────
// Шаг 2 захода D: UI + IPC-проводка. Хранение ключа на этом шаге — только в памяти main-процесса
// (см. AiKeyStore.ts) — persist через safeStorage добавляется отдельным коммитом (шаг 3), поэтому
// «подключено» здесь не переживёт перезапуск браузера ДО того коммита — это ожидаемо на этом шаге.
function AiSection() {
  const [connected, setConnected] = useState<boolean | null>(null); // null = ещё грузим статус
  const [keyInput, setKeyInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    let mounted = true;
    window.oblako.getAiKeyStatus().then((v) => { if (mounted) setConnected(v); });
    const unsub = window.oblako.onAiKeyStatusChanged((v) => { if (mounted) setConnected(v); });
    return () => { mounted = false; unsub(); };
  }, []);

  async function handleSave() {
    const key = keyInput.trim();
    if (!key) { setSaveError('Введите ключ'); return; }
    setSaving(true);
    setSaveError('');
    const ok = await window.oblako.saveAiKey(key);
    setSaving(false);
    if (ok) setKeyInput(''); else setSaveError('Не удалось сохранить ключ');
  }

  async function handleDelete() {
    await window.oblako.deleteAiKey();
  }

  if (connected === null) {
    return <div style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>Загрузка…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-strong)' }}>
          AI — фактчек
        </h2>
        <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
          Ключ Gemini нужен для фактчека в AI-панели — проверки утверждений страницы по реальным
          источникам в интернете. Хранится зашифрованным, не в виде обычного текста.
        </p>
      </div>

      {/* Статус */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16, padding: '16px 20px',
        ...islandPlate,
        borderRadius: 'var(--radius-sm)',
      }}>
        {connected
          ? <Check size={22} style={{ color: 'var(--system)', flex: 'none' }} />
          : <KeyRound size={22} style={{ color: 'var(--text-faint)', flex: 'none' }} />}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
            {connected ? 'Подключено' : 'Не подключено'}
          </div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2 }}>
            {connected
              ? 'Ключ Gemini сохранён — кнопка фактчека доступна в AI-панели.'
              : 'Добавьте ключ, чтобы включить фактчек в AI-панели.'}
          </div>
        </div>
        {connected && (
          <button onClick={() => void handleDelete()} style={{ ...btnGhost, display: 'flex', gap: 6, alignItems: 'center' }}>
            <Trash2 size={14} /> Удалить
          </button>
        )}
      </div>

      {/* Ввод ключа — только пока не подключено; чтобы сменить ключ, сначала «Удалить». */}
      {!connected && (
        <div>
          <div style={{
            fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: 'var(--ls-caps)',
            textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8,
          }}>
            Gemini API-ключ
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <input
                type="password"
                value={keyInput}
                placeholder="AIza…"
                onChange={(e) => { setKeyInput(e.target.value); setSaveError(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(); }}
                style={{
                  padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                  border: saveError ? '1.5px solid var(--error, #e05)' : '1.5px solid var(--divider-strong)',
                  background: 'var(--surface)', color: 'var(--text-strong)',
                  fontSize: 'var(--fs-sm)', outline: 'none', fontFamily: 'monospace',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = saveError ? 'var(--error, #e05)' : 'var(--divider-strong)')}
              />
              {saveError && (
                <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--error, #e05)' }}>{saveError}</span>
              )}
            </div>
            <button
              onClick={() => void handleSave()}
              disabled={saving || !keyInput.trim()}
              style={{ ...btnPrimary, alignSelf: 'flex-start', opacity: saving || !keyInput.trim() ? 0.6 : 1 }}
            >
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </div>
      )}

      <HistoryBackfillSection />
    </div>
  );
}

// ── Разовый бэкфилл истории эмбеддингами (заход G, блок 5) ────────────────────
// Триггер — только явный клик по кнопке здесь; никогда автоматически. Прогресс синхронизируется
// при монтировании (getHistoryBackfillStatus) — если бэкфилл уже идёт/завершился при открытой
// в другой раз панели настроек, показываем актуальное состояние, а не всегда «Индексировать».
function HistoryBackfillSection() {
  const [progress, setProgress] = useState<BackfillProgress | null>(null);
  const [coverage, setCoverage] = useState<HistoryContentCoverage | null>(null);

  const loadCoverage = () => { void window.oblako.getHistoryContentCoverage().then(setCoverage); };

  useEffect(() => {
    let mounted = true;
    window.oblako.getHistoryBackfillStatus().then((p) => { if (mounted) setProgress(p); });
    const unsub = window.oblako.onHistoryBackfillProgress((p) => { if (mounted) setProgress(p); });
    loadCoverage();
    return () => { mounted = false; unsub(); };
  }, []);

  const running = progress?.running ?? false;
  const processed = progress?.processed ?? 0;
  const total = progress?.total ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  const finishedClean = !!progress && !running && total > 0 && processed >= total && !progress.cancelled;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 12,
      paddingTop: 20, marginTop: 4, borderTop: '1px solid var(--divider)',
    }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
          Индексация истории для поиска
        </h3>
        <p style={{ margin: '4px 0 0', fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
          Кнопка ниже — разовая обработка уже накопленной истории по заголовку и домену
          (быстро, без открытия страниц). Полный текст страницы для умного поиска отдельно
          появляется сам при обычном посещении/повторном визите — счётчик ниже показывает,
          сколько страниц уже имеют полный текст. Всё считается локально на устройстве.
        </p>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-body)' }}>
          {coverage
            ? `Полный текст: ${coverage.withContent} из ${coverage.total} страниц`
            : 'Полный текст: считаю…'}
        </span>
        <button
          onClick={loadCoverage}
          title="Обновить счётчик"
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: 2,
            color: 'var(--text-muted)', display: 'flex', borderRadius: 'var(--radius-sm)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-body)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {running ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-body)' }}>
            Обработано {processed} из {total}…
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-hover)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${pct}%`, background: 'var(--accent)',
              transition: 'width 0.2s ease-out',
            }} />
          </div>
          <button
            onClick={() => window.oblako.cancelHistoryBackfill()}
            style={{ ...btnGhost, alignSelf: 'flex-start' }}
          >
            Остановить
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => window.oblako.startHistoryBackfill()} style={btnPrimary}>
            {finishedClean ? 'Переиндексировать заново' : 'Индексировать историю'}
          </button>
          {progress && total > 0 && (progress.cancelled || finishedClean) && (
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
              {progress.cancelled ? `Остановлено: ${processed} из ${total}` : `Готово: ${processed} из ${total}`}
            </span>
          )}
        </div>
      )}

      <HistoryContentBackfillSection onDone={loadCoverage} />
    </div>
  );
}

// ── Рискованный бэкфилл полного текста: тихое переоткрытие старых URL (electron/
// HistoryContentBackfill.ts) ─────────────────────────────────────────────────────────────────
// Отдельная секция, не совмещена с лёгким бэкфиллом выше — это принципиально другой по
// стоимости и риску процесс (реальные загрузки страниц, не только текстовый embed-вызов).
// onDone — обновить счётчик охвата в родительской секции после завершения/остановки.
function HistoryContentBackfillSection({ onDone }: { onDone: () => void }) {
  const [progress, setProgress] = useState<BackfillProgress | null>(null);

  useEffect(() => {
    let mounted = true;
    window.oblako.getHistoryContentBackfillStatus().then((p) => { if (mounted) setProgress(p); });
    const unsub = window.oblako.onHistoryContentBackfillProgress((p) => {
      if (!mounted) return;
      setProgress(p);
      if (!p.running) onDone();
    });
    return () => { mounted = false; unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const running = progress?.running ?? false;
  const processed = progress?.processed ?? 0;
  const total = progress?.total ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 12,
      paddingTop: 20, marginTop: 4, borderTop: '1px solid var(--divider)',
    }}>
      <div>
        <h3 style={{ margin: 0, fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
          Полная индексация истории (эксперимент)
        </h3>
        <p style={{ margin: '4px 0 0', fontSize: 'var(--fs-xs)', color: 'var(--danger-500)' }}>
          Тихо переоткрывает старые страницы из истории в фоне (невидимо для вас), чтобы забрать
          их текст для умного поиска. Это значит реальные сетевые запросы к этим сайтам — часть
          страниц может показать капчу, разлогинить или уже не существовать (такие просто
          пропускаются). Может занять долго на большой истории. Можно остановить в любой момент.
        </p>
      </div>

      {running ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-body)' }}>
            Обработано {processed} из {total}…
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--surface-hover)', overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${pct}%`, background: 'var(--accent)',
              transition: 'width 0.2s ease-out',
            }} />
          </div>
          <button
            onClick={() => window.oblako.cancelHistoryContentBackfill()}
            style={{ ...btnGhost, alignSelf: 'flex-start' }}
          >
            Остановить
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={() => window.oblako.startHistoryContentBackfill()} style={btnGhost}>
            Проиндексировать полный текст
          </button>
          {progress && total > 0 && !running && (
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>
              {progress.cancelled ? `Остановлено: ${processed} из ${total}` : `Готово: ${processed} из ${total}`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Секция «Пароли» — сейф на этом устройстве (менеджер паролей, шаг 1) ───────
// Только хранилище/CRUD/генератор/экспорт-импорт на этом шаге — автозаполнение в веб-формы
// (шаг 2) и внешние коннекторы (Bitwarden и т.п.) сюда не входят, ниже только disabled-заглушка
// подраздела под них. Пароль пересекает IPC только по явному действию (reveal/copy/generate) —
// listPasswords секретов не возвращает (см. shared/ipc.ts::OblakoApi).
function PasswordsSection() {
  const [entries, setEntries] = useState<PasswordMeta[] | null>(null);
  const [revealed, setRevealed] = useState<Record<number, string>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [urlInput, setUrlInput] = useState('');
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [genLength, setGenLength] = useState(16);
  const [genLower, setGenLower] = useState(true);
  const [genUpper, setGenUpper] = useState(true);
  const [genDigits, setGenDigits] = useState(true);
  const [genSymbols, setGenSymbols] = useState(false);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportPassphrase, setExportPassphrase] = useState('');
  const [exportBusy, setExportBusy] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importPassphrase, setImportPassphrase] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState('');

  function refresh() {
    window.oblako.listPasswords().then(setEntries);
  }

  useEffect(() => {
    let mounted = true;
    window.oblako.listPasswords().then((list) => { if (mounted) setEntries(list); });
    const unsub = window.oblako.onPasswordsChanged(() => {
      window.oblako.listPasswords().then((list) => { if (mounted) setEntries(list); });
    });
    return () => { mounted = false; unsub(); };
  }, []);

  function openAddForm() {
    setEditingId(null);
    setUrlInput(''); setUsernameInput(''); setPasswordInput(''); setNotesInput('');
    setFormError(''); setGeneratorOpen(false); setFormOpen(true);
  }

  function openEditForm(entry: PasswordMeta) {
    setEditingId(entry.id);
    setUrlInput(entry.url); setUsernameInput(entry.username);
    // Пароль не подгружаем автоматически при открытии формы — не тянем secret без явного
    // reveal-действия пользователя. Пустое поле здесь значит «не менять».
    setPasswordInput(''); setNotesInput('');
    setFormError(''); setGeneratorOpen(false); setFormOpen(true);
  }

  async function handleSave() {
    const rawUrl = urlInput.trim();
    const username = usernameInput.trim();
    if (!rawUrl) { setFormError('Введите адрес сайта'); return; }
    if (editingId === null && !passwordInput) { setFormError('Введите пароль'); return; }

    const normalizedUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
    let title = rawUrl;
    try { title = new URL(normalizedUrl).hostname; } catch { /* оставляем исходную строку */ }

    setSaving(true);
    setFormError('');
    const ok = editingId === null
      ? await window.oblako.addPassword({
          url: normalizedUrl, username, password: passwordInput, title,
          notes: notesInput.trim() || undefined,
        })
      : await window.oblako.updatePassword({
          id: editingId, url: normalizedUrl, username, title,
          password: passwordInput || undefined,
          notes: notesInput.trim() || undefined,
        });
    setSaving(false);
    if (ok) { setFormOpen(false); refresh(); } else { setFormError('Не удалось сохранить'); }
  }

  async function handleDelete(id: number) {
    await window.oblako.deletePassword(id);
    setRevealed((r) => { if (!(id in r)) return r; const next = { ...r }; delete next[id]; return next; });
  }

  async function handleReveal(id: number) {
    if (id in revealed) {
      setRevealed((r) => { const next = { ...r }; delete next[id]; return next; });
      return;
    }
    const value = await window.oblako.revealPassword(id);
    if (value !== null) setRevealed((r) => ({ ...r, [id]: value }));
  }

  async function handleCopy(id: number, field: PasswordCopyField) {
    const ok = await window.oblako.copyPasswordField(id, field);
    if (!ok) return;
    const key = `${id}:${field}`;
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1500);
  }

  async function handleGenerate() {
    const value = await window.oblako.generatePassword({
      length: genLength, lower: genLower, upper: genUpper, digits: genDigits, symbols: genSymbols,
    });
    setPasswordInput(value);
  }

  async function handleExport() {
    if (!exportPassphrase.trim()) { setExportMsg('Введите парольную фразу'); return; }
    setExportBusy(true); setExportMsg('');
    const ok = await window.oblako.exportPasswords(exportPassphrase);
    setExportBusy(false);
    setExportMsg(ok ? 'Экспортировано.' : 'Отменено или не удалось сохранить.');
    if (ok) setExportPassphrase('');
  }

  async function handleImport() {
    if (!importPassphrase.trim()) { setImportMsg('Введите парольную фразу'); return; }
    setImportBusy(true); setImportMsg('');
    const count = await window.oblako.importPasswords(importPassphrase);
    setImportBusy(false);
    setImportMsg(count > 0
      ? `Импортировано записей: ${count}.`
      : 'Не удалось импортировать — неверная фраза, файл не выбран или повреждён.');
    if (count > 0) { setImportPassphrase(''); refresh(); }
  }

  if (entries === null) {
    return <div style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-sm)' }}>Загрузка…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 }}>
      <div>
        <h2 style={{ margin: 0, fontSize: 'var(--fs-md)', fontWeight: 700, color: 'var(--text-strong)' }}>
          Пароли
        </h2>
        <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
          Зашифрованный сейф на этом устройстве — записи защищены ключом, привязанным к вашей
          учётной записи Windows. Автозаполнение в веб-формы появится отдельным шагом.
        </p>
      </div>

      {/* Список сохранённых записей */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div style={{
            fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: 'var(--ls-caps)',
            textTransform: 'uppercase', color: 'var(--text-faint)', flex: 1,
          }}>
            Сохранённые пароли
          </div>
          {!formOpen && (
            <button onClick={openAddForm} style={{ ...btnPrimary, display: 'flex', gap: 6, alignItems: 'center' }}>
              <Plus size={14} /> Добавить
            </button>
          )}
        </div>

        {formOpen && (
          <PasswordForm
            editing={editingId !== null}
            urlInput={urlInput} onUrlChange={setUrlInput}
            usernameInput={usernameInput} onUsernameChange={setUsernameInput}
            passwordInput={passwordInput} onPasswordChange={setPasswordInput}
            notesInput={notesInput} onNotesChange={setNotesInput}
            formError={formError} saving={saving}
            generatorOpen={generatorOpen} onToggleGenerator={() => setGeneratorOpen((v) => !v)}
            genLength={genLength} onGenLength={setGenLength}
            genLower={genLower} onGenLower={setGenLower}
            genUpper={genUpper} onGenUpper={setGenUpper}
            genDigits={genDigits} onGenDigits={setGenDigits}
            genSymbols={genSymbols} onGenSymbols={setGenSymbols}
            onGenerate={() => void handleGenerate()}
            onSave={() => void handleSave()}
            onCancel={() => setFormOpen(false)}
          />
        )}

        {entries.length === 0 && !formOpen && (
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-faint)', padding: '8px 4px' }}>
            Записей пока нет.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {entries.map((entry) => (
            <PasswordRow
              key={entry.id}
              entry={entry}
              revealedValue={revealed[entry.id]}
              copiedKey={copiedKey}
              onToggleReveal={() => void handleReveal(entry.id)}
              onCopy={(field) => void handleCopy(entry.id, field)}
              onEdit={() => openEditForm(entry)}
              onDelete={() => void handleDelete(entry.id)}
            />
          ))}
        </div>
      </div>

      {/* Экспорт / импорт */}
      <div style={{ paddingTop: 20, borderTop: '1px solid var(--divider)' }}>
        <div style={{
          fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: 'var(--ls-caps)',
          textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8,
        }}>
          Экспорт и импорт
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
          Ключ сейфа привязан к этому Windows-профилю и не переживёт переустановку — сохраните
          зашифрованную копию отдельной парольной фразой, чтобы не потерять пароли.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button
            onClick={() => { setExportOpen((v) => !v); setImportOpen(false); setExportMsg(''); }}
            style={{ ...btnGhost, display: 'flex', gap: 6, alignItems: 'center' }}
          ><Download size={14} /> Экспорт</button>
          <button
            onClick={() => { setImportOpen((v) => !v); setExportOpen(false); setImportMsg(''); }}
            style={{ ...btnGhost, display: 'flex', gap: 6, alignItems: 'center' }}
          ><Upload size={14} /> Импорт</button>
        </div>

        {exportOpen && (
          <PassphrasePrompt
            label="Парольная фраза для экспорта"
            value={exportPassphrase} onChange={setExportPassphrase}
            busy={exportBusy} msg={exportMsg}
            actionLabel="Сохранить файл"
            onConfirm={() => void handleExport()}
          />
        )}
        {importOpen && (
          <PassphrasePrompt
            label="Парольная фраза для импорта"
            value={importPassphrase} onChange={setImportPassphrase}
            busy={importBusy} msg={importMsg}
            actionLabel="Выбрать файл"
            onConfirm={() => void handleImport()}
          />
        )}
      </div>

      {/* Внешние коннекторы — плейсхолдер, коннекторов пока нет */}
      <div style={{
        paddingTop: 20, borderTop: '1px solid var(--divider)', opacity: 0.45,
      }}>
        <div style={{
          fontSize: 'var(--fs-xs)', fontWeight: 600, letterSpacing: 'var(--ls-caps)',
          textTransform: 'uppercase', color: 'var(--text-faint)', marginBottom: 8,
        }}>
          Подключить внешний менеджер
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
          ...islandPlate, borderRadius: 'var(--radius-sm)',
        }}>
          <Lock size={18} style={{ color: 'var(--text-faint)', flex: 'none' }} />
          <span style={{ flex: 1, fontSize: 'var(--fs-sm)', color: 'var(--text-faint)' }}>
            Bitwarden и другие менеджеры
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 600 }}>скоро</span>
        </div>
      </div>
    </div>
  );
}

// ── Строка одной записи (список секции «Пароли») ──────────────────────────────

interface PasswordRowProps {
  entry: PasswordMeta;
  revealedValue: string | undefined;
  copiedKey: string | null;
  onToggleReveal: () => void;
  onCopy: (field: PasswordCopyField) => void;
  onEdit: () => void;
  onDelete: () => void;
}

function PasswordRow({ entry, revealedValue, copiedKey, onToggleReveal, onCopy, onEdit, onDelete }: PasswordRowProps) {
  const revealed = revealedValue !== undefined;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
      borderRadius: 'var(--radius-sm)', background: 'var(--surface)',
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {entry.title || entry.origin}
        </div>
        <div style={{
          fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace',
        }}>
          {entry.username || '—'}{revealed ? `  ·  ${revealedValue}` : ''}
        </div>
      </div>
      <IconBtn title="Копировать логин" active={copiedKey === `${entry.id}:username`} onClick={() => onCopy('username')}>
        {copiedKey === `${entry.id}:username` ? <Check size={14} /> : <Copy size={14} />}
      </IconBtn>
      <IconBtn title="Копировать пароль" active={copiedKey === `${entry.id}:password`} onClick={() => onCopy('password')}>
        {copiedKey === `${entry.id}:password` ? <Check size={14} /> : <Copy size={14} />}
      </IconBtn>
      <IconBtn title={revealed ? 'Скрыть пароль' : 'Показать пароль'} onClick={onToggleReveal}>
        {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
      </IconBtn>
      <IconBtn title="Изменить" onClick={onEdit}><Pencil size={14} /></IconBtn>
      <IconBtn title="Удалить" onClick={onDelete}><Trash2 size={14} /></IconBtn>
    </div>
  );
}

function IconBtn({ title, active, onClick, children }: { title: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        border: 'none', background: 'transparent', cursor: 'default', padding: 6,
        borderRadius: 6, display: 'inline-flex', flex: 'none',
        color: active ? 'var(--system)' : 'var(--text-faint)',
      }}
      onMouseEnter={(e) => { if (!active) { e.currentTarget.style.color = 'var(--text-body)'; e.currentTarget.style.background = 'var(--surface-hover)'; } }}
      onMouseLeave={(e) => { if (!active) { e.currentTarget.style.color = 'var(--text-faint)'; e.currentTarget.style.background = 'transparent'; } }}
    >{children}</button>
  );
}

// ── Форма добавления/редактирования записи ─────────────────────────────────────

interface PasswordFormProps {
  editing: boolean;
  urlInput: string; onUrlChange: (v: string) => void;
  usernameInput: string; onUsernameChange: (v: string) => void;
  passwordInput: string; onPasswordChange: (v: string) => void;
  notesInput: string; onNotesChange: (v: string) => void;
  formError: string; saving: boolean;
  generatorOpen: boolean; onToggleGenerator: () => void;
  genLength: number; onGenLength: (v: number) => void;
  genLower: boolean; onGenLower: (v: boolean) => void;
  genUpper: boolean; onGenUpper: (v: boolean) => void;
  genDigits: boolean; onGenDigits: (v: boolean) => void;
  genSymbols: boolean; onGenSymbols: (v: boolean) => void;
  onGenerate: () => void;
  onSave: () => void;
  onCancel: () => void;
}

function PasswordForm({
  editing, urlInput, onUrlChange, usernameInput, onUsernameChange, passwordInput, onPasswordChange,
  notesInput, onNotesChange, formError, saving, generatorOpen, onToggleGenerator,
  genLength, onGenLength, genLower, onGenLower, genUpper, onGenUpper, genDigits, onGenDigits,
  genSymbols, onGenSymbols, onGenerate, onSave, onCancel,
}: PasswordFormProps) {
  const inputStyle: React.CSSProperties = {
    padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: '1.5px solid var(--divider-strong)',
    background: 'var(--surface)', color: 'var(--text-strong)', fontSize: 'var(--fs-sm)', outline: 'none',
    width: '100%',
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', marginBottom: 10,
      ...islandPlate, borderRadius: 'var(--radius-sm)',
    }}>
      <input
        type="text" placeholder="example.com" value={urlInput}
        onChange={(e) => onUrlChange(e.target.value)}
        onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
        onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--divider-strong)')}
        style={inputStyle}
      />
      <input
        type="text" placeholder="Логин / e-mail" value={usernameInput}
        onChange={(e) => onUsernameChange(e.target.value)}
        onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
        onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--divider-strong)')}
        style={inputStyle}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text" placeholder={editing ? 'Новый пароль (не менять — оставить пустым)' : 'Пароль'}
          value={passwordInput} onChange={(e) => onPasswordChange(e.target.value)}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--divider-strong)')}
          style={{ ...inputStyle, fontFamily: 'monospace' }}
        />
        <button
          title="Генератор паролей" onClick={onToggleGenerator}
          style={{ ...btnGhost, flex: 'none', display: 'flex', alignItems: 'center' }}
        ><RefreshCw size={14} /></button>
      </div>

      {generatorOpen && (
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 14px',
          borderRadius: 'var(--radius-sm)', background: 'var(--surface-hover)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', flex: 'none' }}>Длина: {genLength}</span>
            <input
              type="range" min={8} max={64} value={genLength}
              onChange={(e) => onGenLength(Number(e.target.value))}
              style={{ flex: 1 }}
            />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <GenToggle label="a-z" checked={genLower} onChange={() => onGenLower(!genLower)} />
            <GenToggle label="A-Z" checked={genUpper} onChange={() => onGenUpper(!genUpper)} />
            <GenToggle label="0-9" checked={genDigits} onChange={() => onGenDigits(!genDigits)} />
            <GenToggle label="!@#" checked={genSymbols} onChange={() => onGenSymbols(!genSymbols)} />
          </div>
          <button onClick={onGenerate} style={{ ...btnPrimary, alignSelf: 'flex-start' }}>Сгенерировать</button>
        </div>
      )}

      <textarea
        placeholder="Заметки (необязательно)" value={notesInput} rows={2}
        onChange={(e) => onNotesChange(e.target.value)}
        onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
        onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--divider-strong)')}
        style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
      />

      {formError && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--error, #e05)' }}>{formError}</span>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={onSave} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.6 : 1 }}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
        <button onClick={onCancel} style={btnGhost}>Отмена</button>
      </div>
    </div>
  );
}

function GenToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'default' }}>
      <Toggle checked={checked} onChange={onChange} />
      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-body)', fontFamily: 'monospace' }}>{label}</span>
    </label>
  );
}

// ── Инлайн-запрос парольной фразы (экспорт/импорт) ─────────────────────────────

function PassphrasePrompt({
  label, value, onChange, busy, msg, actionLabel, onConfirm,
}: {
  label: string; value: string; onChange: (v: string) => void; busy: boolean; msg: string;
  actionLabel: string; onConfirm: () => void;
}) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px', marginBottom: 8,
      ...islandPlate, borderRadius: 'var(--radius-sm)',
    }}>
      <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{label}</span>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="password" value={value} onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onConfirm(); }}
          style={{
            flex: 1, padding: '8px 12px', borderRadius: 'var(--radius-sm)',
            border: '1.5px solid var(--divider-strong)', background: 'var(--surface)',
            color: 'var(--text-strong)', fontSize: 'var(--fs-sm)', outline: 'none',
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--divider-strong)')}
        />
        <button onClick={onConfirm} disabled={busy} style={{ ...btnPrimary, opacity: busy ? 0.6 : 1, flex: 'none' }}>
          {busy ? '…' : actionLabel}
        </button>
      </div>
      {msg && <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)' }}>{msg}</span>}
    </div>
  );
}

// ── Простой CSS-тумблер ────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      style={{
        position: 'relative', width: 44, height: 24, borderRadius: 12,
        border: 'none', cursor: 'default', flex: 'none', padding: 0,
        background: checked ? 'var(--accent)' : 'var(--neutral-300)',
        transition: 'background var(--dur-fast) var(--ease-standard)',
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: checked ? 23 : 3,
        width: 18, height: 18, borderRadius: '50%', background: '#fff',
        transition: 'left var(--dur-fast) var(--ease-standard)',
        boxShadow: '0 1px 3px rgba(0,0,0,.2)',
      }} />
    </button>
  );
}

// ── Стили кнопок ──────────────────────────────────────────────────────────────

const btnPrimary: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 'var(--radius-sm)', border: 'none',
  background: 'var(--accent)', color: '#fff',
  fontSize: 'var(--fs-sm)', fontWeight: 600, cursor: 'default', flex: 'none',
};
const btnGhost: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--divider-strong)', background: 'transparent',
  color: 'var(--text-body)', fontSize: 'var(--fs-sm)', cursor: 'default', flex: 'none',
};
