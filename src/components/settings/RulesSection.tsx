import { useEffect, useState } from 'react';
import { Wand2, Trash2, Info } from 'lucide-react';
import Toggle from '../Toggle';
import { islandPlate } from '../../styles/island';
import { describeRule, actionSpec, RULES_MAX } from '../../../shared/rules';
import type { AutomationRule } from '../../../shared/rules';
import {
  SectionHeader, Subsection, CapsLabel, TextField, InputRow, fieldFlex,
  btnPrimary, btnGhost, InlineError, InlineHint, Favicon,
} from './kit';

// Раздел «Правила» — правила-автоматизации из фразы (см. shared/rules.ts, RuleParser.ts).
//
// ⚠️ Порядок экрана — это и есть суть фичи: сказал фразу → УВИДЕЛ, что понял браузер → утвердил.
// Карточка подтверждения не косметика и не «ещё один диалог»: фразу разбирает маленькая модель,
// и она ошибается (замер: 7 верных разборов из 8). Правило, заведённое молча, начало бы менять
// поведение браузера через неделю после того, как человек забыл фразу.
//
// ⚠️ Правило описывается человеку ОДНОЙ строкой из `describeRule` — той же самой, что потом
// стоит в списке. Разные слова в карточке и в списке означали бы, что подтверждали одно, а
// работает другое.

export default function RulesSection() {
  const [rules, setRules] = useState<AutomationRule[] | null>(null);
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Черновик, ожидающий подтверждения. Пока он на экране, поле фразы не трогаем: человек
  // сравнивает сказанное с понятым.
  const [draft, setDraft] = useState<AutomationRule | null>(null);
  // Имя группы правится прямо в карточке: модель склоняет его по фразе («в группу Хабра»),
  // а имя группы человек будет видеть в сайдбаре каждый день.
  const [groupName, setGroupName] = useState('');

  useEffect(() => {
    void window.oblako.listRules().then(setRules);
    return window.oblako.onRulesChanged(setRules);
  }, []);

  const parse = async () => {
    const p = phrase.trim();
    if (!p || busy) return;
    setBusy(true);
    setError('');
    setDraft(null);
    try {
      const res = await window.oblako.parseRule(p);
      if (res.ok) {
        setDraft(res.rule);
        setGroupName(res.rule.action.groupName ?? '');
      } else {
        setError(res.reason === 'model-error'
          ? 'Модель не ответила — проверьте, что она установлена в разделе AI.'
          : 'Не понял фразу. Правило должно называть сайт и одно из действий ниже.');
      }
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!draft) return;
    const toSave: AutomationRule = draft.action.kind === 'group'
      ? { ...draft, action: { ...draft.action, groupName: groupName.trim() } }
      : draft;
    if (toSave.action.kind === 'group' && !toSave.action.groupName) return;
    const saved = await window.oblako.addRule(toSave);
    if (!saved) {
      setError('Такое правило уже есть — или их накопилось слишком много.');
      return;
    }
    setDraft(null);
    setPhrase('');
  };

  const spec = draft ? actionSpec(draft.action.kind) : null;
  const preview: AutomationRule | null = draft && draft.action.kind === 'group'
    ? { ...draft, action: { ...draft.action, groupName: groupName.trim() || '…' } }
    : draft;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <SectionHeader title="Правила">
        Скажите своими словами, что браузер должен делать сам. Фразу разбирает локальная
        модель — она ничего не отправляет наружу и участвует только в этот момент: дальше
        правило выполняется обычным кодом.
      </SectionHeader>

      <div>
        <CapsLabel>Новое правило</CapsLabel>
        <InputRow>
          <TextField
            value={phrase}
            onChange={(v) => { setPhrase(v); setError(''); }}
            placeholder="Например: ссылки с habr.com открывай в группе Чтение"
            onEnter={() => void parse()}
            maxLength={200}
            style={fieldFlex}
          />
          <button onClick={() => void parse()} disabled={busy || !phrase.trim()}
            style={{ ...btnPrimary, opacity: busy || !phrase.trim() ? 0.5 : 1 }}>
            {busy ? 'Разбираю…' : 'Разобрать'}
          </button>
        </InputRow>
        {error && <div style={{ marginTop: 6 }}><InlineError>{error}</InlineError></div>}
      </div>

      {draft && preview && (
        <div style={{ ...islandPlate, borderRadius: 'var(--radius-sm)', padding: 16,
                      display: 'flex', flexDirection: 'column', gap: 12,
                      boxShadow: '0 0 0 1.5px var(--accent) inset' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Wand2 size={16} style={{ color: 'var(--accent)', flex: 'none' }} />
            <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
              Так понял браузер
            </div>
          </div>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)' }}>
            {describeRule(preview)}
          </div>
          {draft.action.kind === 'group' && (
            <TextField
              value={groupName}
              onChange={setGroupName}
              placeholder="Имя группы"
              maxLength={24}
              info="Имя группы можно поправить — его вы будете видеть в списке вкладок."
            />
          )}
          {/* Честная оговорка действия (у vpn-on — что первый запрос уже ушёл без VPN). */}
          {spec?.caveat && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Info size={13} style={{ color: 'var(--text-faint)', flex: 'none', marginTop: 2 }} />
              <InlineHint>{spec.caveat}</InlineHint>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => void confirm()} style={btnPrimary}>Создать правило</button>
            <button onClick={() => setDraft(null)} style={btnGhost}>Отмена</button>
          </div>
        </div>
      )}

      <Subsection
        title="Мои правила"
        description={rules === null
          ? undefined
          : `${rules.length} из ${RULES_MAX}. Выключенное правило остаётся в списке, но не выполняется.`}
      >
        {rules === null && <InlineHint>Загрузка…</InlineHint>}
        {rules?.length === 0 && (
          <InlineHint>Пока ни одного. Правила выполняются сами, без обращения к модели.</InlineHint>
        )}
        {rules?.map((rule) => (
          <div key={rule.id} style={{
            ...islandPlate, borderRadius: 'var(--radius-sm)', padding: '12px 16px',
            display: 'flex', alignItems: 'center', gap: 12,
            opacity: rule.enabled ? 1 : 0.55,
          }}>
            <Favicon host={rule.trigger.domain} size={20} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-strong)' }}>
                {describeRule(rule)}
              </div>
              {/* Исходная фраза — единственное, что объясняет, ЗАЧЕМ правило заведено. */}
              {rule.phrase && (
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 2,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  «{rule.phrase}»
                </div>
              )}
            </div>
            <Toggle checked={rule.enabled} onChange={() => void window.oblako.setRuleEnabled(rule.id, !rule.enabled)} />
            <button
              title="Удалить правило"
              onClick={() => void window.oblako.removeRule(rule.id)}
              style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 6,
                       borderRadius: 6, display: 'inline-flex', color: 'var(--text-faint)', flex: 'none' }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </Subsection>

      <Subsection
        title="Что правила умеют"
        description="Набор намеренно маленький: фразу разбирает модель, и цена её ошибки должна оставаться нулевой. Действий вроде «удалить» или «отправить» здесь нет и не будет."
      >
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--fs-sm)', color: 'var(--text-body)',
                     display: 'flex', flexDirection: 'column', gap: 4 }}>
          <li>класть вкладку в группу с нужным именем</li>
          <li>закреплять вкладку</li>
          <li>не блокировать рекламу на сайте</li>
          <li>включать VPN</li>
        </ul>
        <InlineHint>
          Срабатывают на двух событиях: вы открыли страницу на сайте — или перешли по ссылке с него.
        </InlineHint>
      </Subsection>
    </div>
  );
}
