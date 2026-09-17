import { useEffect, useState } from 'react';
import type React from 'react';
import { Plug, Trash2, Zap } from 'lucide-react';
import {
  btnGhost, btnTone, CapsLabel, fieldFlex, InputRow, InlineHint,
  Panel, Segmented, SpotCard, StatusCard, StatusCardSkeleton, Subsection, TextField,
} from './kit';
import { CAPS, RADIUS, pad, sp } from '../../styles/system';
import { formatCost, formatTokens, totalTokens, type AiUsage } from '../../../shared/aiUsage';
import { PROVIDER_PRESETS, defaultSchemaMode, isLoopbackUrl, type ProviderKind } from '../../../shared/aiProviders';
import type { AiConnection, AiConnectionsState, AiRunnerFound } from '../../../shared/ipc';
import { ModelField } from './ModelField';
import { useLanguage } from '../../i18n';

/**
 * Подключения к моделям по API.
 *
 * ⚠️ ТИПОВ ПОДКЛЮЧЕНИЯ ТРИ, А НЕ ТРИДЦАТЬ ПРОВАЙДЕРОВ. Стандарт де-факто — OpenAI-совместимый
 * `/v1/chat/completions`: его принимают OpenAI, OpenRouter, DeepSeek, Groq, а из локальных Ollama
 * и LM Studio. Своя форма запроса только у Anthropic и Gemini. Список провайдеров в интерфейсе
 * устарел бы за месяц; список ФОРМ ЗАПРОСА не менялся второй год. Пресеты ниже — это адреса, а не
 * новый код.
 *
 * ⚠️ Каталога моделей с ценами и рейтингами здесь НЕТ и не будет: он устареет раньше, чем выйдет
 * следующая версия браузера. Имя модели человек вписывает сам — так же, как в любом клиенте BYOK.
 *
 * ⚠️ ФОРМА ЖИВЁТ В КОРОБКЕ, а не висит на странице. Пока она стояла голой, «Новое подключение»
 * читалось продолжением карточек выше, поля растягивались во всю ширину окна, а капса-заголовок
 * висел ни к чему не привязанный. Рамка коробки — тот же рецепт, что у всех групп в настройках.
 */

const KINDS: { id: ProviderKind; label: string; hint?: string }[] = [
  { id: 'openai-compatible', label: 'OpenAI-совместимый', hint: 'OpenAI, OpenRouter, DeepSeek, Groq, Ollama, LM Studio и любой свой адрес.' },
  { id: 'anthropic', label: 'Anthropic', hint: 'Своя форма запроса: структуру ответа даёт инструмент.' },
  { id: 'gemini', label: 'Gemini', hint: 'Своя форма запроса и нативная схема ответа.' },
];

/**
 * Черновик формы, ПЕРЕЖИВАЮЩИЙ уход со страницы.
 *
 * ⚠️ Заведён по живой жалобе: «вставленный API-ключ исчезает, когда переключаешься на другую
 * вкладку настроек». Подключить модель — это два копирования подряд (ключ, потом имя модели), и
 * между ними человек может уйти посмотреть что-то ещё. Секция настроек при уходе размонтируется, а
 * вместе с ней исчезал и весь набранный текст — приходилось начинать сначала.
 *
 * ⚠️ Модульная переменная, а НЕ localStorage и не диск. Здесь лежит ключ провайдера: он живёт в
 * памяти renderer ровно до закрытия окна и никуда не записывается. Сохранить черновик «понадёжнее»
 * значило бы оставить чужой секрет открытым текстом на диске — ровно то, от чего защищает KeyStore.
 */
interface Draft { kind: ProviderKind; baseUrl: string; model: string; key: string }
let draft: Draft = { kind: 'openai-compatible', baseUrl: '', model: '', key: '' };

