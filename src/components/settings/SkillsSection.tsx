import { useEffect, useState } from 'react';
import { Plus, Pencil } from 'lucide-react';
import type { Skill } from '../../../shared/ipc';
import Toggle from '../Toggle';
import {
  btnPrimary, btnGhost, IconBtn, Subsection, InlineError, InlineHint,
  TextField, TextArea, InputRow, fieldFlex, errorColor, settingsBox, OptionList,
} from './kit';

// ── Секция «Скиллы» — CRUD-редактор prompt-кнопок AI-панели (см. electron/SkillsStore.ts,
// мост в window.oblako.{list,add,update,remove}Skill/onSkillsChanged уже проложен отдельным
// коммитом). Один источник правды — push из main: после add/update/remove локальный skills НЕ
// правится вручную, список перерисуется сам через onSkillsChanged (тот же снапшот уходит и в
// AI-панель её собственным ai-panel:skills-list, независимо от этого моста).
export default function SkillsSection() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [labelInput, setLabelInput] = useState('');
  const [promptInput, setPromptInput] = useState('');
  const [iconInput, setIconInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    let mounted = true;
    window.oblako.listSkills().then((list) => { if (mounted) setSkills(list); });
    const unsub = window.oblako.onSkillsChanged((list) => { if (mounted) setSkills(list); });
    return () => { mounted = false; unsub(); };
  }, []);

  function openAddForm() {
    setEditingId(null);
    setLabelInput(''); setPromptInput(''); setIconInput('');
    setFormError(''); setFormOpen(true);
  }

  function openEditForm(skill: Skill) {
    setEditingId(skill.id);
    setLabelInput(skill.label); setPromptInput(skill.prompt); setIconInput(skill.icon ?? '');
    setFormError(''); setFormOpen(true);
  }

  async function handleSave() {
    const label = labelInput.trim();
    const prompt = promptInput.trim();
    // Кнопка и так disabled на пустых полях (canSave ниже) — эта проверка страхует от гонки
    // (напр. Enter до ре-рендера disabled), не дублирует UI-гейт зря.
    if (!label || !prompt) return;
    // Пустой icon → undefined, не '' — валидатор стора принимает оба, но не плодим пустые
    // строки в данных (см. SkillsStore.ts::isValidSkill).
    const icon = iconInput.trim() || undefined;
    setSaving(true);
    setFormError('');
    const ok = editingId === null
      ? await window.oblako.addSkill({ label, prompt, icon })
      : await window.oblako.updateSkill(editingId, { label, prompt, icon });
    setSaving(false);
    if (ok) setFormOpen(false); else setFormError('Не удалось сохранить');
  }

  async function handleDelete(id: string) {
    const ok = await window.oblako.removeSkill(id);
    if (ok) setFormOpen(false);
  }

  return (
    <Subsection
      title="Скиллы"
      description="Кнопки-сценарии над полем ввода в AI-панели (Объяснить, Сделать саммари и ваши свои) —
        каждая отправляет свой промпт про текущую страницу."
    >
      {!formOpen && (
        <button onClick={openAddForm} style={{ ...btnPrimary, alignSelf: 'flex-start', display: 'flex', gap: 6, alignItems: 'center' }}>
          <Plus size={14} /> Новый скилл
        </button>
      )}

      {formOpen && (
        <SkillForm
          key={editingId ?? 'new'}
          iconInput={iconInput} onIconChange={setIconInput}
          labelInput={labelInput} onLabelChange={setLabelInput}
          promptInput={promptInput} onPromptChange={setPromptInput}
          formError={formError} saving={saving}
          canSave={labelInput.trim().length > 0 && promptInput.trim().length > 0}
          onSave={() => void handleSave()}
          onCancel={() => setFormOpen(false)}
          showDelete={editingId !== null && !skills.find((s) => s.id === editingId)?.builtin}
          onDelete={() => { if (editingId !== null) void handleDelete(editingId); }}
        />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <OptionList>
        {skills.map((skill) => (
          <SkillRow
            key={skill.id}
            skill={skill}
            onToggleVisible={() => void window.oblako.updateSkill(skill.id, { visible: !skill.visible })}
            onEdit={() => openEditForm(skill)}
          />
        ))}
        </OptionList>
      </div>
    </Subsection>
  );
}

interface SkillRowProps {
  skill: Skill;
  onToggleVisible: () => void;
  onEdit: () => void;
}

function SkillRow({ skill, onToggleVisible, onEdit }: SkillRowProps) {
  const preview = skill.prompt.length > 80 ? `${skill.prompt.slice(0, 80)}…` : skill.prompt;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px' }}>
      {skill.icon && (
        <div style={{ flex: 'none', fontSize: 'var(--fs-md)', lineHeight: 1 }}>{skill.icon}</div>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {skill.label}
        </div>
        <div style={{
          fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {preview}
        </div>
      </div>
      {/* Видимость на панели — независима от builtin, доступна для ЛЮБОГО скилла (это и есть
          способ спрятать встроенный, не удаляя — remove() для builtin всё равно вернёт false). */}
      <div title={skill.visible ? 'Показывается в AI-панели' : 'Скрыта из AI-панели'} style={{ flex: 'none' }}>
        <Toggle checked={skill.visible} onChange={onToggleVisible} />
      </div>
      <IconBtn title="Редактировать" onClick={onEdit}><Pencil size={14} /></IconBtn>
    </div>
  );
}

interface SkillFormProps {
  iconInput: string; onIconChange: (v: string) => void;
  labelInput: string; onLabelChange: (v: string) => void;
  promptInput: string; onPromptChange: (v: string) => void;
  formError: string; saving: boolean; canSave: boolean;
  onSave: () => void;
  onCancel: () => void;
  showDelete: boolean;
  onDelete: () => void;
}

function SkillForm({
  iconInput, onIconChange, labelInput, onLabelChange, promptInput, onPromptChange,
  formError, saving, canSave, onSave, onCancel, showDelete, onDelete,
}: SkillFormProps) {
  // Подтверждение живёт локально в форме (не в SkillsSection) — компонент ремонтится при смене
  // editingId (см. key={editingId} у вызывающего), так что confirm сам сбрасывается.
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', marginBottom: 10,
      ...settingsBox,
    }}>
      <InputRow>
        {/* Без maxLength=1 — составной эмодзи (семья, флаг, ZWJ-последовательность) занимает
            несколько кодовых точек, обрезка по length искалечила бы его. Юзер вставляет из
            системного эмодзи-пикера ОС, это не текстовый ввод произвольной длины. */}
        <TextField
          value={iconInput} placeholder="🙂" maxLength={8} onChange={onIconChange}
          style={{ flex: 'none', width: 56 }} inputStyle={{ textAlign: 'center' }}
        />
        <TextField
          value={labelInput} placeholder="Название кнопки" onChange={onLabelChange}
          style={fieldFlex}
        />
      </InputRow>
      <TextArea
        value={promptInput} placeholder="Промпт — что отправить модели про текущую страницу"
        rows={3} onChange={onPromptChange}
      />

      {formError && <InlineError>{formError}</InlineError>}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button onClick={onSave} disabled={saving || !canSave} style={{ ...btnPrimary, opacity: saving || !canSave ? 0.6 : 1 }}>
          {saving ? 'Сохранение…' : 'Сохранить'}
        </button>
        {showDelete && (
          confirmDelete ? (
            <>
              <InlineHint>Удалить скилл?</InlineHint>
              <button onClick={onDelete} style={{ ...btnGhost, color: errorColor }}>Да</button>
              <button onClick={() => setConfirmDelete(false)} style={btnGhost}>Нет</button>
            </>
          ) : (
            <button onClick={() => setConfirmDelete(true)} style={{ ...btnGhost, color: errorColor }}>
              Удалить
            </button>
          )
        )}
        <button onClick={onCancel} style={btnGhost}>Отмена</button>
      </div>
    </div>
  );
}

