import { useState } from 'react';
import { Trash2, X } from 'lucide-react';
import type { ImagePreset } from '../../../shared/imagePresets';

// Редактор пользовательских пресетов генератора промптов. Правится ТОЛЬКО описание стиля:
// правила вывода (только промпт, по-английски, порядок описания) заданы скелетом в
// shared/imagePresets.ts и своим текстом их не сломать — см. buildImagePromptRequest.

interface Props {
  presets: ImagePreset[];
  onClose: () => void;
  onSave: (preset: ImagePreset) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

const EMPTY = { id: '', label: '', emoji: '🎨', guidance: '' };

const field: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  background: 'var(--surface-sunken)', border: '1px solid var(--divider)',
  borderRadius: 'var(--radius-sm)', color: 'var(--text-strong)',
  font: 'inherit', fontSize: 'var(--fs-sm)', fontFamily: 'var(--font-sans)',
  padding: '8px 10px', outline: 'none', resize: 'none',
};

export default function ImagePresetEditor({ presets, onClose, onSave, onDelete }: Props) {
  const [draft, setDraft] = useState<ImagePreset>(EMPTY);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!draft.label.trim() || !draft.guidance.trim() || busy) return;
    setBusy(true);
    // id генерируем один раз: при правке существующего он приходит из списка и сохраняется,
    // поэтому UPSERT в базе обновляет запись, а не плодит дубли.
    await onSave({
      ...draft,
      id: draft.id || crypto.randomUUID(),
      label: draft.label.trim(),
      emoji: draft.emoji.trim() || '🎨',
      guidance: draft.guidance.trim(),
    });
    setDraft(EMPTY);
    setBusy(false);
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 20,
        background: 'rgba(0,0,0,0.32)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 100%)', maxHeight: '100%', display: 'flex', flexDirection: 'column',
          background: 'var(--surface-solid)', borderRadius: 'var(--radius-island)',
          boxShadow: 'var(--shadow-card)', overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8, flex: 'none',
            padding: '12px 14px', borderBottom: '1px solid var(--divider)',
          }}
        >
          <span style={{ fontSize: 'var(--fs-lg)' }}>🎨</span>
          <span style={{ flex: 1, fontSize: 'var(--fs-md)', fontWeight: 'var(--fw-semibold)', color: 'var(--text-strong)' }}>
            Свои пресеты стиля
          </span>
          <button
            type="button" onClick={onClose} title="Закрыть"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 26, height: 26, background: 'none', border: 0, borderRadius: '50%',
              color: 'var(--text-faint)', cursor: 'pointer',
            }}
          >
            <X size={15} />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {presets.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {presets.map((p) => (
                <div
                  key={p.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                    background: 'var(--surface-sunken)', borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                  }}
                  onClick={() => setDraft(p)}
                  title="Открыть для правки"
                >
                  <span style={{ fontSize: 'var(--fs-md)' }}>{p.emoji}</span>
                  <span style={{ flex: 1, fontSize: 'var(--fs-sm)', color: 'var(--text-strong)' }}>{p.label}</span>
                  <button
                    type="button"
                    title="Удалить пресет"
                    onClick={(e) => { e.stopPropagation(); void onDelete(p.id); }}
                    style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 26, height: 26, background: 'none', border: 0, borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-faint)', cursor: 'pointer',
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={draft.emoji}
              onChange={(e) => setDraft({ ...draft, emoji: e.target.value })}
              placeholder="🎨"
              style={{ ...field, width: 60, flex: 'none', textAlign: 'center' }}
            />
            <input
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="Название стиля"
              style={field}
            />
          </div>

          <div>
            <textarea
              value={draft.guidance}
              onChange={(e) => setDraft({ ...draft, guidance: e.target.value })}
              placeholder={'Опишите стиль так, как объяснили бы художнику.\nЧем конкретнее про свет, материалы и оптику — тем лучше результат.'}
              style={{ ...field, height: 150, resize: 'vertical' }}
            />
            <div style={{ marginTop: 6, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 'var(--lh-snug)' }}>
              Правила вывода — только промпт, по-английски, в нужном порядке — добавляются
              автоматически. Здесь только про стиль.
            </div>
          </div>

          <button
            type="button"
            onClick={() => void save()}
            disabled={!draft.label.trim() || !draft.guidance.trim() || busy}
            style={{
              alignSelf: 'flex-start',
              background: draft.label.trim() && draft.guidance.trim() ? 'var(--accent)' : 'var(--surface-sunken)',
              color: draft.label.trim() && draft.guidance.trim() ? 'var(--text-on-accent)' : 'var(--text-faint)',
              border: 0, borderRadius: 'var(--radius-chip)', padding: '8px 16px',
              cursor: draft.label.trim() && draft.guidance.trim() ? 'pointer' : 'default',
              font: 'inherit', fontSize: 'var(--fs-sm)', fontWeight: 'var(--fw-medium)',
              fontFamily: 'var(--font-sans)',
            }}
          >
            {draft.id ? 'Сохранить изменения' : 'Добавить пресет'}
          </button>
        </div>
      </div>
    </div>
  );
}
