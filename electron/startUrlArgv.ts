import path from 'node:path';
import { app } from 'electron';
import { localPathToFileUrl } from './localFileUrl';

// ── Адрес, с которым нас запустили ───────────────────────────────────────────
//
// ⚠️ Отдельным файлом от main.ts: это разбор argv, а main — сборщик приложения. Связи с ним
// никакой, кроме одного вызова, зато оба ⚠️-разбора ниже оплачены живыми случаями и читаются
// как одна история. main.ts при этом за порогом храповика структуры, и место под новую работу
// в нём освобождается выносом, а не поднятием базы.

// Ссылка среди аргументов запуска. ⚠️ Берём только http/https: в argv лежат и путь к самому
// приложению, и ключи Chromium (--user-data-dir и прочие), и принимать оттуда произвольную
// строку как адрес — значит открывать что попало по чужой команде.
/**
 * Лежит ли путь ВНУТРИ самого приложения.
 *
 * ⚠️ Заведено по живому случаю, а не «на всякий случай». `node-llama-cpp` перед загрузкой
 * нативного бинарника проверяет его в отдельном процессе и делает это через
 * `child_process.fork(__filename)`. В упакованном приложении `fork` берёт `process.execPath`, то
 * есть запускает ВТОРОЙ ЭКЗЕМПЛЯР Oblako.exe, передав ему путь к своему же `testBindingBinary.js`
 * аргументом. Замок одного экземпляра пересылает аргументы первому окну — и человек получал
 * вкладку с исходником библиотеки на каждом запуске браузера.
 *
 * ⚠️ Отсекаем по КАТАЛОГУ, а не по расширению: запрет на `.js` лечил бы ровно этот случай и
 * промахнулся бы на следующем таком же, а открывать собственные внутренности вкладкой у нас нет
 * причин вообще — что бы там ни лежало.
 */
function insideAppBundle(filePath: string): boolean {
  const resolved = path.resolve(filePath).toLowerCase();
  const roots = [process.resourcesPath, path.dirname(process.execPath), app.getAppPath()]
    .filter((r): r is string => typeof r === 'string' && r.length > 0)
    .map((r) => path.resolve(r).toLowerCase());
  return roots.some((root) => resolved === root || resolved.startsWith(root + path.sep));
}

export function firstUrlFromArgv(argv: string[]): string | null {
  for (const arg of argv.slice(1)) {
    if (arg.startsWith('-')) continue; // ключи Chromium (--user-data-dir и прочие) адресами не бывают
    if (/^https?:\/\//i.test(arg)) return arg;
    if (/^file:\/\//i.test(arg)) return arg;
    // Свои же файлы вкладкой не открываем — см. разбор у insideAppBundle.
    if (insideAppBundle(arg)) continue;
    // ⚠️ И ПУТЬ К ФАЙЛУ ТОЖЕ. Установщик регистрирует за нами .htm/.html, то есть система
    // запускает `Oblako.exe "C:\...\page.html"` — без этой ветки такой запуск не открывал ничего
    // вовсе. Существование файла проверяется внутри, каталоги отсекаются там же: в dev-режиме
    // аргументом идёт папка приложения.
    const file = localPathToFileUrl(arg);
    if (file) return file;
  }
  return null;
}
