import type { DocSpec } from '../../../../shared/notebookDoc';
import { wrapDoc } from './shell';
import * as report from './report';
import * as spread from './spread';
import * as cards from './cards';

// Три шаблона документа — ТРИ РЕНДЕРЕРА ОДНОЙ СТРУКТУРЫ, а не три промпта.
//
// ⚠️ Модель по-прежнему отдаёт {title, blocks[]} из закрытого каталога (shared/notebookDoc.ts).
// Шаблон решает только, КАК эти блоки нарисовать: metrics в отчёте — три плитки, в развороте —
// плакатная полоса во всю ширину, в конспекте — карточка с крупным числом. Отсюда три
// следствия: шаблон переключается ПОСЛЕ генерации без повторного прогона модели; новый шаблон
// стоит одного файла; и ни один из них не просит модель ничего «придумать» — то есть мы не
// возвращаемся к тому, из-за чего дважды выбрасывали генерацию HTML.

export type DocTemplate = 'report' | 'spread' | 'cards';

export const DOC_TEMPLATES: { id: DocTemplate; label: string; hint: string }[] = [
  { id: 'report', label: 'Отчёт',    hint: 'Одна колонка, оглавление, печатается' },
  { id: 'spread', label: 'Разворот', hint: 'Журнальный: обложка, полоса цифр, поля' },
  { id: 'cards',  label: 'Конспект', hint: 'Карточками — читается кусками' },
];

const RENDER = { report, spread, cards } as const;

/**
 * Подходит ли шаблон этому документу.
 *
 * ⚠️ Это НЕ запрет, а честность: «Разворот» без чисел показывает пустую плакатную полосу, а
 * «Конспект» на пяти тысячах знаков растягивает карточки в нечитаемые простыни. Предлагать
 * шаблон, который развалится на этом материале, хуже, чем не предлагать его вовсе — человек
 * выберет, увидит поломку и решит, что сломан документ.
 */
export function isTemplateFit(spec: DocSpec, id: DocTemplate): boolean {
  if (id === 'report') return true;                                    // подходит всегда
  if (id === 'spread') return spec.blocks.some((b) => b.kind === 'metrics');
  return docChars(spec) <= CARDS_MAX_CHARS;
}

// Порог взят с макета: на 5 400 знаках конспект уже проигрывал обоим соседям, на 3 000 ещё
// держится. Это про длину АБЗАЦЕВ, а не про число блоков — карточка ломается именно текстом.
const CARDS_MAX_CHARS = 3500;

export function docChars(spec: DocSpec): number {
  let n = 0;
  for (const b of spec.blocks) {
    n += (b.title?.length ?? 0) + (b.text?.length ?? 0);
    for (const x of b.items ?? []) n += x.length;
    for (const p of b.pairs ?? []) n += p.label.length + p.value.length;
  }
  return n;
}

/** Готовый самодостаточный .html: и предпросмотр, и выгрузка, и открытие вкладкой. */
export function docToHtml(spec: DocSpec, id: DocTemplate): string {
  const t = RENDER[id];
  const meta = `${new Date().toLocaleDateString('ru-RU')} · собрано в Oblako`;
  return wrapDoc(spec, t.CSS, t.body(spec, meta));
}
