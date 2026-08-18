import { useEffect, useRef, useState } from 'react';
import { RADIUS } from '../../styles/system';
import { Wand2, Trash2, Info } from 'lucide-react';
import Toggle from '../Toggle';
import {
  describeRule, actionSpec, triggerSpec, normalizeRuleDomain, hostOfUrl,
  TRIGGERS, ACTIONS, RULES_MAX, GROUP_NAME_MAX,
} from '../../../shared/rules';
import type { AutomationRule, RuleTriggerKind, RuleActionKind } from '../../../shared/rules';
import {
  SectionHeader, Subsection, CapsLabel, TextField, InputRow, fieldFlex,
  btnPrimary, btnGhost, InlineError, InlineHint, Favicon, OptionList, settingsBox,
} from './kit';

// Раздел «Правила» — правила-автоматизации (см. shared/rules.ts, RuleEngine.ts, RuleParser.ts).
//
// ⚠️ ОСНОВНОЙ способ создать правило — ФОРМА, а не фраза. Каталог закрыт и мал (два триггера,
// четыре действия), то есть правило — это форма из четырёх полей, и переводить её из
// естественного языка моделью означало бы менять стопроцентную точность на семь попаданий из
// восьми, 6 ГБ видеопамяти и ожидание холодного старта. Плюс модель в проекте опциональна: пока
// единственной дверью была фраза, у человека без скачанной модели раздел не работал вовсе.
// Фраза осталась второй дорожкой — удобством для тех, кому быстрее сказать словами.
//
// ⚠️ Правило описывается ОДНОЙ строкой из `describeRule` — и в превью формы, и в карточке
// разбора, и в списке. Разные слова в этих трёх местах означали бы, что подтверждали одно, а
// работает другое.

const emptyDraft = (kind: RuleActionKind, domain: string, groupName: string, trigger: RuleTriggerKind): AutomationRule => ({
  id: 'preview', enabled: true, phrase: '', createdAt: 0,
  trigger: { kind: trigger, domain },
  action: { kind, ...(kind === 'group' ? { groupName } : {}) },
});

