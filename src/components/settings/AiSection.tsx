import { useEffect, useState } from 'react';
import { Check, KeyRound, Search, RefreshCw, Trash2 } from 'lucide-react';
import type { BackfillProgress, HistoryContentCoverage, TranslationEngineId, BergamotStatus } from '../../../shared/ipc';
import ModelsSection from '../ModelsSection';
import SkillsSection from './SkillsSection';
import {
  btnPrimary, btnGhost, EngineOption, SectionHeader, Subsection, CapsLabel,
  LoadingNote, StatusCard, TextField, InputRow, fieldFlex,
} from './kit';

// ── Секция «AI» — ключ Gemini для фактчека ────────────────────────────────────
// Шаг 2 захода D: UI + IPC-проводка. Хранение ключа на этом шаге — только в памяти main-процесса
// (см. AiKeyStore.ts) — persist через safeStorage добавляется отдельным коммитом (шаг 3), поэтому
// «подключено» здесь не переживёт перезапуск браузера ДО того коммита — это ожидаемо на этом шаге.
export default function AiSection() {
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
    return <LoadingNote />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 560 }}>
      <SectionHeader title="AI — фактчек">
        Ключ Gemini нужен для фактчека в AI-панели — проверки утверждений страницы по реальным
        источникам в интернете. Хранится зашифрованным, не в виде обычного текста.
      </SectionHeader>

      {/* Статус */}
      <StatusCard
        icon={connected
          ? <Check size={22} style={{ color: 'var(--success-500)', flex: 'none' }} />
          : <KeyRound size={22} style={{ color: 'var(--text-faint)', flex: 'none' }} />}
        title={connected ? 'Подключено' : 'Не подключено'}
        subtitle={connected
          ? 'Ключ Gemini сохранён — кнопка фактчека доступна в AI-панели.'
          : 'Добавьте ключ, чтобы включить фактчек в AI-панели.'}
        actions={connected && (
          <button onClick={() => void handleDelete()} style={{ ...btnGhost, display: 'flex', gap: 6, alignItems: 'center' }}>
            <Trash2 size={14} /> Удалить
          </button>
        )}
      />

      {/* Ввод ключа — только пока не подключено; чтобы сменить ключ, сначала «Удалить». */}
      {!connected && (
        <div>
          <CapsLabel>Gemini API-ключ</CapsLabel>
          <InputRow>
            <TextField
              type="password"
              value={keyInput}
              placeholder="AIza…"
              mono
              onChange={(v) => { setKeyInput(v); setSaveError(''); }}
              onEnter={() => void handleSave()}
              error={saveError || undefined}
              style={fieldFlex}
            />
            <button
              onClick={() => void handleSave()}
              disabled={saving || !keyInput.trim()}
              style={{ ...btnPrimary, alignSelf: 'flex-start', opacity: saving || !keyInput.trim() ? 0.6 : 1 }}
            >
              {saving ? 'Сохранение…' : 'Сохранить'}
            </button>
          </InputRow>
        </div>
      )}

      <ModelsSection />
      <SearxngSection />
      <TranslationEngineSection />
      <HistoryBackfillSection />
      <SkillsSection />
    </div>
  );
}

