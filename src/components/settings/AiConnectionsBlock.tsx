import { useState } from 'react';
import { Check, KeyRound, Plug, Trash2 } from 'lucide-react';
import {
  btnGhost, btnPrimary, CapsLabel, fieldFlex, InputRow, InlineHint, MonoChip,
  Segmented, StatusCard, StatusCardSkeleton, Subsection, TextField,
} from './kit';
import { sp } from '../../styles/system';
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
 */

const KINDS: { id: ProviderKind; label: string; hint?: string }[] = [
  { id: 'openai-compatible', label: 'OpenAI-совместимый', hint: 'OpenAI, OpenRouter, DeepSeek, Groq, Ollama, LM Studio и любой свой адрес.' },
  { id: 'anthropic', label: 'Anthropic', hint: 'Своя форма запроса: структуру ответа даёт инструмент.' },
  { id: 'gemini', label: 'Gemini', hint: 'Своя форма запроса и нативная схема ответа.' },
];

export function AiConnectionsBlock({ state }: { state: AiConnectionsState | null }) {
  const [kind, setKind] = useState<ProviderKind>('openai-compatible');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  // Пресет подставляет адрес и имя модели — и ничего больше: дальше человек правит руками.
  const presets = PROVIDER_PRESETS.filter((p) => p.kind === kind);

  async function save() {
    setError('');
    const conn: AiConnection = {
      // ⚠️ id из адреса и модели, а не случайный: человек, заведший одно и то же дважды, получает
      // одну запись, а не две одинаковые с разными ключами.
      id: `${kind}:${baseUrl.trim()}:${model.trim()}`.toLowerCase(),
      label: presets.find((p) => baseUrl.trim().startsWith(p.baseUrl))?.label ?? hostOf(baseUrl),
      kind, baseUrl: baseUrl.trim(), model: model.trim(), concurrency: 4,
      schema: defaultSchemaMode(kind),
    };
    setBusy(true);
    // ⚠️ Сначала ПРОБА, и только потом сохранение. Без неё человек узнаёт об опечатке в ключе
    // через полминуты в чате и не понимает, что случилось: ответ просто не приходит.
    const probe = await window.oblako.testAiConnection(conn, key.trim() || null);
    if (!probe.ok) { setBusy(false); setError(probe.error); return; }
    await window.oblako.saveAiConnection(conn, key.trim() || null);
    setBusy(false);
    setBaseUrl(''); setModel(''); setKey(''); setAdding(false);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(4) }}>
      <Subsection
        title="Подключения к моделям"
        description="Свой ключ провайдера. Платите вы напрямую ему — мы не посредник и своих ключей не держим. Ключ хранится зашифрованным и наружу из браузера не возвращается."
      ><span /></Subsection>

      {state === null ? <StatusCardSkeleton /> : state.connections.map((c) => (
        <StatusCard
          key={c.id}
          icon={state.ready.includes(c.id)
            ? <Check size={22} style={{ color: 'var(--success-500)', flex: 'none' }} />
            : <KeyRound size={22} style={{ color: 'var(--text-faint)', flex: 'none' }} />}
          title={c.label}
          subtitle={<span>
            {state.ready.includes(c.id) ? 'Готово' : 'Нужен ключ'} · <MonoChip>{c.model}</MonoChip>
            {isLoopbackUrl(c.baseUrl) ? ' · считается на этой машине' : ''}
          </span>}
          actions={(
            <button onClick={() => void window.oblako.deleteAiConnection(c.id)}
              style={{ ...btnGhost, display: 'flex', gap: 8, alignItems: 'center' }}>
              <Trash2 size={14} /> Удалить
            </button>
          )}
        />
      ))}

      {state !== null && state.connections.length === 0 && !adding && (
        <StatusCard
          icon={<Plug size={22} style={{ color: 'var(--text-faint)', flex: 'none' }} />}
          title="Ничего не подключено"
          subtitle="Браузер работает на модели этой машины. Подключение нужно там, где ответ сочиняют: чат, работа со страницей, блокнот."
          actions={<button onClick={() => setAdding(true)} style={btnPrimary}>Подключить</button>}
        />
      )}

      {(adding || (state !== null && state.connections.length > 0)) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: sp(3) }}>
          <CapsLabel>Новое подключение</CapsLabel>
          <Segmented value={kind} options={KINDS} onChange={(k) => { setKind(k); setError(''); }} />

          <div style={{ display: 'flex', gap: sp(2), flexWrap: 'wrap' }}>
            {presets.map((p) => (
              <button key={p.id} onClick={() => { setBaseUrl(p.baseUrl); setModel(p.sampleModel); }}
                style={{ ...btnGhost, fontSize: 'var(--fs-xs)' }}>{p.label}</button>
            ))}
          </div>

          <InputRow>
            <TextField value={baseUrl} onChange={setBaseUrl} placeholder="https://api.openai.com/v1" mono style={fieldFlex} />
            <TextField value={model} onChange={setModel} placeholder="gpt-5" mono style={{ flex: '0 1 200px' }} />
          </InputRow>
          <InputRow>
            <TextField
              type="password" value={key} onChange={(v) => { setKey(v); setError(''); }}
              placeholder={isLoopbackUrl(baseUrl) ? 'ключ не нужен' : 'ключ провайдера'}
              mono style={fieldFlex} error={error || undefined} onEnter={() => void save()}
            />
            <button onClick={() => void save()} disabled={busy || !baseUrl.trim() || !model.trim()}
              style={{ ...btnPrimary, alignSelf: 'flex-start', opacity: busy || !baseUrl.trim() || !model.trim() ? 0.6 : 1 }}>
              {busy ? 'Проверяю…' : 'Проверить и сохранить'}
            </button>
          </InputRow>
          {/* ⚠️ Про http говорим ЗАРАНЕЕ, а не отказом после нажатия: по открытому http ключ уходит
              читаемым, и запрет тут не придирка. Для localhost это безразлично — трафик не покидает
              машину, а Ollama и LM Studio по https и не умеют. */}
          <InlineHint>
            Адрес обязан быть https — по открытому http ключ уходит читаемым. Исключение — localhost.
          </InlineHint>
        </div>
      )}
    </div>
  );
}

function hostOf(url: string): string {
  const m = /^[a-z]+:\/\/([^/?#:]+)/i.exec(url.trim());
  return m ? (m[1] ?? url) : url;
}
