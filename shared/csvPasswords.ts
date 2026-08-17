// Разбор CSV-экспорта паролей из другого браузера — чистая логика, без Node и без DOM.
//
// Зачем это вообще есть. Chrome с версии 127 шифрует пароли схемой App-Bound (v20): ключ завёрнут
// ВТОРЫМ слоем в SYSTEM-DPAPI, и снять его без прав SYSTEM либо инъекции в процесс браузера нельзя
// (см. ChromiumPasswordReader.ts и разбор в истории задач). Лезть туда — это техника инфостилера,
// её пометит любой антивирус, и для браузера, которому нужна репутация издателя, это самоубийство.
// Санкционированный Google путь — экспорт паролей в CSV из самого Chrome
// (chrome://password-manager/passwords → «Экспорт»). Его и читаем: файл отдаёт сам пользователь,
// расшифровывать нечего.
//
// Формат Chrome/Edge/Brave: заголовок `name,url,username,password,note`. Firefox кладёт те же
// колонки url/username/password в другом порядке и с другими соседями. Поэтому колонки ищем ПО
// ИМЕНИ, а не по позиции. Значения — по RFC 4180: поле в кавычках может содержать запятую, перевод
// строки и удвоенную кавычку "".
//
// ⚠️ Значимых импортов тут быть НЕ должно, только типовые — проверка (scripts/csv-passwords-check.mjs)
// гоняет модуль голым node (та же причина, что в shared/chromeGround.ts).

export interface CsvPasswordRow {
  url: string;
  username: string;
  password: string;
}

/**
 * Токенизатор RFC 4180: строка CSV → массив строк, каждая — массив полей.
 *
 * ⚠️ Разбивать по '\n' и ',' наивно нельзя: и то, и другое законно живёт ВНУТРИ поля в кавычках
 * (пароль с запятой, заметка с переводом строки). Поэтому идём символ за символом с флагом «внутри
 * кавычек». Удвоенная кавычка "" внутри поля — это одна кавычка (единственный способ экранирования
 * в RFC 4180).
 */
function tokenize(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;

  // BOM в начале файла (Chrome его не пишет, но Excel и часть выгрузок пишут) — снимаем, иначе он
  // прилипает к имени первой колонки заголовка и та перестаёт совпадать с 'url'/'name'.
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };

  for (; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // "" → одна кавычка
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      endField();
    } else if (c === '\n') {
      endRow();
    } else if (c === '\r') {
      // CRLF: '\r' проглатываем, конец строки даст следующий '\n'. Одинокий '\r' (старый Mac) —
      // тоже конец строки.
      if (text[i + 1] !== '\n') endRow();
    } else {
      field += c;
    }
  }
  // Последняя строка без завершающего перевода строки. Пустой хвост (файл кончился на '\n') не
  // считаем строкой: там ровно одно пустое поле.
  if (field.length > 0 || row.length > 0) endRow();
  return rows;
}

/**
 * CSV-текст экспорта паролей → строки {url, username, password}.
 *
 * Отбрасываются: строки без url или без password (в них нечего переносить), и весь файл целиком,
 * если в заголовке нет колонок url и password (значит это не тот CSV — не молча тащим мусор).
 * username необязателен: у части записей его нет, колонка может отсутствовать вовсе.
 *
 * ⚠️ Пароль НЕ обрезаем по краям: ведущие/хвостовые пробелы бывают частью пароля. url и username
 * обрезаем — там пробел по краям всегда артефакт выгрузки.
 */
export function parseCsvPasswords(text: string): CsvPasswordRow[] {
  const rows = tokenize(text);
  if (rows.length < 2) return []; // только заголовок или пусто — переносить нечего

  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  const urlIdx = header.indexOf('url');
  const userIdx = header.indexOf('username');
  const passIdx = header.indexOf('password');
  if (urlIdx === -1 || passIdx === -1) return []; // не похоже на экспорт паролей

  const out: CsvPasswordRow[] = [];
  for (let r = 1; r < rows.length; r++) {
    const cols = rows[r]!;
    const url = (cols[urlIdx] ?? '').trim();
    const password = cols[passIdx] ?? '';
    if (!url || !password) continue;
    const username = userIdx === -1 ? '' : (cols[userIdx] ?? '').trim();
    out.push({ url, username, password });
  }
  return out;
}
