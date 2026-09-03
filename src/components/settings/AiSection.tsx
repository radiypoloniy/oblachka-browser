import { useEffect, useState } from 'react';
import { Check, KeyRound, Search, RefreshCw, Trash2, AlertTriangle } from 'lucide-react';
import type { BackfillProgress, HistoryContentCoverage, InstalledModel, TranslationEngineId, BergamotStatus } from '../../../shared/ipc';
import ModelsSection from '../ModelsSection';
import SkillsSection from './SkillsSection';
import { AiConnectionsBlock } from './AiConnectionsBlock';
import { AiUsageBlock } from './AiUsageBlock';
import { AiRolesBlock } from './AiRolesBlock';
import type { AiConnectionsState } from '../../../shared/ipc';
import {
  btnPrimary, btnGhost, OptionList, OptionRow, SectionHeader, Subsection, CapsLabel, FactGrid, Fact,
  StatusCard, StatusCardSkeleton, TextField, InputRow, fieldFlex,
} from './kit';
import { TEXT, RADIUS, sp } from '../../styles/system';

// ── Секция «AI» ───────────────────────────────────────────────────────────────
//
// ⚠️ Порядок блоков — от главного к редкому, и он же отвечает на вопрос «с чего тут начинать».
// Первой идёт ЛОКАЛЬНАЯ МОДЕЛЬ: без неё в разделе не работает почти ничего (перевод, поиск по
// смыслу, скиллы панели), и человек, открывший «AI», пришёл прежде всего за ней. Дальше — то,
// что на модели держится (перевод страниц, индексация истории, скиллы). Облачные интеграции
// (фактчек Gemini, свой SearXNG) стоят последними: они требуют чужого ключа или своего сервера,
// то есть касаются меньшинства, и раньше именно они встречали человека первым экраном.
export default function AiSection() {

  // ⚠️ Раньше здесь стоял ранний выход `return <LoadingNote />`, и это была главная причина
  // рваной загрузки раздела: пока не ответит ОДИН запрос (статус ключа Gemini), не рисовалось
  // НИЧЕГО — включая вложенные «Модели», SearXNG, перевод, историю и навыки. Раздел появлялся
  // разом и тут же начинал дёргаться, потому что каждый вложенный блок догружался своим темпом.
  // Теперь ждёт только та карточка, которой нечего показать; остальное монтируется сразу.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(6) }}>
      {/* ⚠️ Шапка стоит в КОРНЕ раздела, а не внутри одного из блоков. Раздел собран из шести
          самостоятельных кусков (модели, перевод, история, навыки, Gemini, SearXNG), и раньше
          общего заголовка у него не было вовсе: экран начинался прямо с «Локальные модели».
          ⚠️ Шапка и сводка — ОДИН компонент, как у VPN. Раньше здесь стоял заголовок «AI» с
          абзацем, то есть раздел открывался названием самого себя; ответа на вопрос «а модель у
          меня вообще есть и готова ли она» не было ни в шапке, ни в первом экране — за ним нужно
          было спуститься в «Локальные модели». VPN этот же вопрос («я сейчас через туннель?»)
          выносит героем, и AI обязан вести себя так же. */}
      <AiOverview />

      <ModelsSection />
      <AiConnectionsSection />
      <TranslationEngineSection />
      <HistoryBackfillSection />
      <SkillsSection />
      <GeminiSection />
      <SearxngSection />
    </div>
  );
}

/**
 * Шапка раздела и сводка того, что из AI сейчас работает.
 *
 * ⚠️ Собственные запросы здесь НЕ заводятся — состояние спрашивается теми же каналами, что уже
 * есть у блоков ниже. Иначе один экран ходил бы за одним и тем же дважды, а расхождение между
 * сводкой и блоком выглядело бы как баг.
 *
 * ⚠️ ГЕРОЙ — ИМЯ МОДЕЛИ, а не слово «AI». Разбор тот же, что у VPN: заходя в раздел, человек
 * спрашивает «что у меня стоит и готово ли оно», и ответ обязан быть первым, что он видит.
 * Название раздела он уже прочитал в боковом списке, пока сюда шёл.
 *
 * ⚠️ «Готова» и «В памяти» — РАЗНЫЕ состояния, и склеивать их нельзя (см. SetDefaultModelResult
 * в shared/ipc/ai.ts): дефолт назначен — модель ответит, но с паузой на загрузку; загружена в
 * VRAM — ответит сразу. Это ровно та разница, из-за которой первый ответ «долго думает».
 */
