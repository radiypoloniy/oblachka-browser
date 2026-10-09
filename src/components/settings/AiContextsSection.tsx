import { useEffect, useState } from 'react';
import { Plus, Pencil } from 'lucide-react';
import {
  EMPTY_CONTEXTS, PRESET_TEXT_MAX, PRESET_TITLE_MAX, type AiContextPreset, type AiContextsState,
} from '../../../shared/aiContexts';
import {
  btnPrimary, btnGhost, Subsection, InlineError, InlineHint,
  TextField, TextArea, errorColor,
  SpotCard, SpotGrid, InkFrame, InkSwitch,
} from './kit';
import { CAPS, sp } from '../../styles/system';
import { PresetModelField } from './PresetModelField';

// ── Секция «Наборы контекста» — редактор того, что AI-панель держит вместо страницы
// (shared/aiContexts.ts, electron/AiContextStore.ts). Карточки — тот же SpotCard, что у скиллов:
// это соседний блок того же раздела, и второй вид плитки рядом читался бы как другая сущность.
//
// ⚠️ «По умолчанию» — ТУМБЛЕР на карточке, а не отдельный выпадающий список. Вопрос, который
// человек решает здесь, — «с каким набором панель открывается», и ответ виден ровно на той
// карточке, о которой речь. Включённым может быть только один: включение второго снимает первый.

const STAIN = ['var(--tile-teal)', 'var(--tile-blue)', 'var(--tile-brown)', 'var(--tile-slate)', 'var(--tile-green)'] as const;

export default function AiContextsSection() {
  const [state, setState] = useState<AiContextsState>(EMPTY_CONTEXTS);
  const [editing, setEditing] = useState<AiContextPreset | 'new' | null>(null);

  useEffect(() => {
    let mounted = true;
    void window.oblako.aiContexts().then((s) => { if (mounted) setState(s); });
    const unsub = window.oblako.onAiContextsChanged((s) => { if (mounted) setState(s); });
    return () => { mounted = false; unsub(); };
  }, []);

  return (
    <Subsection
      title="Наборы контекста"
      description="Инструкции и материал, которые AI-панель держит вместо страницы: «отвечай на
        присланные сообщения в такой-то стилистике». Набор по умолчанию открывается в панели первым,
        страницу или пустой чат можно выбрать по клику на плашку над лентой."
    >
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: sp(3), flexWrap: 'wrap',
      }}>
        <InlineHint>
          {state.defaultId
            ? 'Залит чернилами набор по умолчанию — с него начинается беседа в панели.'
            : 'Набора по умолчанию нет — панель открывается на текущей странице, как раньше.'}
        </InlineHint>
        <button onClick={() => setEditing('new')} style={{
          ...btnPrimary, display: 'inline-flex', alignItems: 'center', gap: sp(2), flex: 'none',
        }}><Plus size={14} /> Новый набор</button>
      </div>

      {state.presets.length > 0 && (
        <SpotGrid>
          {state.presets.map((preset, i) => {
            const isDefault = state.defaultId === preset.id;
            const preview = preset.text.length > 110 ? `${preset.text.slice(0, 110)}…` : preset.text;
            return (
              <SpotCard
                key={preset.id}
                stack
                filled={isDefault}
                selected={typeof editing === 'object' && editing?.id === preset.id}
                stain={STAIN[i % STAIN.length]}
                icon={<span style={{ fontSize: 28, lineHeight: 1 }}>📌</span>}
                title={preset.title}
                subtitle={preview}
                foot={(
                  <>
                    <InkSwitch
                      on={isDefault}
                      onDark={isDefault}
                      onChange={() => void window.oblako.setDefaultAiContext(isDefault ? null : preset.id)}
                    />
                    <span style={{ ...CAPS, color: 'inherit', opacity: 0.7 }}>
                      {isDefault ? 'по умолчанию' : 'по выбору'}
                    </span>
                    <button
                      title="Изменить имя и текст набора"
                      onClick={() => setEditing(preset)}
                      style={{
                        ...btnGhost, marginLeft: 'auto', color: 'inherit',
                        display: 'inline-flex', alignItems: 'center', gap: sp(1),
                        ...(isDefault ? { borderColor: 'color-mix(in srgb, var(--app-bg) 28%, transparent)' } : null),
                      }}
                    ><Pencil size={13} /> Править</button>
                  </>
                )}
              />
            );
          })}
        </SpotGrid>
      )}

      {editing && (
        <PresetForm
          key={typeof editing === 'string' ? editing : editing.id}
          preset={typeof editing === 'string' ? null : editing}
          onDone={() => setEditing(null)}
        />
      )}
    </Subsection>
  );
}

function PresetForm({ preset, onDone }: { preset: AiContextPreset | null; onDone: () => void }) {
  const [title, setTitle] = useState(preset?.title ?? '');
  const [text, setText] = useState(preset?.text ?? '');
  const [materials, setMaterials] = useState(preset?.materials ?? '');
  const [connectionId, setConnectionId] = useState(preset?.connectionId ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const length = text.length + materials.length;
  const canSave = text.trim().length > 0 && length <= PRESET_TEXT_MAX && !saving;

  async function save() {
    setSaving(true); setError('');
    const next = await window.oblako.saveAiContext({ ...(preset ? { id: preset.id } : null), title, text, materials, connectionId });
    setSaving(false);
    if (next) onDone(); else setError('Не удалось сохранить');
  }

  async function remove() {
    if (!preset) return;
    await window.oblako.removeAiContext(preset.id);
    onDone();
  }

  return (
    <InkFrame
      title={preset ? 'Набор' : 'Новый набор'}
      hint="Задайте роль и правила ответа отдельно от примеров. Изменение инструкций или материалов начинает беседы этого набора заново."
    >
      <TextField
        value={title} placeholder="Название — по умолчанию первая строка текста"
        maxLength={PRESET_TITLE_MAX} onChange={setTitle}
      />
      <PresetModelField value={connectionId} onChange={setConnectionId} />
      <label>
        <InlineHint>Инструкции</InlineHint>
        <TextArea value={text} rows={6} onChange={setText}
          placeholder="Кто модель, кому отвечает, на каком языке и в каком формате" />
      </label>
      <label>
        <InlineHint>Справочные материалы</InlineHint>
        <TextArea value={materials} rows={8} onChange={setMaterials}
          placeholder="Скрипты, примеры ответов, условия и другие материалы к задаче" />
      </label>
      <InlineHint>
        {length.toLocaleString('ru-RU')} / {PRESET_TEXT_MAX.toLocaleString('ru-RU')} символов
      </InlineHint>
      {length > PRESET_TEXT_MAX && <InlineError>Набор слишком большой. Сократите инструкции или материалы — текст не обрезается автоматически.</InlineError>}
      {error && <InlineError>{error}</InlineError>}
      <div style={{ display: 'flex', gap: sp(2), alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => void save()} disabled={!canSave} style={{ ...btnPrimary, opacity: canSave ? 1 : 0.6 }}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
        {preset && (
          confirmDelete ? (
            <>
              <InlineHint>Удалить набор? Его беседы закроются.</InlineHint>
              <button onClick={() => void remove()} style={{ ...btnGhost, color: errorColor }}>Да</button>
              <button onClick={() => setConfirmDelete(false)} style={btnGhost}>Нет</button>
            </>
          ) : (
            <button onClick={() => setConfirmDelete(true)} style={{ ...btnGhost, color: errorColor }}>
              Удалить
            </button>
          )
        )}
        <button onClick={onDone} style={btnGhost}>Отмена</button>
      </div>
    </InkFrame>
  );
}
