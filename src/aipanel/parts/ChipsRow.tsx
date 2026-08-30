import type React from 'react';
import { ChevronDown } from 'lucide-react';
import type { SkillItem } from '../contract';
import type { useChipsRow } from '../useChipsRow';

/**
 * Ряд чипов-подсказок: скиллы, быстрый перевод, фактчек.
 *
 * ⚠️ Ширину строки и переполнение считает useChipsRow — здесь только отрисовка. Разделение
 * не косметическое: замер живёт на ResizeObserver, привязанном к узлу ряда, и мешать его с
 * условной отрисовкой соседей значит однажды померить не тот узел (так уже было — мерили
 * плашку фактчека вместо ряда).
 */
export function ChipsRow({
  chips, chipsBusy, chipsCompact, factCheckAvailable, skills, settingsChip, webGroundingActive,
  setShowFactCheckConfirm, sendText, sendQuickTranslate,
}: {
  chips: ReturnType<typeof useChipsRow>;
  chipsBusy: boolean;
  chipsCompact: boolean;
  factCheckAvailable: boolean;
  skills: SkillItem[];
  /** «+» в несдвигаемом хвосте ряда: попав в поток чипов, он уезжал бы во вторую строку. */
  settingsChip: React.ReactNode;
  webGroundingActive: boolean;
  setShowFactCheckConfirm: (v: boolean) => void;
  sendText: (text: string, web: boolean) => void;
  sendQuickTranslate: () => void;
}) {
  return (
  <div key="chips-row" style={{
    display: 'flex', alignItems: 'flex-start', gap: 6,
    padding: `0 var(--pad-island)`,
    marginBottom: 8,
    flexShrink: 0,
  }}>
  <div
    ref={chips.attach}
    style={{
      flex: '1 1 auto', minWidth: 0,
      display: 'flex', flexWrap: 'wrap', gap: 6,
      // Схлопнуто — ровно одна строка; развёрнуто — измеренная полная высота (не
      // `undefined`: к нему max-height не анимируется, ряд бы прыгал); пустая беседа —
      // без ограничения вовсе. Пока высота не измерена, ограничения тоже нет: лучше
      // кадр полной высоты, чем кадр со срезанными наполовину кнопками.
      maxHeight: chips.maxHeight,
      overflow: chipsCompact ? 'hidden' : 'visible',
      transition: 'max-height var(--dur-base) var(--ease-standard)',
    }}
  >
    {/* Перевести — спец-кнопка вне реестра скиллов (см. комментарий выше), всегда первая.
        ⚠️ В ПУСТОЙ беседе её тут нет: она стоит крупной плиткой выше, и дубль в ряду
        был бы одним и тем же действием дважды на одном экране. */}
    {chipsCompact && (
    <button
      onClick={sendQuickTranslate}
      disabled={chipsBusy}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        // Без этого flex ужимал бы чипы по ширине вместо переноса на новую строку, а
        // длинная подпись скилла ломалась бы посреди слова.
        flexShrink: 0, whiteSpace: 'nowrap',
        padding: '6px 12px',
        borderRadius: 'var(--radius-chip)',
        // Белая парящая кнопка — тот же принцип, что у поля ввода ниже (surface-solid +
        // glass-edge), просто мельче и с --shadow-chip вместо --shadow-card (для
        // чипа-кнопки уместнее лёгкая тень, не островная). Раньше сидела на
        // --surface-sunken (серая в покое внутри уже белой панели) без hover вообще.
        border: '1px solid var(--glass-edge)',
        background: 'var(--surface-solid)',
        boxShadow: 'var(--shadow-chip)',
        color: 'var(--text-body)',
        fontSize: 'var(--fs-xs)', fontWeight: 500,
        cursor: chipsBusy ? 'default' : 'pointer',
        opacity: chipsBusy ? 0.5 : 1,
      }}
      onMouseEnter={(e) => { if (!chipsBusy) e.currentTarget.style.background = 'var(--surface-hover)'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-solid)'; }}
    >
      <span>🌐</span> Перевести
    </button>
    )}
    {/* Заход D — видна ТОЛЬКО когда ключ Gemini подключён (см. onKeyStatus выше), не
        disabled-серая: без ключа кнопки нет вообще. Тот же нейтральный стиль, что у
        остальных подсказок — она такое же одно из равных действий, не отдельная
        система/облако-роль (заход 3, новая дизайн-система убрала эту роль у violet).
        ⚠️ Стоит СРАЗУ за «Перевести», до пользовательских скиллов, и это не косметика:
        обе спец-кнопки заданы нами, а список скиллов человек наполняет сам и он может
        быть длинным. В хвосте фактчек уезжал за обрез первой строки и выглядел как
        пропавший — живая жалоба «а что с фактчеком, почему он исчезает». */}
    {factCheckAvailable && chipsCompact && (
      <button
        onClick={() => setShowFactCheckConfirm(true)}
        disabled={chipsBusy}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          flexShrink: 0, whiteSpace: 'nowrap',
          padding: '6px 12px',
          borderRadius: 'var(--radius-chip)',
          border: '1px solid var(--glass-edge)',
          background: 'var(--surface-solid)',
          boxShadow: 'var(--shadow-chip)',
          color: 'var(--text-body)',
          fontSize: 'var(--fs-xs)', fontWeight: 500,
          cursor: chipsBusy ? 'default' : 'pointer',
          opacity: chipsBusy ? 0.5 : 1,
        }}
        onMouseEnter={(e) => { if (!chipsBusy) e.currentTarget.style.background = 'var(--surface-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-solid)'; }}
      >
        <span>🔍</span> Фактчек
      </button>
    )}
    {/* Коммит 1 (реестр скиллов) — Объяснить/Саммари и позже пользовательские, из
        onSkillsList (SkillsStore.ts), тот же стиль кнопки, что и Перевести выше.
        Заход «видимость»: панель получает ПОЛНЫЙ список (включая скрытые) — фильтр
        на рендере, не на источнике (Settings показывает и скрытые тоже). */}
    {skills.filter((skill) => skill.visible).map((skill) => (
      <button
        key={skill.id}
        onClick={() => sendText(skill.prompt, webGroundingActive)}
        disabled={chipsBusy}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          flexShrink: 0, whiteSpace: 'nowrap',
          padding: '6px 12px',
          borderRadius: 'var(--radius-chip)',
          border: '1px solid var(--glass-edge)',
          background: 'var(--surface-solid)',
          boxShadow: 'var(--shadow-chip)',
          color: 'var(--text-body)',
          fontSize: 'var(--fs-xs)', fontWeight: 500,
          cursor: chipsBusy ? 'default' : 'pointer',
          opacity: chipsBusy ? 0.5 : 1,
        }}
        onMouseEnter={(e) => { if (!chipsBusy) e.currentTarget.style.background = 'var(--surface-hover)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-solid)'; }}
      >
        {skill.icon && <span>{skill.icon}</span>}
        {skill.label}
      </button>
    ))}
    {/* ⚠️ «+» здесь БОЛЬШЕ НЕТ: ряд рисуется только в начатой беседе (chipsCompact),
        а там «+» и так стоит в несдвигаемом хвосте ниже. В пустой беседе его место —
        пунктирная карточка «Свой скилл» в сетке. */}
  </div>
      {/* Шеврон «показать все» — только когда строк действительно больше одной (chips.overflow
          меряется, а не угадывается) и только в схлопывающемся режиме. Разворачивает ВСЕ
          подсказки разом: со скиллами человек работает списком, а не выискивает нужную. */}
      {chipsCompact && chips.overflow && (
        <button
          onClick={chips.toggleExpanded}
          title={chips.expanded ? 'Свернуть подсказки' : 'Показать все подсказки'}
          aria-expanded={chips.expanded}
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
            padding: '6px 8px',
            borderRadius: 'var(--radius-chip)',
            border: '1px solid var(--glass-edge)',
            background: 'var(--surface-solid)',
            boxShadow: 'var(--shadow-chip)',
            color: 'var(--text-muted)',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--surface-solid)'; }}
        >
          <ChevronDown
            size={13}
            style={{
              transform: chips.expanded ? 'rotate(180deg)' : 'none',
              transition: 'transform var(--dur-fast) var(--ease-standard)',
            }}
          />
        </button>
      )}
      {/* В схлопнутом ряду «+» живёт здесь, в несдвигаемом хвосте, — иначе он уехал бы за
          обрез вместе с лишними строками. См. парную ветку внутри области чипов. */}
      {settingsChip}
      </div>
  );
}