/**
 * Подключения и маршруты. ⚠️ Снимок ОДИН на оба блока: список подключений и таблица маршрутов
 * приходят вместе, и разделять их на два запроса значило бы получить два состояния, которые умеют
 * разъехаться на одном кадре.
 */
function AiConnectionsSection() {
  const [state, setState] = useState<AiConnectionsState | null>(null);
  useEffect(() => {
    let alive = true;
    void window.oblako.aiConnections().then((s) => { if (alive) setState(s); });
    const off = window.oblako.onAiConnectionsChanged((s) => { if (alive) setState(s); });
    return () => { alive = false; off(); };
  }, []);
  return (
    <>
      <AiConnectionsBlock state={state} />
      <AiUsageBlock state={state} />
      <AiRolesBlock state={state} />
    </>
  );
}

function AiOverview() {
  const [gemini, setGemini] = useState<boolean | null>(null);
  const [searx, setSearx] = useState<boolean | null>(null);
  const [installed, setInstalled] = useState<InstalledModel[] | null>(null);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void window.oblako.getAiKeyStatus().then((v) => { if (alive) setGemini(v); });
    void window.oblako.getSearxngStatus().then((v) => { if (alive) setSearx(v); });
    const reloadModels = () => {
      void window.oblako.getInstalledModels().then((v) => { if (alive) setInstalled(v); });
      void window.oblako.getDefaultModelId().then((v) => { if (alive) setDefaultId(v); });
      void window.oblako.getLoadedModelId().then((v) => { if (alive) setLoadedId(v); });
    };
    reloadModels();
    // ⚠️ Подписки на изменения — те же, что у блоков ниже: иначе сводка отстанет от блока,
    // человек сохранит ключ и увидит наверху «выключен», то есть решит, что ничего не вышло.
    const offKey = window.oblako.onAiKeyStatusChanged((v) => setGemini(v));
    const offSearx = window.oblako.onSearxngStatusChanged((v) => setSearx(v));
    // ⚠️ Push-события «модель загрузилась» нет — getLoadedModelId чисто pull (см. ModelsSection).
    // Перечитываем по тем же двум поводам, что и блок моделей: конец загрузки файла и закрытие
    // AI-панели (там модель могла подняться в VRAM сообщением в чат).
    const offDownload = window.oblako.onModelDownloadProgress((p) => { if (!p.running) reloadModels(); });
    const offPanel = window.oblako.onAiPanelStateChanged((open) => { if (!open) reloadModels(); });
    return () => { alive = false; offKey(); offSearx(); offDownload(); offPanel(); };
  }, []);

  const active = installed?.find((m) => m.id === defaultId) ?? null;
  const loaded = loadedId !== null && loadedId === defaultId;
  const hero = installed === null ? '…' : active ? active.label : 'Нет модели';
  const heroLabel = installed === null
    ? 'смотрю, что установлено'
    : !active
      ? 'скачайте модель ниже — без неё не работают скиллы, перевод и поиск по смыслу'
      : loaded
        ? 'загружена в память — отвечает сразу, ничего не отправляет наружу'
        : 'готова — поднимется в память при первом запросе';

  return (
    <>
      <SectionHeader title="AI" hero={hero} heroLabel={heroLabel}>
        Локальная модель работает на этом устройстве и ничего не отправляет. Облачные сервисы
        ниже подключаются по отдельности и только вашим ключом.
      </SectionHeader>

      {/* ⚠️ Сводка ЧЕТЫРЁХ подсистем разом. Раздел собран из шести самостоятельных блоков, и
          чтобы понять «что у меня вообще включено», человеку приходилось пролистать их все.
          Сетка отвечает на это сразу, а блоки ниже остаются для настройки. */}
      <FactGrid>
        <Fact
          label="Модель"
          hint={active ? `${(active.sizeBytes / 1024 ** 3).toFixed(1)} ГБ на диске` : 'ни одна не установлена'}
          value={installed === null ? '—' : !active ? 'Нет' : loaded ? 'В памяти' : 'Готова'}
          active={active !== null}
        />
        <Fact
          label="Перевод страниц"
          hint="Bergamot, без сети"
          value="Локально"
          active
        />
        <Fact
          label="Фактчек"
          hint="Gemini, облачный"
          value={gemini === null ? '—' : gemini ? 'Ключ есть' : 'Выключен'}
          active={gemini === true}
        />
        <Fact
          label="Веб-поиск"
          hint="SearXNG, свой сервер"
          value={searx === null ? '—' : searx ? 'Настроен' : 'Выключен'}
          active={searx === true}
        />
      </FactGrid>
    </>
  );
}

