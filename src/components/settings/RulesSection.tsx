import { useEffect, useRef, useState } from 'react';
import { sp, pad } from '../../styles/system';
import { Wand2, Trash2, Info } from 'lucide-react';
import Toggle from '../Toggle';
import {
  describeRule, actionSpec, triggerSpec, normalizeRuleDomain, hostOfUrl,
  TRIGGERS, ACTIONS, RULES_MAX, GROUP_NAME_MAX,
  ZOOM_PERCENT_MIN, ZOOM_PERCENT_MAX, ZOOM_PERCENT_DEFAULT,
} from '../../../shared/rules';
import type { AutomationRule, RuleTriggerKind, RuleActionKind } from '../../../shared/rules';
import {
  SectionHeader, Subsection, CapsLabel, TextField, InputRow, fieldFlex,
  btnPrimary, btnGhost, InlineError, InlineHint, Favicon, OptionList, OptionRow,
  Panel, IconBtn, settingsBox,
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

const emptyDraft = (
  kind: RuleActionKind, domain: string, groupName: string, trigger: RuleTriggerKind, zoomPercent: number,
): AutomationRule => ({
  id: 'preview', enabled: true, phrase: '', createdAt: 0,
  trigger: { kind: trigger, domain },
  action: {
    kind,
    ...(kind === 'group' ? { groupName } : {}),
    ...(kind === 'zoom' ? { zoomPercent } : {}),
  },
});

/** Поле имени группы для действия «класть в группу». Пара к ZoomField ниже — см. разбор там же. */
function GroupField({ value, onChange, onEnter }: {
  value: string; onChange: (v: string) => void; onEnter: () => void;
}) {
  return (
    <div style={{ marginTop: sp(3) }}>
      <TextField
        value={value}
        onChange={onChange}
        placeholder="Имя группы, например «Чтение»"
        maxLength={GROUP_NAME_MAX}
        onEnter={onEnter}
      />
    </div>
  );
}

/**
 * Поле масштаба для действия «открывать с масштабом».
 *
 * ⚠️ Ползунок, а не ввод числа: масштаб — величина с пределами, и промахнуться в ней нельзя.
 * Пределы те же, что у Ctrl+= вручную (см. ZOOM_PERCENT_* в shared/rules.ts) — правило не должно
 * уметь просить масштаб, недостижимый руками.
 *
 * ⚠️ Отдельным компонентом, а не разметкой внутри формы: RulesSection стоит в базе храповика
 * структуры, и место под новое поле освобождается выносом.
 */
function ZoomField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div style={{ marginTop: sp(3) }}>
      <InputRow>
        <input
          type="range"
          min={ZOOM_PERCENT_MIN}
          max={ZOOM_PERCENT_MAX}
          step={5}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          style={{ ...fieldFlex, accentColor: 'var(--accent)' }}
          aria-label="Масштаб страницы"
        />
        <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-strong)' }}>{value}%</span>
      </InputRow>
    </div>
  );
}

