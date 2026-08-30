import { AlertCircle, Check, Clock, Hand, Loader2 } from 'lucide-react';
import type { GraphNodeStatus } from '../../../shared/graph';

// ── Состояние узла: цвет, слово, значок ──────────────────────────────────────
//
// Вынесено из карточки: те же три карты нужны и подвалу узла, и раскрытому виду, и полосе
// прогона. Пока они жили внутри GraphNodeCard, каждый второй потребитель заводил свою копию
// названий состояний — а состояний семь, и разъехаться им нечего стоит.

export const STATUS_TONE: Record<GraphNodeStatus, string> = {
  idle: 'var(--text-faint)',
  stale: 'var(--warning-500)',
  queued: 'var(--text-muted)',
  running: 'var(--accent)',
  // Жёлтый, как и «устарел»: оба состояния означают «нужно вмешательство», а не поломку.
  awaiting: 'var(--warning-500)',
  // Зелёный функционален по цветовому закону проекта: результат посчитан локальной моделью
  // на этой машине — тот же смысл, что у --dot-local в статусе модели.
  done: 'var(--dot-local)',
  error: 'var(--danger-500)',
};

export const STATUS_HINT: Record<GraphNodeStatus, string> = {
  idle: 'Не считался',
  stale: 'Устарел — входные данные изменились',
  queued: 'Ждёт очереди',
  running: 'Считается',
  awaiting: 'Ждёт вас — откройте чат и заберите ответ',
  done: 'Готово',
  error: 'Ошибка',
};

/**
 * Слово статуса в подвале карточки.
 *
 * ⚠️ Слово, а не только значок, и не только подсказка по наведению. Цветовой закон говорит про
 * статус «значок И слово»; до сих пор состояние жило одним цветным глифом с title — то есть
 * читалось лишь тем, кто задержит курсор.
 */
export const STATUS_WORD: Record<GraphNodeStatus, string> = {
  idle: 'не считался',
  stale: 'устарел',
  queued: 'в очереди',
  running: 'считается',
  awaiting: 'ждёт вас',
  done: 'готово',
  error: 'ошибка',
};

export function StatusIcon({ status }: { status: GraphNodeStatus }) {
  const color = STATUS_TONE[status];
  if (status === 'running') return <Loader2 size={13} color={color} className="oblako-graph-spin" />;
  if (status === 'awaiting') return <Hand size={13} color={color} />;
  if (status === 'error') return <AlertCircle size={13} color={color} />;
  if (status === 'done') return <Check size={13} color={color} />;
  if (status === 'queued') return <Clock size={13} color={color} />;
  return <span style={{ width: 7, height: 7, borderRadius: '50%', background: color, display: 'inline-block' }} />;
}