// ── SearXNG (задел под web-grounding в AI-панели) — тот же паттерн формы, что AiSection выше,
// два поля вместо одного (endpoint + токен, оба через один saveSearxngConfig). Токен опционален —
// не у каждого self-hosted SearXNG есть auth (см. SearxngKeyStore.ts::saveConfig).
function SearxngSection() {
  const [configured, setConfigured] = useState<boolean | null>(null); // null = ещё грузим статус
  const [endpointInput, setEndpointInput] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    let mounted = true;
    window.oblako.getSearxngStatus().then((v) => { if (mounted) setConfigured(v); });
    const unsub = window.oblako.onSearxngStatusChanged((v) => { if (mounted) setConfigured(v); });
    return () => { mounted = false; unsub(); };
  }, []);

  async function handleSave() {
    const endpoint = endpointInput.trim();
    if (!endpoint) { setSaveError('Введите адрес сервера'); return; }
    setSaving(true);
    setSaveError('');
    const ok = await window.oblako.saveSearxngConfig({ endpoint, token: tokenInput.trim() });
    setSaving(false);
    if (ok) { setEndpointInput(''); setTokenInput(''); } else setSaveError('Не удалось сохранить конфиг');
  }

  async function handleDelete() {
    await window.oblako.deleteSearxngConfig();
  }

  if (configured === null) {
    return <LoadingNote />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <SectionHeader title="SearXNG — веб-поиск для AI">
        Свой поисковый сервер для web-grounding в AI-панели. Адрес и токен хранятся зашифрованными,
        не в виде обычного текста.
      </SectionHeader>

      {/* Статус */}
      <StatusCard
        icon={configured
          ? <Check size={22} style={{ color: 'var(--success-500)', flex: 'none' }} />
          : <Search size={22} style={{ color: 'var(--text-faint)', flex: 'none' }} />}
        title={configured ? 'Настроено' : 'Не настроено'}
        subtitle={configured
          ? 'SearXNG подключён — веб-поиск доступен в AI-панели.'
          : 'Добавьте адрес сервера, чтобы включить веб-поиск в AI-панели.'}
        actions={configured && (
          <button onClick={() => void handleDelete()} style={{ ...btnGhost, display: 'flex', gap: 6, alignItems: 'center' }}>
            <Trash2 size={14} /> Удалить
          </button>
        )}
      />

      {/* Ввод — только пока не настроено; чтобы сменить, сначала «Удалить» (тот же приём, что у Gemini). */}
      {!configured && (
        <div>
          <CapsLabel>Адрес сервера и токен</CapsLabel>
          {/* Формат поля токена — «логин:пароль» (HTTP Basic), не API-ключ/Bearer: self-hosted
              SearXNG почти всегда закрывают auth_basic на уровне reverse-proxy, не на своём уровне
              (см. SearxngSearch.ts::searxngSearch). */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <TextField
              value={endpointInput}
              placeholder="https://searx.example.com"
              mono
              onChange={(v) => { setEndpointInput(v); setSaveError(''); }}
              error={saveError || undefined}
            />
            <InputRow>
              <TextField
                type="password"
                value={tokenInput}
                placeholder="Логин:Пароль (опционально)"
                mono
                onChange={setTokenInput}
                onEnter={() => void handleSave()}
                style={fieldFlex}
              />
              <button
                onClick={() => void handleSave()}
                disabled={saving || !endpointInput.trim()}
                style={{ ...btnPrimary, alignSelf: 'flex-start', opacity: saving || !endpointInput.trim() ? 0.6 : 1 }}
              >
                {saving ? 'Сохранение…' : 'Сохранить'}
              </button>
            </InputRow>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Движок полностраничного перевода (Qwen / Bergamot) ────────────────────────
// Bergamot греется в фоне на старте main.ts независимо от того, что сейчас выбрано (см.
// main.ts::warmupBergamot) — статус может прийти push'ем ДО монтирования этой секции ИЛИ уже
// быть готовым к моменту get (та же пара get+onChanged, что у PageTranslateState — гонка старта).
function TranslationEngineSection() {
  const [engine, setEngineState] = useState<TranslationEngineId | null>(null);
  const [bergamotStatus, setBergamotStatus] = useState<BergamotStatus | null>(null);
  // Разовая проверка на монтировании — есть ли хоть одна установленная модель для AI-перевода
  // (Qwen-обёртка работает на дефолтной модели реестра, см. ModelsSection.tsx). Без модели выбор
  // этого движка даёт молчаливый отказ при переводе — бейдж должен предупредить заранее.
  const [hasInstalledModel, setHasInstalledModel] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    window.oblako.getTranslationEngine().then((v) => { if (mounted) setEngineState(v); });
    window.oblako.getBergamotStatus().then((v) => { if (mounted) setBergamotStatus(v); });
    const unsub = window.oblako.onBergamotStatusChanged((v) => { if (mounted) setBergamotStatus(v); });
    window.oblako.getInstalledModels().then((list) => { if (mounted) setHasInstalledModel(list.length > 0); });
    return () => { mounted = false; unsub(); };
  }, []);

  function select(id: TranslationEngineId) {
    setEngineState(id); // оптимистично — setTranslationEngine не бросает и не гоняет туда-обратно
    void window.oblako.setTranslationEngine(id);
  }

  const bergamotDisabled = bergamotStatus !== 'ready';

  return (
    <Subsection
      title="Движок перевода страниц"
      description="Кнопка «Перевести страницу» в тулбаре может работать на одном из двух локальных
        движков. Оба считают полностью на устройстве, ничего не уходит в сеть."
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <EngineOption
          active={engine === 'qwen'}
          onClick={() => select('qwen')}
          title="AI-перевод (медленно, выше качество)"
          subtitle="Qwen — универсальная модель, переводит любой язык, медленнее на CPU/GPU."
          badge={
            hasInstalledModel === null
              ? undefined
              : hasInstalledModel
                ? { text: 'готов', color: 'var(--success-500)' }
                : { text: 'нет модели', color: 'var(--warning-500)' }
          }
        />
        <EngineOption
          active={engine === 'bergamot'}
          disabled={bergamotDisabled}
          onClick={() => { if (!bergamotDisabled) select('bergamot'); }}
          title="Bergamot (быстрее, легче)"
          subtitle={
            bergamotStatus === 'loading' || bergamotStatus === null
              ? 'Проверяю модель перевода…'
              : bergamotStatus === 'unavailable'
                ? 'Модель перевода не загружена — см. README (Bergamot).'
                : 'Специализированная модель для CPU — en/ru и ещё несколько языков.'
          }
          badge={
            bergamotStatus === 'unavailable'
              ? { text: 'недоступен', color: 'var(--text-faint)' }
              : bergamotStatus === 'ready'
                ? { text: 'готов', color: 'var(--success-500)' }
                : undefined
          }
        />
      </div>
    </Subsection>
  );
}

// ── Индекс полнотекстового поиска по истории ───────────────────────────────────
// Индексация текста идёт сама при обычном посещении/повторном визите — здесь только счётчик
// охвата и (ниже) отдельная секция ручного бэкфилла старых страниц. Разовый эмбеддинг-бэкфилл
// (кнопка «Индексировать историю» по заголовку+домену) убран вместе с эмбеддингами — счётчик
// ниже всегда считает страницы с реально сохранённым текстом, эмбеддинги в этом счёте
// никогда не участвовали.
function HistoryBackfillSection() {
  const [coverage, setCoverage] = useState<HistoryContentCoverage | null>(null);

  const loadCoverage = () => { void window.oblako.getHistoryContentCoverage().then(setCoverage); };

  useEffect(() => {
    loadCoverage();
  }, []);

  return (
    <Subsection
      title="Индексация истории для поиска"
      description="Полный текст страницы для умного поиска появляется сам при обычном посещении/повторном
        визите — счётчик ниже показывает, сколько страниц уже имеют полный текст. Всё считается
        локально на устройстве."
    >
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

      <HistoryContentBackfillSection onDone={loadCoverage} />
    </Subsection>
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
    <Subsection
      title="Полная индексация истории (эксперимент)"
      danger
      description="Тихо переоткрывает старые страницы из истории в фоне (невидимо для вас), чтобы забрать
        их текст для умного поиска. Это значит реальные сетевые запросы к этим сайтам — часть
        страниц может показать капчу, разлогинить или уже не существовать (такие просто
        пропускаются). Может занять долго на большой истории. Можно остановить в любой момент."
    >
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
    </Subsection>
  );
}