export function AiConnectionsBlock({ state, usage, summary }: {
  state: AiConnectionsState | null;
  usage: Record<string, AiUsage> | null;
  /** ⚠️ Сводка расхода приходит СЛОТОМ и встаёт между карточками и формой: она подводит итог тому,
   *  что перечислено выше, а не предваряет заведение нового. Отдельным блоком после формы она
   *  читалась продолжением формы — то есть отвечала не на тот вопрос, под которым стояла. */
  summary?: React.ReactNode;
}) {
  const [form, setForm] = useState<Draft>(draft); const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [finds, setFinds] = useState<AiRunnerFound[]>([]);
  // Список моделей от находки: он уже приехал вместе с ней, и переспрашивать раннер незачем.
  const [known, setKnown] = useState<string[] | undefined>(undefined);

  // ⚠️ Проба локальных раннеров при открытии раздела, а не по кнопке: человек, у которого запущена
  // Ollama, не знает, что браузер умеет её подхватить, — то есть кнопку «поискать» он не нажмёт.
  // Стоит это одного запроса на loopback с коротким таймаутом (см. electron/ai/modelList.ts).
  //
  // ⚠️ Зависимость — ЧИСЛО подключений, а не сам массив: снимок приезжает пушем на каждое
  // изменение, и от ссылки на него проба уходила бы кругами. Завели раннер — находка пропадает,
  // потому что main её уже не отдаёт.
  const count = state?.connections.length ?? 0;
  useEffect(() => {
    let alive = true;
    void window.oblako.discoverAiRunners().then((r) => { if (alive) setFinds(r); });
    return () => { alive = false; };
  }, [count]);

  // Правка черновика идёт и в состояние, и в модульную копию — иначе уход со страницы сотрёт её.
  const edit = (patch: Partial<Draft>): void => {
    draft = { ...draft, ...patch };
    setForm(draft);
    setError('');
  };

  // Пресет подставляет адрес и имя модели — и ничего больше: дальше человек правит руками.
  const presets = PROVIDER_PRESETS.filter((p) => p.kind === form.kind);

  // ⚠️ Находка ЗАПОЛНЯЕТ ФОРМУ, а не заводит подключение сама. Раннер отвечает без ключа, то есть
  // «подключить» одним нажатием технически можно — но человек не увидит, ЧТО именно подключилось,
  // и какая из четырёх скачанных моделей выбрана. Две кнопки вместо одной здесь честнее.
  const take = (f: AiRunnerFound): void => {
    setKnown(f.models);
    edit({ kind: 'openai-compatible', baseUrl: f.baseUrl, model: f.models[0] ?? '', key: '' });
  };

  async function save(): Promise<void> {
    setError('');
    const conn: AiConnection = {
      // ⚠️ id из адреса и модели, а не случайный: человек, заведший одно и то же дважды, получает
      // одну запись, а не две одинаковые с разными ключами.
      id: `${form.kind}:${form.baseUrl.trim()}:${form.model.trim()}`.toLowerCase(),
      label: presets.find((p) => form.baseUrl.trim().startsWith(p.baseUrl))?.label ?? hostOf(form.baseUrl),
      kind: form.kind, baseUrl: form.baseUrl.trim(), model: form.model.trim(), concurrency: 4,
      schema: defaultSchemaMode(form.kind),
    };
    setBusy(true);
    // ⚠️ Сначала ПРОБА, и только потом сохранение. Без неё человек узнаёт об опечатке в ключе
    // через полминуты в чате и не понимает, что случилось: ответ просто не приходит.
    const probe = await window.oblako.testAiConnection(conn, form.key.trim() || null);
    if (!probe.ok) { setBusy(false); setError(probe.error); return; }
    await window.oblako.saveAiConnection(conn, form.key.trim() || null);
    setBusy(false);
    // Сохранилось — черновик больше не нужен, и держать чужой ключ в памяти дольше незачем.
    draft = { kind: form.kind, baseUrl: '', model: '', key: '' };
    setForm(draft);
    setKnown(undefined);
  }

  const ready = form.baseUrl.trim() !== '' && form.model.trim() !== '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(4) }}>
      <Subsection
        title="Подключения к моделям"
        description="Свой ключ провайдера. Платите вы напрямую ему — мы не посредник и своих ключей не держим. Ключ хранится зашифрованным и наружу из браузера не возвращается."
      ><span /></Subsection>

      {state === null
        ? <StatusCardSkeleton />
        : state.connections.map((c) => (
          <ConnectionCard key={c.id} conn={c} ready={state.ready.includes(c.id)} usage={usage?.[c.id]} />
        ))}

      {state !== null && state.connections.length === 0 && (
        <StatusCard
          icon={<Plug size={20} style={{ color: 'var(--text-faint)', flex: 'none' }} />}
          title="Ничего не подключено"
          subtitle="Браузер работает на модели этой машины. Подключение нужно там, где ответ сочиняют: чат, работа со страницей, блокнот."
        />
      )}

      {summary}

      {/* ⚠️ Находки стоят НАД формой, а не под списком подключений: это не отчёт о состоянии, а
          предложение к действию, и читаться оно должно ровно перед тем местом, где действие
          совершается. */}
      {finds.map((f) => (
        <StatusCard
          key={f.presetId}
          icon={<Zap size={20} style={{ color: f.models.length === 0 ? 'var(--text-faint)' : 'var(--dot-local)', flex: 'none' }} />}
          title={t('Нашли {label} на этой машине', { label: f.label })}
          subtitle={f.models.length === 0 ? emptyRunnerHint(f.presetId) : t(f.models.length === 1 ? '{n} модель — ответы не уходят с компьютера.' : f.models.length < 5 ? '{n} модели — ответы не уходят с компьютера.' : '{n} моделей — ответы не уходят с компьютера.', { n: f.models.length })}
          // ⚠️ У пустого раннера кнопки НЕТ, и это не забывчивость: подключать нечего, пока не
          // скачана модель. Кнопка, которая заведёт подключение с пустым именем модели, приведёт
          // ровно туда же — к отказу, но на два шага позже и без объяснения.
          {...(f.models.length === 0 ? {} : { actions: <button onClick={() => take(f)} style={btnTone}>{t('Подключить')}</button> })}
        />
      ))}

      <Panel style={{ padding: pad(4), display: 'flex', flexDirection: 'column', gap: sp(3) }}>
        <CapsLabel>Новое подключение</CapsLabel>
        <Segmented value={form.kind} options={KINDS} onChange={(k) => edit({ kind: k })} />

        <div style={{ display: 'flex', gap: sp(2), flexWrap: 'wrap' }}>
          {presets.map((p) => (
            <button key={p.id} onClick={() => { setKnown(undefined); edit({ baseUrl: p.baseUrl, model: p.sampleModel }); }}
              style={{ ...btnGhost, fontSize: 'var(--fs-xs)', padding: pad(1, 3) }}>{p.label}</button>
          ))}
        </div>

        <InputRow>
          <TextField value={form.baseUrl} onChange={(v) => edit({ baseUrl: v })}
            placeholder="https://api.openai.com/v1" mono style={fieldFlex} />
          <ModelField
            kind={form.kind} baseUrl={form.baseUrl} apiKey={form.key}
            value={form.model} onChange={(v) => edit({ model: v })}
            {...(known ? { known } : {})}
            onEnter={() => void save()}
            style={{ flex: '0 1 260px' }}
          />
        </InputRow>
        <InputRow>
          <TextField
            type="password" value={form.key} onChange={(v) => edit({ key: v })}
            placeholder={isLoopbackUrl(form.baseUrl) ? 'ключ не нужен' : 'ключ провайдера'}
            mono style={fieldFlex} error={error || undefined} onEnter={() => void save()}
          />
          <button onClick={() => void save()} disabled={busy || !ready}
            style={{ ...btnTone, alignSelf: 'flex-start', opacity: busy || !ready ? 0.6 : 1 }}>
            {busy ? t('Проверяю…') : t('Проверить и сохранить')}
          </button>
        </InputRow>
        {/* ⚠️ Про http говорим ЗАРАНЕЕ, а не отказом после нажатия: по открытому http ключ уходит
            читаемым, и запрет тут не придирка. Для localhost это безразлично — трафик не покидает
            машину, а Ollama и LM Studio по https и не умеют. */}
        <InlineHint>
          {t('Адрес обязан быть https — по открытому http ключ уходит читаемым. Исключение — localhost.')}
        </InlineHint>
      </Panel>
    </div>
  );
}

