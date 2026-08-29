import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { SkillItem } from './contract';

// Запас высоты у схлопнутого ряда подсказок: обрезка идёт по нижнему краю первой строки, и без
// запаса она срезала бы --shadow-chip у самих чипов. Меньше зазора между строками (6) — иначе в
// щель заглядывала бы вторая строка.
const COLLAPSED_SLACK = 4

/**
 * Ряд кнопок-подсказок: схлопнут до одной строки в начатой беседе, разворачивается шевроном.
 *
 * ⚠️ Схлопывание ВИЗУАЛЬНОЕ: перенос по строкам остаётся, лишние строки обрезаны по max-height.
 * Прокрутки вбок здесь быть не должно, хотя напрашивается (и была в первой версии — снята по
 * живой жалобе). Смысловая причина: скиллов у человека может быть десять, горизонтальная полоса
 * даёт доступ к трём, пряча остальные за жестом, которого в узкой панели не видно. Техническая:
 * `overflow-x: auto` в одиночку не даёт горизонтального скроллера — по CSS вторая ось перестаёт
 * быть `visible` и тоже становится `auto`, а вертикальное колесо Chromium переводит в
 * горизонтальную прокрутку только для СТРОГО горизонтальных. Симптом — «кнопки не прокручиваются».
 *
 * ⚠️ Высота строки и признак «строк больше одной» МЕРЯЮТСЯ, а не задаются числом: высота чипа
 * зависит от --fs-xs и наличия иконки, а сколько их влезло — от ширины панели, которую тянут мышью.
 */
export function useChipsRow(opts: {
  /** Беседа начата — ряд живёт в одну строку. */
  compact: boolean
  /** Меняют содержимое ряда, а значит и его раскладку, без всякого ресайза. */
  skills: SkillItem[]
  factCheckAvailable: boolean
}) {
  const { compact, skills, factCheckAvailable } = opts

  const elRef = useRef<HTMLDivElement | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)
  const [rowH, setRowH] = useState(0)
  const [fullH, setFullH] = useState(0)
  const [overflow, setOverflow] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const measure = useCallback(() => {
    const el = elRef.current
    if (!el) return
    const first = el.firstElementChild as HTMLElement | null
    const last = el.lastElementChild as HTMLElement | null
    if (!first || !last) return
    // ⚠️ «Строк больше одной» считается по РАСКЛАДКЕ ДЕТЕЙ, а не по scrollHeight ряда. Схлопнутый
    // ряд зажат max-height и обрезан overflow:hidden, и что при этом считать высотой его
    // содержимого — вопрос тонкий; offsetTop детей от обрезки не зависит вовсе, чипы стоят там же,
    // просто не видны. Перенос заполняет строки по порядку, поэтому последний чип всегда в
    // последней строке — сравнения первого с последним достаточно.
    const h = first.offsetHeight
    const full = last.offsetTop - first.offsetTop + last.offsetHeight
    const multiRow = last.offsetTop > first.offsetTop
    if (h) setRowH((prev) => (prev === h ? prev : h))
    setFullH((prev) => (prev === full ? prev : full))
    setOverflow((prev) => (prev === multiRow ? prev : multiRow))
  }, [])

  // ⚠️ Ref-КОЛБЭК, а не useRef, и наблюдатель живёт в нём же — иначе фактчек ломает весь ряд.
  // Плашка подтверждения фактчека стоит в ТОЙ ЖЕ позиции тернарника, что и ряд подсказок, а React
  // при совпадении типа узла переиспользует его, а не создаёт новый. Прежняя версия захватывала
  // элемент в замыкание эффекта, и ResizeObserver оставался висеть на этом общем узле: смена
  // размера «ряд → плашка» будила его, и он мерил ПЛАШКУ — за высоту строки принималась высота
  // абзаца про приватность. Мусорные числа жили дальше, потому что после возврата ряда ни одна
  // зависимость эффекта не менялась (беседа уже начата — compact и так true). Живой симптом:
  // после фактчека шеврон пропадал и возвращался только при переходе на другую страницу, где
  // onContext сбрасывает ленту и тем самым дёргает пересчёт.
  const attach = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect()
    roRef.current = null
    elRef.current = el
    if (!el) return // ряд сейчас не показан (его место занято плашкой) — мерить нечего
    // Ширину панели тянут мышью, и от неё зависит, сколько чипов влезло в строку.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    roRef.current = ro
    measure()
  }, [measure])

  // Содержимое ряда меняется и без ресайза: пришли скиллы, подключили ключ Gemini, развернули
  // список, началась беседа. setState внутри срабатывает только на изменение — цикла нет.
  useLayoutEffect(measure, [measure, skills, factCheckAvailable, compact, expanded])

  // Схлопнуто — ровно одна строка; развёрнуто — измеренная полная высота (не `undefined`: к нему
  // max-height не анимируется, ряд бы прыгал); пустая беседа — без ограничения вовсе. Пока высота
  // не измерена, ограничения тоже нет: лучше кадр полной высоты, чем кадр со срезанными
  // наполовину кнопками.
  const maxHeight = !compact ? undefined
    : expanded ? (fullH ? fullH + COLLAPSED_SLACK : undefined)
      : (rowH ? rowH + COLLAPSED_SLACK : undefined)

  return {
    attach,
    maxHeight,
    /** Строк действительно больше одной — только тогда есть смысл в шевроне. */
    overflow,
    expanded,
    toggleExpanded: useCallback(() => setExpanded((v) => !v), []),
  }
}