// ── Фактчек через Gemini — единственная облачная модель в проекте ─────────────
// Стоит в конце раздела намеренно (см. разбор порядка у AiSection): нужен чужой API-ключ, то есть
// блок касается меньшинства, а встречал он раньше всех.
function GeminiSection() {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Subsection
        title="Фактчек — ключ Gemini"
        description="Проверка утверждений страницы по источникам в интернете. Ключ хранится зашифрованным, не обычным текстом."
      ><span /></Subsection>

      {/* Статус */}
      {connected === null ? <StatusCardSkeleton /> : <StatusCard
        icon={connected
          ? <Check size={22} style={{ color: 'var(--success-500)', flex: 'none' }} />
          : <KeyRound size={22} style={{ color: 'var(--text-faint)', flex: 'none' }} />}
        title={connected ? 'Подключено' : 'Не подключено'}
        subtitle={connected
          ? 'Ключ Gemini сохранён — кнопка фактчека доступна в AI-панели.'
          : 'Добавьте ключ, чтобы включить фактчек в AI-панели.'}
        actions={connected && (
          <button onClick={() => void handleDelete()} style={{ ...btnGhost, display: 'flex', gap: 8, alignItems: 'center' }}>
            <Trash2 size={14} /> Удалить
          </button>
        )}
      />}

      {/* Ввод ключа — только пока не подключено; чтобы сменить ключ, сначала «Удалить».
          ⚠️ Сравнение строгое с false, а не `!connected`: пока статус не приехал (null), форму
          показывать нельзя — она мелькнула бы и исчезла у того, у кого ключ уже сохранён. */}
      {connected === false && (
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

  // Тот же приём, что у блока Gemini выше: ждёт только карточка статуса, не весь блок.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ⚠️ Подраздел, а не вторая шапка раздела: цветных шапок на экране должна быть РОВНО одна,
          иначе цвет перестаёт означать «здесь начинается раздел». */}
      <Subsection
        title="SearXNG — веб-поиск для AI"
        description="Свой поисковый сервер для web-grounding в AI-панели. Адрес и токен хранятся зашифрованными, не обычным текстом."
      ><span /></Subsection>

      {/* Статус */}
      {configured === null ? <StatusCardSkeleton /> : <StatusCard
        icon={configured
          ? <Check size={22} style={{ color: 'var(--success-500)', flex: 'none' }} />
          : <Search size={22} style={{ color: 'var(--text-faint)', flex: 'none' }} />}
        title={configured ? 'Настроено' : 'Не настроено'}
        subtitle={configured
          ? 'SearXNG подключён — веб-поиск доступен в AI-панели.'
          : 'Добавьте адрес сервера, чтобы включить веб-поиск в AI-панели.'}
        actions={configured && (
          <button onClick={() => void handleDelete()} style={{ ...btnGhost, display: 'flex', gap: 8, alignItems: 'center' }}>
            <Trash2 size={14} /> Удалить
          </button>
        )}
      />}

      {/* Ввод — только пока не настроено; чтобы сменить, сначала «Удалить» (тот же приём, что у Gemini). */}
      {configured === false && (
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
// main.ts::probeBergamot) — статус может прийти push'ем ДО монтирования этой секции ИЛИ уже
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
      <OptionList>
        <OptionRow
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
        <OptionRow
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
      </OptionList>
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
            background: 'none', border: 'none', cursor: 'pointer', padding: 4,
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
      title="Полная индексация истории"
      description="Тихо переоткрывает старые страницы из истории в фоне (невидимо для вас), чтобы забрать
        их текст для умного поиска. Может занять долго на большой истории, остановить можно в любой
        момент."
    >
      {/* ⚠️ Предупреждение — СТРОКОЙ со значком, а не красным абзацем описания. Красный текст был
          единственным во всём интерфейсе и противоречил закону цвета: статус говорит значком и
          словом. Само предупреждение важное и остаётся: это реальные сетевые запросы. */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, ...TEXT.caption }}>
        <AlertTriangle size={14} style={{ color: 'var(--warning-500)', flex: 'none', marginTop: 4 }} />
        <span>
          Идут настоящие сетевые запросы к этим сайтам: часть страниц может показать капчу,
          разлогинить или уже не существовать — такие просто пропускаются.
        </span>
      </div>
      {running ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-body)' }}>
            Обработано {processed} из {total}…
          </div>
          <div style={{ height: 6, borderRadius: RADIUS.tight, background: 'var(--surface-hover)', overflow: 'hidden' }}>
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

