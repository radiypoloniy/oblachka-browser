import type { SemanticSearchResult } from './ipc/history';
import { normalizeForOmnibox } from './frecency';

export const HISTORY_EXPANSION_PROMPT = 'Ты формулируешь поисковые запросы к уже прочитанным статьям. Не отвечай на вопрос и не придумывай страницы. '
  + 'Верни JSON с first и second: две короткие поисковые формулировки по 2-4 значимых слова, максимум 80 символов каждая. '
  + 'Первая — общепринятый термин для описанного явления, вторая — другая формулировка того же смысла. '
  + 'Для явно английского материала используй английские термины. Сохрани номера, имена, бренды и ограничения; не расширяй до соседней темы. '
  + 'Если смысл неясен, верни пустые строки. Пользователь ищет: ';

export function parseHistoryExpansion(raw: string, original: string): string[] {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid search expansion');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => key !== 'first' && key !== 'second')
    || typeof record.first !== 'string' || typeof record.second !== 'string') throw new Error('Invalid search expansion');
  const seen = new Set([original.trim().toLowerCase()]), result: string[] = [];
  const numbers = original.match(/\d+(?:[-./]\d+)+/g) ?? [];
  for (const text of [record.first, record.second]) {
    if (text.length > 80 || /[\r\n]/.test(text)) throw new Error('Oversized search expansion');
    let query = text.trim();
    if (!query) continue;
    // Расширение не может превратить обязательный номер версии в необязательный.
    for (const number of numbers) if (!query.includes(number)) query += ` ${number}`;
    if (query.length > 120) throw new Error('Oversized search expansion');
    if (!seen.has(query.toLowerCase())) { seen.add(query.toLowerCase()); result.push(query); }
  }
  return result;
}

interface CandidateSet { candidates: SemanticSearchResult[]; lexicalKeys: ReadonlySet<string> }
export function mergeExpandedHistory(base: CandidateSet, extra: CandidateSet[]): CandidateSet {
  const rows = new Map<string, { candidate: SemanticSearchResult; score: number; original: boolean }>();
  for (const [source, set] of [base, ...extra].entries()) {
    for (const [rank, candidate] of set.candidates.entries()) {
      const key = normalizeForOmnibox(candidate.url), row = rows.get(key);
      const score = (source === 0 ? 1 : 0.5) / (60 + rank + 1);
      if (row) {
        row.score += score;
        if (!row.candidate.snippet && candidate.snippet) row.candidate = candidate;
      } else rows.set(key, { candidate, score, original: source === 0 });
    }
  }
  const sorted = [...rows.entries()].sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]));
  const selected = new Map<string, SemanticSearchResult>();
  for (const candidate of base.candidates) {
    const key = normalizeForOmnibox(candidate.url);
    if (base.lexicalKeys.has(key) && selected.size < 8) selected.set(key, rows.get(key)!.candidate);
  }
  // Новому источнику нужно место даже при двадцати исходных кандидатах.
  for (const [key, row] of sorted.filter(([, row]) => !row.original).slice(0, 4)) selected.set(key, row.candidate);
  for (const [key, row] of sorted) {
    if (selected.size >= 20) break;
    if (!selected.has(key)) selected.set(key, row.candidate);
  }
  return { candidates: [...selected.values()], lexicalKeys: base.lexicalKeys };
}
