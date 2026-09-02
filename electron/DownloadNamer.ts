// Имя файла по СОДЕРЖИМОМУ для скачанного документа (AI-IDEAS.md №3).
//
// Зачем. Скачанные документы называются `document(3).pdf`, `scan_20260804.pdf`, `vypiska.pdf` —
// из метаданных PDF осмысленное имя достаётся примерно никогда, а руками их не переименовывает
// никто. Модель читает первую страницу и отдаёт строку вида «Договор аренды — ООО Ромашка».
//
// Устройство — как у TabRenamer.ts: прямой промпт через TranslationService, чистка ответа кодом.
// ⚠️ Промпт ПО-РУССКИ, в отличие от TabSearch/SmartFind, и это не забывчивость: правило «инструкции
// по-английски» выведено на задачах ВЫБОРА из списка, где модель норовила переписать список
// обратно. Здесь задача другая — породить короткую русскую строку, и на ней в проекте уже
// измеренно работает русский промпт TabRenamer'а. Держим одну форму на две одинаковые задачи.
//
// ⚠️ Гейта isModelWarm() здесь НЕТ намеренно: человек нажал кнопку в поповере — это явное
// действие, и ждать загрузку модели оно вправе (то же решение, что у смыслового Ctrl+F).
import fs from 'node:fs/promises';
import path from 'node:path';
import { extractFileText } from './FileExtract';
import { runTabOrganizePrompt } from './TranslationService';
import { uniquePath } from './DownloadManager';
import { sanitizeFileNameBase } from '../shared/fileNameSafety';

// Начало документа описывает его лучше всего — шапка, стороны, предмет, дата. Дальше идёт тело,
// которое имя только разбавляет и замедляет прогон.
const CONTEXT_CHARS = 2500;
function buildPrompt(currentName: string, text: string): string {
  return [
    'Ты придумываешь имена файлов для скачанных документов.',
    '',
    'Правила:',
    '- Назови документ так, как назвал бы его человек, разбирая свои бумаги.',
    '- По-русски, 3–7 слов. Не длиннее 60 символов.',
    '- Начни с ВИДА документа (договор, счёт, справка, выписка, инструкция, резюме, отчёт).',
    '- Добавь то, что отличает его от соседних: стороны, организацию, номер, период.',
    '- Части разделяй тире с пробелами.',
    // ⚠️ Прямой запрет на расширение: подставим его сами и только исходное. Иначе модель
    // дописывает «.pdf» к имени, и в файле получается «Договор.pdf.pdf».
    '- НЕ пиши расширение файла и НЕ ставь точку в конце.',
    '- Без кавычек, эмодзи и пояснений — только само имя.',
    '',
    'Примеры: «Договор аренды — ООО Ромашка — 2026-08»,',
    '«Счёт на оплату №451 — Ситилинк», «Справка 2-НДФЛ — 2025».',
    '',
    `Текущее имя файла: ${currentName}`,
    'Начало документа:',
    text.slice(0, CONTEXT_CHARS),
    '',
    'Имя файла:',
  ].join('\n');
}

/**
 * Предлагает имя для скачанного файла. НИЧЕГО не переименовывает — только считает: применяет
 * имя человек отдельным действием (см. renameDownloadedFile).
 *
 * Возвращает полное имя с ИСХОДНЫМ расширением: менять расширение модели не позволено нигде.
 */
export async function suggestFileName(
  savePath: string,
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  if (!savePath) return { ok: false, error: 'У файла нет пути' };
  const currentName = path.basename(savePath);
  const ext = path.extname(savePath);

  const extracted = await extractFileText(savePath);
  if (!extracted.ok || !extracted.text) {
    return { ok: false, error: extracted.error ?? 'Не удалось прочитать файл' };
  }
  // Слишком короткий текст — не документ, а обрывок: имя вышло бы выдумкой.
  if (extracted.text.trim().length < 60) {
    return { ok: false, error: 'В файле почти нет текста — назвать нечем' };
  }

  const res = await runTabOrganizePrompt(buildPrompt(currentName, extracted.text), { role: 'organize' });
  if (!res.ok) return { ok: false, error: res.error };

  const name = sanitizeFileNameBase(res.out, ext);
  // Сырой ответ в лог: без него «модель не назвала» неотличимо от «мы забраковали нормальное имя»
  // — ровно на этом в TabRenamer держался баг с огрызками.
  console.log(`[file-name] «${currentName}» → ${name ? `«${name}${ext}»` : 'отказ'}, ответ модели: ${JSON.stringify(res.out.trim().slice(0, 80))}`);
  if (!name) return { ok: false, error: 'Модель не дала имени' };
  return { ok: true, name: name + ext };
}

/**
 * Переименование файла на диске.
 *
 * ⚠️ Действие НЕОБРАТИМО для человека, если он его не заметил, поэтому здесь всё сужено:
 *  • меняется ТОЛЬКО имя, папка остаётся прежней (`path.basename` у присланного имени — защита
 *    от «../» и абсолютного пути, пришедших из renderer'а);
 *  • расширение принудительно остаётся исходным — переименование не должно превращать pdf в exe;
 *  • столкновение имён разводится тем же `uniquePath`, что и при самой загрузке: молча затереть
 *    чужой файл — худший из возможных исходов.
 */
export async function renameDownloadedFile(
  savePath: string,
  proposed: string,
): Promise<{ ok: true; savePath: string; filename: string } | { ok: false; error: string }> {
  const ext = path.extname(savePath);
  const base = sanitizeFileNameBase(path.basename(proposed), ext);
  if (!base) return { ok: false, error: 'Такое имя файла не подойдёт' };

  const dir = path.dirname(savePath);
  const target = uniquePath(dir, base + ext);
  if (target === savePath) return { ok: true, savePath, filename: path.basename(savePath) };

  try {
    await fs.rename(savePath, target);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: false, error: 'Файла на месте уже нет' };
    if (code === 'EPERM' || code === 'EBUSY') return { ok: false, error: 'Файл занят другой программой' };
    return { ok: false, error: `Не удалось переименовать: ${(e as Error).message}` };
  }
  return { ok: true, savePath: target, filename: path.basename(target) };
}
