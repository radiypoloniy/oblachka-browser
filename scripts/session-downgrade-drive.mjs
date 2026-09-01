// Откат на старую версию не уничтожает открытые вкладки. Не *-check.mjs — поднимает приложение.
//
// ⚠️ ЗАЧЕМ, и почему именно сейчас. Автообновление в браузере есть, а значит появляется сценарий,
// которого раньше физически не было: человек получил новую версию, та записала session.json нового
// формата, человек откатился на старую сборку. Она формата не знает — и до этой правки поступала
// так: не восстанавливала ничего (полбеды, «вкладки не открылись»), а потом первое же закрытие
// окна ПЕРЕЗАПИСЫВАЛО файл своим форматом. Вкладки исчезали навсегда, включая те, что вернулись бы
// при повторном обновлении.
//
// ⚠️ Проверяется именно СОХРАННОСТЬ, а не восстановление. Прочитать файл из будущего сборка не
// может и не должна пытаться: гадать о незнакомом формате — верный способ восстановить мусор
// вместо вкладок. Единственное, что она обязана сделать, — не уничтожить его.
//
// ⚠️ Версия в файле берётся заведомо недостижимая (99), а не «текущая плюс один»: прогон не должен
// краснеть от того, что формат сессии однажды дорастёт до шестой версии.
//
// Запуск: npm run drive -- session-downgrade
import fs from 'node:fs';
import path from 'node:path';
import { withStand, wait } from './isolated-stand.mjs';

let ok = 0;
let bad = 0;
const check = (what, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ok   ${what}${detail ? ` — ${detail}` : ''}`); }
  else { bad++; console.log(` FAIL  ${what}${detail ? ` — ${detail}` : ''}`); }
};

const FUTURE = {
  version: 99,
  app: '99.0.0',
  savedAt: new Date().toISOString(),
  activeRef: { kind: 'tab', id: 'from-the-future' },
  pinnedTabs: [],
  nodes: [{ kind: 'single', tabId: 'from-the-future' }],
  // Поле, которого в нынешнем формате нет вовсе, — им и отличается «файл из будущего».
  somethingNewerVersionsKnow: 'это должно уцелеть',
};

await withStand(async (ctx) => {
  console.log('профиль:', ctx.profile, '\n');
  await wait(4000);

  const sessionFile = path.join(ctx.profile, 'session.json');

  // Кладём файл «из будущего» и перезапускаем приложение на том же профиле — это и есть откат.
  fs.writeFileSync(sessionFile, JSON.stringify(FUTURE, null, 2), 'utf8');
  const before = fs.readFileSync(sessionFile, 'utf8');
  console.log('  положен session.json версии 99, перезапускаем…\n');

  await ctx.restart();
  await wait(6000);

  const copies = fs.readdirSync(ctx.profile).filter((f) => f.startsWith('session.json.from-v99.'));
  check('копия непонятого файла сделана', copies.length === 1, copies.join(', ') || 'копий нет');

  if (copies.length === 1) {
    const saved = fs.readFileSync(path.join(ctx.profile, copies[0]), 'utf8');
    check('копия побайтово равна тому, что лежало', saved === before);
    // ⚠️ Отдельно про незнакомое поле: копия обязана быть СЫРЫМ файлом, а не тем, что старая
    // сборка сумела разобрать. Разбор потерял бы ровно то, ради чего копию и делают.
    check('в копии уцелело поле, которого эта сборка не знает',
      saved.includes('somethingNewerVersionsKnow'));
  }

  // ⚠️ Оригинал НЕ переименовываем: вернувшись на новую версию, человек должен открыть свои
  // вкладки обычным путём, а не искать копию. Поэтому файл на месте — либо ещё нетронутый,
  // либо уже перезаписанный текущим форматом; важно, что копия снята ДО этого.
  check('оригинал остался на месте', fs.existsSync(sessionFile));
}, { keep: false });

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло\n`);
process.exit(bad === 0 ? 0 : 1);
