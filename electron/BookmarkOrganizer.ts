import type { BookmarkFolderProposal, BookmarkNode } from '../shared/ipc';
import { runTabOrganizePrompt } from './TranslationService';

// Умная раскладка закладок по папкам — Qwen предлагает, человек утверждает.
//
// ⚠️ Предлагаем ТОЛЬКО для закладок из корня. То, что человек уже разложил руками, модель не
// трогает: закладки — личная история, и «улучшить» чужую раскладку без спроса значит стереть
// решение, которого мы не понимаем. Отсюда же и весь режим «предложение → одобрение»: сама
// раскладка не применяется никогда.
//
// ⚠️ Ответ модели — ПОСТРОЧНЫЙ, а не JSON, дословно как у TabOrganizer.ts: на этом корпусе
// маленькая модель ломает JSON регулярно (ровно поэтому в проекте живёт normalizeQuiz), а
// «Название: 1,2,3» она держит.

const MAX_ITEMS = 120; // выше этого промпт перестаёт влезать в контекст, а качество падает
const TRASH_LABEL = 'Мусор';

interface Candidate { id: number; title: string; url: string }

function buildPrompt(lines: string[]): string {
  return (
    `Ниже пронумерованный список сохранённых закладок (заголовок и адрес).\n\n${lines.join('\n')}\n\n` +
    `Разложи закладки по папкам — по смыслу, по теме или по задаче, а не по формальному ` +
    `совпадению слов в заголовках. В папке минимум 2 закладки. Раскладывать нужно не всё: ` +
    `то, что не подходит ни к одной осмысленной папке, просто не упоминай — это нормально. ` +
    `Название папки — 1-3 слова по-русски, описывающие суть, а не повторяющие заголовок одной ` +
    `из закладок.\n\n` +
    // Мусор — обычная папка с обычным названием, никакой особой сущности в системе для неё нет.
    // Модель лишь узнаёт, что такое имя осмысленно, и складывает туда явно ненужное.
    `Отдельно: если среди закладок есть явно ненужные — служебные страницы, ошибки, ` +
    `«страница не найдена», случайно сохранённые пустышки — собери их в папку с названием ` +
    `«${TRASH_LABEL}».\n\n` +
    `Формат ответа — строго построчно, без вступлений и заключений, по одной папке на строку:\n` +
    `Название папки: номер,номер,номер\n\n` +
    `Пример:\n` +
    `Рецепты: 2,5,9\n` +
    `Работа: 1,3\n\n` +
    `Верни папки в указанном формате.`
  );
}

// Тот же разбор, что у групп вкладок: модель может вернуть несуществующий номер, повторить его
// в двух папках или дописать пояснение — невалидное отбрасываем молча, не падаем.
function parseAndValidate(raw: string, items: Candidate[]): BookmarkFolderProposal[] {
  const used = new Set<number>(); // повтор — выигрывает первое вхождение
  const out: BookmarkFolderProposal[] = [];

  for (const line of raw.split('\n')) {
    const m = line.match(/^\s*([^:]{1,60}):\s*([\d,\s]+)\s*$/);
    if (!m) continue;
    const label = m[1]!.trim().replace(/^[«"']|[»"']$/g, '');
    if (!label) continue;

    const ids: number[] = [];
    for (const raw of m[2]!.split(',')) {
      const n = Number(raw.trim());
      if (!Number.isInteger(n) || n < 1 || n > items.length) continue;
      if (used.has(n)) continue;
      used.add(n);
      ids.push(items[n - 1]!.id);
    }
    if (ids.length < 2) continue; // папка из одной закладки — не раскладка, а переименование
    out.push({ label, ids });
  }
  return out;
}

/**
 * Предложение раскладки. Ничего не меняет — только считает.
 * Пустой массив — законный исход: модель не нашла осмысленных папок.
 */
export async function suggestBookmarkFolders(tree: BookmarkNode[]): Promise<BookmarkFolderProposal[]> {
  // Модель поднимет сам runTabOrganizePrompt (ensureLoaded внутри) — отдельной проверки не надо.
  const items: Candidate[] = tree
    .filter((n) => n.kind === 'link')
    .slice(0, MAX_ITEMS)
    .map((n) => ({ id: n.id, title: n.title, url: n.url }));
  if (items.length < 4) return []; // на трёх закладках раскладка бессмысленна

  const lines = items.map((c, i) => `${i + 1}. ${c.title || c.url} — ${c.url}`);
  const result = await runTabOrganizePrompt(buildPrompt(lines), { role: 'organize' });
  // Отказ модели (не установлена, не загрузилась) — пустое предложение, а не исключение:
  // раскладка это предложение, и «модель промолчала» равносильно «предлагать нечего».
  // Причину человек и так увидит в разделе AI, городить второй канал ошибок незачем.
  if (!result.ok) {
    console.warn('[bookmarks] раскладка не сложилась:', result.error);
    return [];
  }
  // ⚠️ Обрыв по лимиту токенов (не eogToken) делает ПОСЛЕДНЮЮ строку заведомо неполной — она
  // могла потерять часть номеров. Отбрасываем только её, остальные папки уже целые. Тот же
  // приём, что в TabOrganizer.ts.
  const lines2 = result.out.split('\n');
  if (result.stopReason !== 'eogToken' && lines2.length > 1) lines2.pop();
  return parseAndValidate(lines2.join('\n'), items);
}
