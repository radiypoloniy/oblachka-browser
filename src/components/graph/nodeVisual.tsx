import {
  Globe, FileText, PenLine, Image as ImageIcon,
  Brain, MessageSquare, Palette, Bot,
  Search, ShieldCheck,
  ScrollText, Network, BarChart3, HelpCircle,
  SquarePen, Layers, Target,
  StickyNote,
  type LucideIcon,
} from 'lucide-react';
import type { GraphNodeKind } from '../../../shared/graph';
import type { PosterTone } from '../settings/kit';
import { toneVars } from '../settings/kit';

// ── Как выглядит узел: роль, тон, значок ─────────────────────────────────────
//
// Один модуль на три вещи, которые обязаны совпадать: группа в библиотеке, цвет карточки и
// значок. Раньше они лежали в трёх местах — группы в GraphCanvas, эмодзи в shared/graph.ts,
// цвета не было вовсе, — и разъехаться могли молча.
//
// ⚠️ Роль узла КРАСИТ карточку, потому что граф — это СОДЕРЖИМОЕ, а не хром. По дизайн-системе
// у содержимого свои плакатные тона, своя гарнитура и своя геометрия; граф же был собран из
// --surface-island и --divider, то есть говорил языком панели настроек. Тон по роли — тот же
// приём, что SECTION_TONE: цвет закреплён навсегда и узнаётся раньше, чем прочитана подпись.

/**
 * Тон графа. ⚠️ `neutral` не входит в PosterTone и не должен: плакатных цветов ровно шесть, и
 * шестёрка — потолок набора (см. разбор у --poster-neutral в colors.css). Нейтраль здесь нужна
 * терминальному узлу: «Результат» не имеет своей темы, он просто конец цепочки, и цвет на нём
 * означал бы роль, которой нет.
 */
export type GraphTone = PosterTone | 'neutral';

/** Переменные тона для карточки узла. Для шести плакатных — та же формула, что у настроек. */
export function graphToneVars(tone: GraphTone): React.CSSProperties {
  if (tone !== 'neutral') return toneVars(tone);
  return {
    ['--section-tone' as string]: 'var(--poster-neutral)',
    ['--section-ink' as string]: 'var(--on-poster-light)',
    ['--section-soft' as string]: 'color-mix(in srgb, var(--poster-neutral) 14%, transparent)',
    ['--section-edge' as string]: 'color-mix(in srgb, var(--poster-neutral) 42%, transparent)',
  };
}

/** Группы библиотеки: откуда взять — что сделать — что получить. */
export const NODE_GROUPS: { title: string; tone: GraphTone; kinds: GraphNodeKind[] }[] = [
  { title: 'Откуда', tone: 'tea', kinds: ['source.url', 'source.file', 'source.note', 'source.image'] },
  { title: 'Обработка', tone: 'tangerine', kinds: ['qwen.transform', 'qwen.chat', 'image.prompt', 'webapp.chat'] },
  { title: 'Проверка', tone: 'mustard', kinds: ['search.web', 'factcheck.gemini'] },
  { title: 'Артефакты', tone: 'lime', kinds: ['artifact.summary', 'artifact.mindmap', 'artifact.infographic', 'artifact.quiz'] },
  { title: 'Итог', tone: 'neutral', kinds: ['draft.text', 'compose.doc', 'output.text'] },
  { title: 'Пометки', tone: 'sky', kinds: ['sticker'] },
];

/**
 * Тон каждого узла. Выводится ИЗ ГРУПП, а не пишется вторым списком: две карты пришлось бы
 * держать в согласии руками, и новый узел получил бы группу без цвета или наоборот.
 */
export const NODE_TONE = Object.fromEntries(
  NODE_GROUPS.flatMap((g) => g.kinds.map((k) => [k, g.tone] as const)),
) as Record<GraphNodeKind, GraphTone>;

/**
 * Значок узла.
 *
 * ⚠️ lucide, а не эмодзи, и это самая заметная правка подгонки. Эмодзи рисуются шрифтом
 * операционной системы: свой набор на Windows 10 и 11, своя высота по базовой линии, свой вид в
 * тёмной теме — рядом с обводкой 1.6, которой набран весь остальной браузер, они читались
 * вставкой из чужого приложения. Плюс эмодзи нельзя покрасить, а значку на цветной карточке
 * нужен цвет краски этого тона.
 */
export const NODE_ICON: Record<GraphNodeKind, LucideIcon> = {
  'source.url': Globe,
  'source.file': FileText,
  'source.note': PenLine,
  'source.image': ImageIcon,
  'qwen.transform': Brain,
  'qwen.chat': MessageSquare,
  'image.prompt': Palette,
  'webapp.chat': Bot,
  'search.web': Search,
  'factcheck.gemini': ShieldCheck,
  'artifact.summary': ScrollText,
  'artifact.mindmap': Network,
  'artifact.infographic': BarChart3,
  'artifact.quiz': HelpCircle,
  'draft.text': SquarePen,
  'compose.doc': Layers,
  'output.text': Target,
  sticker: StickyNote,
};

/** Значок узла нужного размера. Обводка — как у всего хрома, чтобы вес глифов совпадал. */
export function NodeIcon({ kind, size = 16 }: { kind: GraphNodeKind; size?: number }) {
  const Icon = NODE_ICON[kind];
  return <Icon size={size} strokeWidth={1.6} style={{ flex: 'none' }} aria-hidden />;
}

/** Круглая кнопка в шапке узла. Одна на карточку, стикер и раскрытый вид. */
export const headerButton: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 22, height: 22, flex: 'none', padding: 0,
  background: 'none', border: 0, borderRadius: '50%',
  // ⚠️ Не серый хрома, а краска родителя: те же кнопки стоят и на цветной плите шапки, где
  // --text-faint читался бы грязным пятном. Приглушение даёт opacity, а не второй цвет.
  color: 'currentColor', opacity: 0.72, cursor: 'pointer',
};