/**
 * Карточка подключения.
 *
 * ⚠️ SpotCard, а НЕ StatusCard, и это не смена кубика ради красоты. StatusCard — «строка
 * состояния»: один факт и, может быть, кнопка («подписка сохранена», «ссылки открывает другой
 * браузер»). Подключение — СУЩНОСТЬ: у него есть имя, состояние, параметры и несколько действий.
 * Для сущности в наборе есть своя карточка с полями дела, и пока их складывали в подпись через
 * точки, самым тяжёлым пятном карточки становился идентификатор модели.
 *
 * ⚠️ Имя модели — ПОЛЕ, а не чип. MonoChip рассчитан на короткое значение (кегль 14, поля 8×12);
 * сорокознаковый `inclusionai/ling-3.0-flash-fin:free` превращал его в серую плиту, которая
 * перевешивала имя провайдера. Дизайн-проект говорит об этом прямо: модель — служебный факт.
 *
 * ⚠️ «Проверить» здесь не для красоты: подключение живёт месяцами, а ключ отзывают, тариф
 * заканчивается, адрес переезжает. Без кнопки человек узнаёт об этом в чате посреди работы — ровно
 * в том виде, в каком уже жаловался: «вроде подключил, но нихуя не работает».
 *
 * ⚠️ Ключ при проверке НЕ передаётся: его берёт main из своего хранилища (см. probeConnection).
 * Отдать сюда сохранённый секрет ради кнопки означало бы сломать единственное правило слоя.
 */
