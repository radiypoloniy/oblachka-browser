import { useState } from 'react';
import { Plug, Trash2 } from 'lucide-react';
import {
  btnGhost, btnTone, CapsLabel, fieldFlex, InputRow, InlineHint, MonoChip,
  Panel, Segmented, StatusCard, StatusCardSkeleton, Subsection, TextField,
} from './kit';
import { pad, sp } from '../../styles/system';
import { PROVIDER_PRESETS, defaultSchemaMode, isLoopbackUrl, type ProviderKind } from '../../../shared/aiProviders';
import type { AiConnection, AiConnectionsState } from '../../../shared/ipc';

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

export function AiConnectionsBlock({ state }: { state: AiConnectionsState | null }) {
  const [form, setForm] = useState<Draft>(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Правка черновика идёт и в состояние, и в модульную копию — иначе уход со страницы сотрёт её.
  const edit = (patch: Partial<Draft>): void => {
    draft = { ...draft, ...patch };
    setForm(draft);
    setError('');
  };

  // Пресет подставляет адрес и имя модели — и ничего больше: дальше человек правит руками.
  const presets = PROVIDER_PRESETS.filter((p) => p.kind === form.kind);

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
          <ConnectionCard key={c.id} conn={c} ready={state.ready.includes(c.id)} />
        ))}

      {state !== null && state.connections.length === 0 && (
        <StatusCard
          icon={<Plug size={20} style={{ color: 'var(--text-faint)', flex: 'none' }} />}
          title="Ничего не подключено"
          subtitle="Браузер работает на модели этой машины. Подключение нужно там, где ответ сочиняют: чат, работа со страницей, блокнот."
        />
      )}

      <Panel style={{ padding: pad(4), display: 'flex', flexDirection: 'column', gap: sp(3) }}>
        <CapsLabel>Новое подключение</CapsLabel>
        <Segmented value={form.kind} options={KINDS} onChange={(k) => edit({ kind: k })} />

        <div style={{ display: 'flex', gap: sp(2), flexWrap: 'wrap' }}>
          {presets.map((p) => (
            <button key={p.id} onClick={() => edit({ baseUrl: p.baseUrl, model: p.sampleModel })}
              style={{ ...btnGhost, fontSize: 'var(--fs-xs)', padding: pad(1, 3) }}>{p.label}</button>
          ))}
        </div>

        <InputRow>
          <TextField value={form.baseUrl} onChange={(v) => edit({ baseUrl: v })}
            placeholder="https://api.openai.com/v1" mono style={fieldFlex} />
          <TextField value={form.model} onChange={(v) => edit({ model: v })}
            placeholder="gpt-5" mono style={{ flex: '0 1 220px' }} />
        </InputRow>
        <InputRow>
          <TextField
            type="password" value={form.key} onChange={(v) => edit({ key: v })}
            placeholder={isLoopbackUrl(form.baseUrl) ? 'ключ не нужен' : 'ключ провайдера'}
            mono style={fieldFlex} error={error || undefined} onEnter={() => void save()}
          />
          <button onClick={() => void save()} disabled={busy || !ready}
            style={{ ...btnTone, alignSelf: 'flex-start', opacity: busy || !ready ? 0.6 : 1 }}>
            {busy ? 'Проверяю…' : 'Проверить и сохранить'}
          </button>
        </InputRow>
        {/* ⚠️ Про http говорим ЗАРАНЕЕ, а не отказом после нажатия: по открытому http ключ уходит
            читаемым, и запрет тут не придирка. Для localhost это безразлично — трафик не покидает
            машину, а Ollama и LM Studio по https и не умеют. */}
        <InlineHint>
          Адрес обязан быть https — по открытому http ключ уходит читаемым. Исключение — localhost.
        </InlineHint>
      </Panel>
    </div>
  );
}

/**
 * Карточка подключения.
 *
 * ⚠️ «Проверить» здесь не для красоты: подключение живёт месяцами, а ключ отзывают, тариф
 * заканчивается, адрес переезжает. Без кнопки человек узнаёт об этом в чате посреди работы — ровно
 * в том виде, в каком уже жаловался: «вроде подключил, но нихуя не работает».
 *
 * ⚠️ Ключ при проверке НЕ передаётся: его берёт main из своего хранилища (см. probeConnection).
 * Отдать сюда сохранённый секрет ради кнопки означало бы сломать единственное правило слоя.
 */
function ConnectionCard({ conn, ready }: { conn: AiConnection; ready: boolean }) {
  const [probe, setProbe] = useState<'idle' | 'busy' | 'ok' | string>('idle');
  const local = isLoopbackUrl(conn.baseUrl);

  async function test(): Promise<void> {
    setProbe('busy');
    const res = await window.oblako.testAiConnection(conn, null);
    setProbe(res.ok ? 'ok' : res.error);
  }

  return (
    <StatusCard
      icon={<Dot local={local} ready={ready} />}
      title={conn.label}
      subtitle={<span>
        {local ? 'Считается на этой машине' : ready ? 'Ключ сохранён' : 'Нужен ключ'}
        {' · '}<MonoChip>{conn.model}</MonoChip>
        {local ? ' · ключ не нужен' : ` · до ${conn.concurrency} запросов разом`}
        {probe === 'busy' && ' · проверяю…'}
        {probe === 'ok' && <span style={{ color: 'var(--success-500)' }}> · отвечает</span>}
        {typeof probe === 'string' && probe !== 'idle' && probe !== 'busy' && probe !== 'ok' && (
          <span style={{ color: 'var(--danger-500)' }}> · {probe}</span>
        )}
      </span>}
      actions={(
        <div style={{ display: 'flex', gap: sp(2) }}>
          <button onClick={() => void test()} disabled={probe === 'busy'} style={btnGhost}>Проверить</button>
          <button onClick={() => void window.oblako.deleteAiConnection(conn.id)}
            style={{ ...btnGhost, display: 'flex', gap: sp(2), alignItems: 'center' }}>
            <Trash2 size={14} /> Удалить
          </button>
        </div>
      )}
    />
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
