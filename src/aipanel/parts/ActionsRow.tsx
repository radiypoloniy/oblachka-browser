import type React from 'react';
import { ChipsRow } from './ChipsRow';
import { FactCheckConfirm } from './FactCheckConfirm';
import { CAPS, DISPLAY_ROW, TEXT } from '../../styles/system';
import type { SkillItem } from '../contract';
import type { useChipsRow } from '../useChipsRow';

/**
 * Ряд действий над полем ввода: скиллы, перевод, фактчек и плашка согласия к нему.
 *
 * ⚠️ Самый длинный кусок панели и самый разнородный: три независимых действия, у каждого своя
 * занятость и свои условия показа. Вынесен из AiPanel по той же причине, что шаги из мастера
 * онбординга — правка одного действия не должна требовать прочитать остальные два.
 */
export function ActionsRow({
  chips, chipsBusy, chipsCompact, factCheckAvailable, skills,
  settingsChip, showFactCheckConfirm, webGroundingActive,
  setShowFactCheckConfirm, sendText, sendQuickTranslate, sendFactCheck,
}: {
  chips: ReturnType<typeof useChipsRow>;
  chipsBusy: boolean;
  chipsCompact: boolean;
  factCheckAvailable: boolean;
  skills: SkillItem[];
  settingsChip: React.ReactNode;
  showFactCheckConfirm: boolean;
  webGroundingActive: boolean;
  setShowFactCheckConfirm: (v: boolean) => void;
  sendText: (text: string, web: boolean) => void;
  sendQuickTranslate: () => void;
  sendFactCheck: () => void;
}) {
  return (
    <>
  {(
    // ⚠️ ТРИ ветки, и у каждой свой key. React переиспользует узел того же типа в той же
    // позиции, а к узлу ряда привязан ResizeObserver замера строки — именно так однажды
    // и вышло, что он мерил плашку фактчека вместо ряда (разбор в useChipsRow). Разные key
    // заставляют React честно размонтировать предыдущую ветку: ref-колбэк получает null,
    // наблюдатель отцепляется, мусорных чисел не остаётся.
    showFactCheckConfirm ? (
      <FactCheckConfirm
        key="factcheck-confirm"
        onCancel={() => setShowFactCheckConfirm(false)}
        onConfirm={() => { setShowFactCheckConfirm(false); sendFactCheck(); }}
      />
    ) : (
      <>
      {/* ПУСТАЯ БЕСЕДА — два наших действия крупно, остальное тем же рядом, что и в беседе.
          ⚠️ Раньше здесь была СЕТКА КАРТОЧЕК по 92 px: восемь скиллов плюс пунктирная
          «Свой скилл» — 492 px из ~700, то есть выбор занимал больше места, чем ответ,
          ради которого панель открыли. И это был ВТОРОЙ интерфейс: до беседы карточки,
          после — чипы; два места, где всё ломается по-разному.
          ⚠️ Крупными остаются только «Перевести» и «Фактчек»: их задаём мы, они про
          страницу и работают на любой. Скиллы человек пишет сам, их число растёт — им ряд.
          ⚠️ Подпись-промпт с карточек ушла совсем: `skill.prompt.slice(0, 64)` — это
          внутренность наружу («Напиши SEO-заголовок… Требования: …»). Полный текст живёт
          в подсказке чипа и в настройках, где его и правят. */}
      {!chipsCompact && (
        <div style={{
          padding: `0 var(--pad-island)`, marginBottom: 8, flexShrink: 0,
          display: 'grid', gridTemplateColumns: factCheckAvailable ? '1fr 1fr' : '1fr', gap: 8,
        }}>
          <PrimaryAction
            icon="🌐" label="Перевести" hint="Страницу на русский"
            bg="var(--text-strong)" ink="var(--app-bg)"
            busy={chipsBusy} onPress={sendQuickTranslate}
          />
          {factCheckAvailable && (
            <PrimaryAction
              icon="🔍" label="Фактчек" hint="Проверить в сети"
              bg="var(--poster-tea)" ink="var(--on-poster-light)"
              busy={chipsBusy} onPress={() => setShowFactCheckConfirm(true)}
            />
          )}
        </div>
      )}
      {!chipsCompact && (
        <span className="ai-empty-hint" style={{
          ...CAPS, display: 'block', padding: `0 var(--pad-island)`, marginBottom: 6,
        }}>
          скиллы
        </span>
      )}

      {/* Внешняя строка: слева переносящаяся область чипов, справа НЕСДВИГАЕМЫЙ хвост
          (шеврон + настройки). Хвост вынесен из потока чипов намеренно — попав в перенос, он
          уезжал бы во вторую строку и в схлопнутом виде становился недоступен, а это
          единственные две кнопки, которые обязаны быть под рукой всегда. */}
      <ChipsRow
        chips={chips} chipsBusy={chipsBusy} chipsCompact={chipsCompact}
        factCheckAvailable={factCheckAvailable} skills={skills}
        webGroundingActive={webGroundingActive}
        settingsChip={settingsChip} setShowFactCheckConfirm={setShowFactCheckConfirm}
        sendText={sendText} sendQuickTranslate={sendQuickTranslate}
      />
      </>
    )
  )}
    </>
  );
}

function PrimaryAction({ icon, label, hint, bg, ink, busy, onPress }: {
  icon: string
  label: string
  hint: string
  bg: string
  ink: string
  busy: boolean
  onPress: () => void
}) {
  return (
    <button
      onClick={onPress}
      disabled={busy}
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
        padding: '10px 12px', textAlign: 'left', font: 'inherit',
        borderRadius: 'var(--radius-card)', border: 'none',
        background: bg, color: ink,
        boxShadow: 'var(--shadow-chip)',
        cursor: busy ? 'default' : 'pointer',
        opacity: busy ? 0.5 : 1,
        transition: 'transform var(--dur-fast) var(--ease-out)',
      }}
      onMouseEnter={(e) => { if (!busy) e.currentTarget.style.transform = 'translateY(-2px)' }}
      onMouseLeave={(e) => { e.currentTarget.style.transform = 'none' }}
    >
      <span style={{ ...DISPLAY_ROW, display: 'block', color: 'inherit' }}>
        <span style={{ marginRight: 6 }}>{icon}</span>{label}
      </span>
      <span style={{
        ...TEXT.caption, color: 'inherit', opacity: 0.72,
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%',
      }}>{hint}</span>
    </button>
  )
}