function ConnectionCard({ conn, ready, usage }: {
  conn: AiConnection; ready: boolean; usage: AiUsage | undefined;
}) {
  const [probe, setProbe] = useState<'idle' | 'busy' | 'ok' | string>('idle'); const { t } = useLanguage();
  const local = isLoopbackUrl(conn.baseUrl);

  async function test(): Promise<void> {
    setProbe('busy');
    const res = await window.oblako.testAiConnection(conn, null);
    setProbe(res.ok ? 'ok' : res.error);
  }

  return (
    <SpotCard
      compact
      icon={<Dot local={local} ready={ready} />}
      // ⚠️ Бейдж стоит РЯДОМ С ИМЕНЕМ, внутри title (он принимает узел именно для такой сборки):
      // состояние — второе, что читают после «кто это», и уносить его к кнопкам значило бы
      // разорвать пару. Рецепт чипа — тот же, что у бейджа строки списка: капса с заливкой из
      // собственного цвета, а не цветное слово, висящее в воздухе.
      title={(
        <span style={{ display: 'flex', alignItems: 'center', gap: sp(3), flexWrap: 'wrap' }}>
          {conn.label}
          <StatusBadge local={local} ready={ready} probe={probe} />
        </span>
      )}
      fields={[
        { label: 'Модель', value: conn.model, mono: true },
        { label: local ? 'Адрес' : 'Одновременно', value: local ? conn.baseUrl : t('до {n} запросов', { n: conn.concurrency }), mono: local },
        { label: 'Израсходовано', value: spent(usage, t) },
      ]}
      actions={(
        <div style={{ display: 'flex', gap: sp(2) }}>
          <button onClick={() => void test()} disabled={probe === 'busy'} style={btnGhost}>{t('Проверить')}</button>
          <button onClick={() => void window.oblako.deleteAiConnection(conn.id)}
            style={{ ...btnGhost, display: 'flex', gap: sp(2), alignItems: 'center' }}>
            <Trash2 size={14} /> {t('Удалить')}
          </button>
        </div>
      )}
    />
  );
}

/** ⚠️ Прочерк, а не «0 токенов»: на этом подключении ещё не было ни одного ответа, и ноль
 *  означал бы «считали и вышло ноль». Разницу между этими случаями держит shared/aiUsage.ts. */
function spent(u: AiUsage | undefined, t: (s: string, vars?: Record<string, string | number>) => string): string {
  if (u === undefined || u.requests === 0) return '—';
  const tokens = t('{n} токенов', { n: formatTokens(totalTokens(u)) });
  return u.costKnown ? `${tokens} · ${formatCost(u.cost)}` : tokens;
}

/**
 * Состояние подключения одним чипом.
 *
 * ⚠️ Результат пробы вытесняет обычный статус, а не приписывается к нему. «Ключ сохранён ·
 * отвечает» — два утверждения об одном и том же; человек нажал «Проверить» и ждёт ответа именно
 * на этот вопрос.
 */
function StatusBadge({ local, ready, probe }: {
  local: boolean; ready: boolean; probe: 'idle' | 'busy' | 'ok' | string;
}) {
  const { t } = useLanguage();
  const [text, color] =
    probe === 'busy' ? ['Проверяю…', 'var(--text-muted)']
      : probe === 'ok' ? ['Отвечает', 'var(--success-500)']
        : probe !== 'idle' ? ['Не отвечает', 'var(--danger-500)']
          : local ? ['Считается здесь', 'var(--dot-local)']
            : ready ? ['Ключ есть', 'var(--success-500)']
              : ['Нужен ключ', 'var(--warning-500)'];
  return (
    <span style={{
      ...CAPS, color, letterSpacing: '0.08em', whiteSpace: 'nowrap',
      background: `color-mix(in srgb, ${color} 14%, transparent)`,
      padding: `2px ${sp(2)}px`, borderRadius: RADIUS.pill,
    }}>{t(text)}</span>
  );
}

/**
 * ⚠️ Тот же значок, что у метки модели в чатах: залитая точка — считается здесь, кольцо — облако.
 * Смысл несёт форма, а не только цвет; без ключа точка гаснет до приглушённой.
 */
function Dot({ local, ready }: { local: boolean; ready: boolean }) {
  const color = !ready ? 'var(--text-faint)' : local ? 'var(--dot-local)' : 'var(--dot-cloud)';
  return (
    <span style={{
      width: 10, height: 10, borderRadius: '50%', flex: 'none',
      background: local ? color : 'transparent',
      border: local ? 'none' : `2px solid ${color}`,
    }} />
  );
}

function hostOf(url: string): string {
  const m = /^[a-z]+:\/\/([^/?#:]+)/i.exec(url.trim());
  return m ? (m[1] ?? url) : url;
}

/**
 * Что делать, когда раннер запущен, а моделей в нём нет.
 *
 * ⚠️ Живой случай: человек поставил Ollama и не увидел в браузере ничего — потому что свежая
 * Ollama отвечает пустым списком, а мы на это молчали. Молчание тут читается как «не нашли»;
 * говорить надо ровно то, чего не хватает, и командой, которую можно скопировать.
 */
function emptyRunnerHint(presetId: string): string {
  return presetId === 'ollama'
    ? 'Запущена, но ни одной модели не скачано. Скачайте любую — например, командой ollama pull qwen3.'
    : 'Запущена, но ни одной модели не загружено. Загрузите модель в самом приложении.';
}