export default function RulesSection() {
  const [rules, setRules] = useState<AutomationRule[] | null>(null);
  const [error, setError] = useState('');

  // ── Форма ──
  const [trigger, setTrigger] = useState<RuleTriggerKind>('site');
  const [action, setAction] = useState<RuleActionKind>('group');
  const [site, setSite] = useState('');
  const [groupName, setGroupName] = useState('');
  const [zoomPercent, setZoomPercent] = useState(ZOOM_PERCENT_DEFAULT);
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
  // Домен обязателен всегда, имя группы — только у «класть в группу» (у масштаба ввода нет).
  const formValid = !!domain && (action !== 'group' || !!groupName.trim());
  const preview = formValid ? emptyDraft(action, domain, groupName.trim(), trigger, zoomPercent) : null;

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
    if (await save({ phrase: '', trigger: preview.trigger, action: preview.action })) { setSite(''); setGroupName(''); }
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: sp(6) }}>
      <SectionHeader title="Правила">
        Браузер сам делает мелкую работу: раскладывает вкладки по группам, закрепляет нужные,
        включает VPN на выбранных сайтах. Правило выполняется обычным кодом — модель для этого
        не нужна и не запускается.
      </SectionHeader>

      {/* ── Конструктор ─────────────────────────────────────────────────────────────────────
          ⚠️ Правило — это ГРАММАТИКА «когда → где → тогда», и форма обязана её показывать. Раньше
          здесь была россыпь блоков в колонку: подписи, набранные вручную мелким серым, ряды чипов
          разной ширины с переносом и превью отдельной серой строкой внизу. Читалось это не как
          конструктор, а как список несвязанных полей — отсюда «некрасиво и непонятно».
          Теперь три слота в одной карточке, разделённые волосяными линиями, и подвал с тем самым
          предложением, которое встанет в список. */}
      <Subsection title="Новое правило">
        <Panel>
          <Slot label="Когда">
            <OptionList>
              {TRIGGERS.map((t) => (
                <OptionRow
                  key={t.kind}
                  title={t.kind === 'site' ? 'Открываю страницу на сайте' : 'Перехожу по ссылке с сайта'}
                  subtitle={t.kind === 'site'
                    ? 'Сработает на самом сайте и его поддоменах'
                    : 'Сработает на странице, куда увела ссылка с этого сайта'}
                  active={trigger === t.kind}
                  selectable
                  onClick={() => setTrigger(t.kind)}
                />
              ))}
            </OptionList>
          </Slot>

          <Slot label="На каком сайте">
            <TextField
              value={site}
              onChange={(v) => { setSite(v); setError(''); }}
              placeholder="habr.com"
              maxLength={253}
              error={site.trim() && !domain ? 'Не похоже на адрес сайта' : undefined}
              info="Домен покрывает и поддомены: habr.com — это и m.habr.com."
            />
            {/* Подсказки из СВОЕЙ истории: она знает домен точно, в отличие от догадки по названию. */}
            {hostHints.length > 0 && (
              <div style={{ display: 'flex', gap: sp(2), flexWrap: 'wrap', marginTop: sp(2) }}>
                {hostHints.map((h) => (
                  <button key={h} onClick={() => setSite(h)} style={{
                    ...btnGhost, padding: pad(1, 3), fontSize: 'var(--fs-xs)',
                    display: 'inline-flex', alignItems: 'center', gap: sp(2),
                  }}>
                    <Favicon host={h} size={14} />{h}
                  </button>
                ))}
              </div>
            )}
          </Slot>

          <Slot label="Тогда">
            <OptionList>
              {ACTIONS.map((a) => (
                <OptionRow
                  key={a.kind}
                  title={a.kind === 'group' ? 'Класть вкладку в группу'
                    : a.kind === 'pin' ? 'Закреплять вкладку'
                    : a.kind === 'adblock-off' ? 'Не блокировать рекламу на этом сайте'
                    : 'Включать VPN и перезагружать страницу'}
                  active={action === a.kind}
                  selectable
                  onClick={() => setAction(a.kind)}
                />
              ))}
            </OptionList>
            {action === 'zoom' && <ZoomField value={zoomPercent} onChange={setZoomPercent} />}
            {action === 'group' && (
              <GroupField value={groupName} onChange={setGroupName} onEnter={() => void createFromForm()} />
            )}
            {/* Честная оговорка действия — у vpn-on про то, что первый запрос уже ушёл. */}
            {formSpec?.caveat && (
              <div style={{ display: 'flex', gap: sp(2), alignItems: 'flex-start', marginTop: sp(2) }}>
                <Info size={13} style={{ color: 'var(--text-faint)', flex: 'none', marginTop: 4 }} />
                <InlineHint>{formSpec.caveat}</InlineHint>
              </div>
            )}
          </Slot>

          {/* Подвал: та же строка, что встанет в список, — и кнопка рядом с ней, а не под ворохом
              полей. ⚠️ Слова берутся из describeRule, как в карточке разбора и в самом списке:
              разные формулировки в трёх местах означали бы «подтвердил одно, работает другое». */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: sp(3), flexWrap: 'wrap',
            padding: pad(3, 4), background: 'var(--surface-sunken)',
            borderTop: '1px solid var(--divider)',
          }}>
            <span style={{
              fontSize: 'var(--fs-sm)',
              color: preview ? 'var(--text-strong)' : 'var(--text-faint)',
            }}>
              {preview ? describeRule(preview) : `${triggerSpec(trigger)?.describe('…')} — …`}
            </span>
            <button onClick={() => void createFromForm()} disabled={!formValid}
              style={{ ...btnPrimary, opacity: formValid ? 1 : 0.5, flex: 'none' }}>
              Создать правило
            </button>
          </div>
        </Panel>
        {error && <InlineError>{error}</InlineError>}
      </Subsection>

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
          <div style={{
            ...settingsBox, padding: sp(4),
            display: 'flex', flexDirection: 'column', gap: sp(3),
            borderColor: 'var(--accent)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: sp(2) }}>
              <Wand2 size={16} style={{ color: 'var(--accent)', flex: 'none' }} />
              <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--text-strong)' }}>
                Так понял браузер
              </span>
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
              <div style={{ display: 'flex', gap: sp(2), alignItems: 'flex-start' }}>
                <Info size={13} style={{ color: 'var(--text-faint)', flex: 'none', marginTop: 4 }} />
                <InlineHint>{draftSpec.caveat}</InlineHint>
              </div>
            )}
            <div style={{ display: 'flex', gap: sp(2) }}>
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
        {rules && rules.length > 0 && (
          <OptionList>
            {rules.map((rule) => (
              // Строка без своей заливки: рамку и разделители рисует OptionList (разбор — kit.tsx).
              <div key={rule.id} style={{
                padding: pad(3, 4),
                display: 'flex', alignItems: 'center', gap: sp(3),
                opacity: rule.enabled ? 1 : 0.55,
              }}>
                <Favicon host={rule.trigger.domain} size={20} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-strong)' }}>
                    {describeRule(rule)}
                  </div>
                  {/* Исходная фраза есть только у правил, созданных словами, — она объясняет замысел. */}
                  {rule.phrase && (
                    <div style={{
                      fontSize: 'var(--fs-xs)', color: 'var(--text-faint)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      «{rule.phrase}»
                    </div>
                  )}
                </div>
                <Toggle checked={rule.enabled} onChange={() => void window.oblako.setRuleEnabled(rule.id, !rule.enabled)} />
                <IconBtn title="Удалить правило" onClick={() => void window.oblako.removeRule(rule.id)}>
                  <Trash2 size={14} />
                </IconBtn>
              </div>
            ))}
          </OptionList>
        )}
      </Subsection>
    </div>
  );
}

/**
 * Слот конструктора: подпись плюс содержимое, отделённое от соседей волосяной линией.
 *
 * ⚠️ Именно СЛОТ, а не просто отступ между блоками. Правило состоит из трёх решений, и человек
 * должен видеть их как три шага одной фразы, а не как четыре независимых поля подряд.
 */
function Slot({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: pad(4, 4),
      display: 'flex', flexDirection: 'column', gap: sp(2),
      borderTop: '1px solid var(--divider)',
    }}>
      <CapsLabel>{label}</CapsLabel>
      {children}
    </div>
  );
}