export default function RulesSection() {
  const [rules, setRules] = useState<AutomationRule[] | null>(null);
  const [error, setError] = useState('');

  // ── Форма ──
  const [trigger, setTrigger] = useState<RuleTriggerKind>('site');
  const [action, setAction] = useState<RuleActionKind>('group');
  const [site, setSite] = useState('');
  const [groupName, setGroupName] = useState('');
  const [hostHints, setHostHints] = useState<string[]>([]);

  // ── Фраза (вторая дорожка) ──
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<AutomationRule | null>(null);
  const [draftGroup, setDraftGroup] = useState('');

  const hintSeq = useRef(0);

  useEffect(() => {
    void window.oblako.listRules().then(setRules);
    return window.oblako.onRulesChanged(setRules);
  }, []);

  // Подсказки сайтов — из СВОЕЙ истории, а не из модели: она угадывает домен по названию, а
  // история его знает точно, и это ровно те сайты, на которых человек бывает.
  useEffect(() => {
    const q = site.trim();
    if (q.length < 2) { setHostHints([]); return; }
    const seq = ++hintSeq.current;
    const t = setTimeout(() => {
      void window.oblako.searchHistory(q).then((entries) => {
        if (seq !== hintSeq.current) return;
        const hosts: string[] = [];
        for (const e of entries) {
          const h = hostOfUrl(e.url);
          if (h && h !== normalizeRuleDomain(q) && !hosts.includes(h)) hosts.push(h);
          if (hosts.length >= 5) break;
        }
        setHostHints(hosts);
      }).catch(() => setHostHints([]));
    }, 200);
    return () => clearTimeout(t);
  }, [site]);

  const domain = normalizeRuleDomain(site);
  const groupOk = action !== 'group' || !!groupName.trim();
  const formValid = !!domain && groupOk;
  const preview = formValid ? emptyDraft(action, domain, groupName.trim(), trigger) : null;

  const save = async (rule: Omit<AutomationRule, 'id' | 'enabled' | 'createdAt'>) => {
    const saved = await window.oblako.addRule({ ...rule, createdAt: Date.now() } as AutomationRule);
    if (!saved) {
      setError('Такое правило уже есть — или их накопилось слишком много.');
      return false;
    }
    setError('');
    return true;
  };

  const createFromForm = async () => {
    if (!preview) return;
    const ok = await save({ phrase: '', trigger: preview.trigger, action: preview.action });
    if (ok) { setSite(''); setGroupName(''); }
  };

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
        setDraftGroup(res.rule.action.groupName ?? '');
      } else {
        setError(res.reason === 'model-error'
          ? 'Модель не ответила — соберите правило формой выше или установите модель в разделе AI.'
          : 'Не понял фразу. Соберите правило формой выше — там те же возможности.');
      }
    } finally {
      setBusy(false);
    }
  };

  const confirmDraft = async () => {
    if (!draft) return;
    const action2 = draft.action.kind === 'group'
      ? { ...draft.action, groupName: draftGroup.trim() }
      : draft.action;
    if (action2.kind === 'group' && !action2.groupName) return;
    const ok = await save({ phrase: draft.phrase, trigger: draft.trigger, action: action2 });
    if (ok) { setDraft(null); setPhrase(''); }
  };

  const draftSpec = draft ? actionSpec(draft.action.kind) : null;
  const draftPreview: AutomationRule | null = draft && draft.action.kind === 'group'
    ? { ...draft, action: { ...draft.action, groupName: draftGroup.trim() || '…' } }
    : draft;
  const formSpec = actionSpec(action);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <SectionHeader title="Правила">
        Браузер сам делает мелкую работу: раскладывает вкладки по группам, закрепляет нужные,
        включает VPN на выбранных сайтах. Правило выполняется обычным кодом — модель для этого
        не нужна и не запускается.
      </SectionHeader>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <CapsLabel>Новое правило</CapsLabel>

        <div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginBottom: 8 }}>Когда</div>
          <ChipRow>
            {TRIGGERS.map((t) => (
              <Chip key={t.kind} active={trigger === t.kind} onClick={() => setTrigger(t.kind)}>
                {t.kind === 'site' ? 'Открываю страницу на сайте' : 'Перехожу по ссылке с сайта'}
              </Chip>
            ))}
          </ChipRow>
        </div>

        <div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginBottom: 8 }}>Сайт</div>
          <TextField
            value={site}
            onChange={(v) => { setSite(v); setError(''); }}
            placeholder="habr.com"
            maxLength={253}
            error={site.trim() && !domain ? 'Не похоже на адрес сайта' : undefined}
            info="Домен покрывает и поддомены: habr.com — это и m.habr.com."
          />
          {hostHints.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {hostHints.map((h) => (
                <button key={h} onClick={() => setSite(h)} style={{
                  ...btnGhost, padding: '4px 12px', fontSize: 'var(--fs-xs)',
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                }}>
                  <Favicon host={h} size={14} />{h}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginBottom: 8 }}>Тогда</div>
          <ChipRow>
            {ACTIONS.map((a) => (
              <Chip key={a.kind} active={action === a.kind} onClick={() => setAction(a.kind)}>
                {a.kind === 'group' ? 'Класть в группу'
                  : a.kind === 'pin' ? 'Закреплять вкладку'
                  : a.kind === 'adblock-off' ? 'Не блокировать рекламу'
                  : 'Включать VPN'}
              </Chip>
            ))}
          </ChipRow>
        </div>

        {action === 'group' && (
          <div>
            <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginBottom: 8 }}>Имя группы</div>
            <TextField
              value={groupName}
              onChange={setGroupName}
              placeholder="Чтение"
              maxLength={GROUP_NAME_MAX}
              onEnter={() => void createFromForm()}
            />
          </div>
        )}

        {/* Честная оговорка действия — у vpn-on про то, что первый запрос уже ушёл. */}
        {formSpec?.caveat && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <Info size={13} style={{ color: 'var(--text-faint)', flex: 'none', marginTop: 4 }} />
            <InlineHint>{formSpec.caveat}</InlineHint>
          </div>
        )}

        {/* Превью теми же словами, что потом встанут в списке. */}
        <div style={{ fontSize: 'var(--fs-sm)', color: preview ? 'var(--text-body)' : 'var(--text-faint)' }}>
          {preview
            ? describeRule(preview)
            : `${triggerSpec(trigger)?.describe('…')} — …`}
        </div>

        <div>
          <button onClick={() => void createFromForm()} disabled={!formValid}
            style={{ ...btnPrimary, opacity: formValid ? 1 : 0.5 }}>
            Создать правило
          </button>
        </div>
        {error && <InlineError>{error}</InlineError>}
      </div>

      <Subsection
        title="Или скажите словами"
        description="Фразу разберёт локальная модель и покажет, что из неё поняла. Это только удобство: те же правила собираются формой выше, без модели."
      >
        <InputRow>
          <TextField
            value={phrase}
            onChange={(v) => { setPhrase(v); setError(''); }}
            placeholder="ссылки с habr.com открывай в группе Чтение"
            onEnter={() => void parse()}
            maxLength={200}
            style={fieldFlex}
          />
          <button onClick={() => void parse()} disabled={busy || !phrase.trim()}
            style={{ ...btnGhost, opacity: busy || !phrase.trim() ? 0.5 : 1 }}>
            {busy ? 'Разбираю…' : 'Разобрать'}
          </button>
        </InputRow>

        {draft && draftPreview && (
          <div style={{ ...settingsBox, padding: 16,
                        display: 'flex', flexDirection: 'column', gap: 12,
                        boxShadow: '0 0 0 1.5px var(--accent) inset' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Wand2 size={16} style={{ color: 'var(--accent)', flex: 'none' }} />
              <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
                Так понял браузер
              </div>
            </div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-body)' }}>
              {describeRule(draftPreview)}
            </div>
            {draft.action.kind === 'group' && (
              <TextField
                value={draftGroup}
                onChange={setDraftGroup}
                placeholder="Имя группы"
                maxLength={GROUP_NAME_MAX}
                info="Имя группы можно поправить — его вы будете видеть в списке вкладок."
              />
            )}
            {draftSpec?.caveat && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <Info size={13} style={{ color: 'var(--text-faint)', flex: 'none', marginTop: 4 }} />
                <InlineHint>{draftSpec.caveat}</InlineHint>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => void confirmDraft()} style={btnPrimary}>Создать правило</button>
              <button onClick={() => setDraft(null)} style={btnGhost}>Отмена</button>
            </div>
          </div>
        )}
      </Subsection>

      <Subsection
        title="Мои правила"
        description={rules === null
          ? undefined
          : `${rules.length} из ${RULES_MAX}. Выключенное правило остаётся в списке, но не выполняется.`}
      >
        {rules === null && <InlineHint>Загрузка…</InlineHint>}
        {rules?.length === 0 && <InlineHint>Пока ни одного.</InlineHint>}
        <OptionList>
        {rules?.map((rule) => (
          // Строка без своей заливки: рамку и разделители рисует OptionList (разбор — kit.tsx).
          <div key={rule.id} style={{
            padding: '12px 16px',
            display: 'flex', alignItems: 'center', gap: 12,
            opacity: rule.enabled ? 1 : 0.55,
          }}>
            <Favicon host={rule.trigger.domain} size={20} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-strong)' }}>
                {describeRule(rule)}
              </div>
              {/* Исходная фраза есть только у правил, созданных словами, — она объясняет замысел. */}
              {rule.phrase && (
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-faint)', marginTop: 4,
                              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  «{rule.phrase}»
                </div>
              )}
            </div>
            <Toggle checked={rule.enabled} onChange={() => void window.oblako.setRuleEnabled(rule.id, !rule.enabled)} />
            <button
              title="Удалить правило"
              onClick={() => void window.oblako.removeRule(rule.id)}
              style={{ border: 'none', background: 'transparent', cursor: 'default', padding: 8,
                       borderRadius: RADIUS.control, display: 'inline-flex', color: 'var(--text-faint)', flex: 'none' }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        </OptionList>
      </Subsection>
    </div>
  );
}

// Ряд взаимоисключающих вариантов. Собран из кнопок набора настроек (btnPrimary/btnGhost), а не
// нарисован заново: выбранный вариант — это акцент, ровно как у остальных активных состояний.
function ChipRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{children}</div>;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      ...(active ? btnPrimary : btnGhost),
      padding: '8px 12px', fontSize: 'var(--fs-sm)', fontWeight: active ? 600 : 400,
      whiteSpace: 'normal', textAlign: 'left',
    }}>
      {children}
    </button>
  );
}
