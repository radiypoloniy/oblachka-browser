import { useEffect, useState } from 'react';
import { Plus, Pencil } from 'lucide-react';
import type { Skill } from '../../../shared/ipc';
import {
  btnPrimary, btnGhost, Subsection, InlineError, InlineHint,
  TextField, TextArea, InputRow, fieldFlex, errorColor,
  SpotCard, SpotGrid, InkFrame, InkSwitch,
} from './kit';
import { CAPS, sp } from '../../styles/system';

// ── Секция «Скиллы» — CRUD-редактор prompt-кнопок AI-панели (см. electron/SkillsStore.ts).
// Карточка — тот же SpotCard, что у профиля и сайта: не заводить «скилл-плитку» рядом.
//
// ⚠️ Скиллы — единственная сущность настроек БЕЗ плиток фактов, и это решение, а не пропуск.
// Сводка тут пустая («5 на панели»), а выразительность нужна каждой кнопке отдельно: человек
// выбирает не «сколько их», а «какую нажать». Поэтому карточка — значок над именем и кусок
// промпта под ним, то есть ровно то, что он увидит в панели.

const SKILL_STAIN = [
  'var(--tile-orange)', 'var(--tile-teal)', 'var(--tile-brown)',
  'var(--tile-slate)', 'var(--tile-green)', 'var(--tile-blue)', 'var(--tile-red)',
] as const;

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
    if (!label || !prompt) return;
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
      {/* ⚠️ «Новый скилл» — кнопка НАД сеткой, а не карточка внутри неё. Пока она стояла ячейкой,
          она перестраивалась вместе с остальными и в какой-то ширине оказывалась в середине
          ряда, между двумя настоящими скиллами: действие выглядело сущностью. */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: sp(3), flexWrap: 'wrap',
      }}>
        <InlineHint>
          Включённые залиты чернилами — ровно они и стоят кнопками над полем ввода панели.
        </InlineHint>
        <button onClick={openAddForm} style={{
          ...btnPrimary, display: 'inline-flex', alignItems: 'center', gap: sp(2), flex: 'none',
        }}><Plus size={14} /> Новый скилл</button>
      </div>

      <SpotGrid>
        {skills.map((skill, i) => {
          const preview = skill.prompt.length > 90 ? `${skill.prompt.slice(0, 90)}…` : skill.prompt;
          const onDark = skill.visible;
          return (
            <SpotCard
              key={skill.id}
              stack
              filled={skill.visible}
              selected={editingId === skill.id}
              stain={SKILL_STAIN[i % SKILL_STAIN.length]}
              icon={<span style={{ fontSize: 28, lineHeight: 1 }}>{skill.icon || '✳'}</span>}
              title={skill.label}
              subtitle={preview}
              foot={(
                <>
                  <InkSwitch
                    on={skill.visible}
                    onDark={onDark}
                    onChange={() => void window.oblako.updateSkill(skill.id, { visible: !skill.visible })}
                  />
                  <span style={{ ...CAPS, color: 'inherit', opacity: 0.7 }}>
                    {skill.visible ? 'на панели' : 'скрыт'}
                  </span>
                  <button
                    title="Изменить имя, значок и промпт"
                    onClick={() => openEditForm(skill)}
                    style={{
                      ...btnGhost, marginLeft: 'auto', color: 'inherit',
                      display: 'inline-flex', alignItems: 'center', gap: sp(1),
                      // На залитой чернилами карточке кромка кнопки обязана посветлеть —
                      // тёмная на тёмном исчезает вместе с самой кнопкой.
                      ...(onDark ? { borderColor: 'color-mix(in srgb, var(--app-bg) 28%, transparent)' } : null),
                    }}
                  ><Pencil size={13} /> Править</button>
                </>
              )}
            />
          );
        })}
      </SpotGrid>

      {formOpen && (
        <SkillForm
          key={editingId ?? 'new'}
          title={editingId ? 'Скилл' : 'Новый скилл'}
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
    </Subsection>
  );
}

function SkillForm({
  title, iconInput, onIconChange, labelInput, onLabelChange, promptInput, onPromptChange,
  formError, saving, canSave, onSave, onCancel, showDelete, onDelete,
}: {
  title: string;
  iconInput: string; onIconChange: (v: string) => void;
  labelInput: string; onLabelChange: (v: string) => void;
  promptInput: string; onPromptChange: (v: string) => void;
  formError: string; saving: boolean; canSave: boolean;
  onSave: () => void;
  onCancel: () => void;
  showDelete: boolean;
  onDelete: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <InkFrame title={title} hint="Промпт уходит модели вместе с текстом текущей страницы.">
      <InputRow>
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
      <div style={{ display: 'flex', gap: sp(2), alignItems: 'center', flexWrap: 'wrap' }}>
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
    </InkFrame>
  );
}
