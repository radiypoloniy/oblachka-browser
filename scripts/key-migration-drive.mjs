// Живая проверка переезда ключа в общее хранилище. Не *-check.mjs — поднимает настоящее
// приложение, в npm test не входит.
//
// ⚠️ РАДИ ЧЕГО ЗАВЕДЕНА. Это единственный путь в слое подключений, который ТРОГАЕТ ДАННЫЕ НА
// ДИСКЕ, выполняется РОВНО ОДИН РАЗ у каждого человека и не имеет второй попытки: ключ Gemini
// переезжает из отдельного файла `gemini-key.enc` в общий `ai-keys.enc`. Ошибиться здесь означает
// либо потерять ключ, либо (что заметнее) не выполнить обещание «удалил»: ключ, который человек
// стёр, воскресает на следующем старте из файла, который мы намеренно не удаляем.
//
// ⚠️ Существующие драйверы этого не покрывают и не могут: все они работают на ЧИСТОМ профиле, где
// старого файла нет вовсе. Поэтому старый файл здесь создаётся руками — тем же safeStorage, каким
// его писал настоящий AiKeyStore до переезда.
//
// ⚠️ ЗДЕСЬ НЕТ ctx.restart(), И ЭТО НЕ ЛЕНЬ. Разведкой установлено: safeStorage НЕ ПЕРЕЖИВАЕТ
// перезапуск стенда. Chromium держит ключ шифрования в `Local State` внутри профиля, а стенд
// снимает дерево процессов жёстко (taskkill /T /F) — файл не успевает дописаться, и следующий
// запуск генерирует новый ключ. Проверено в лоб: сохранение штатным путём (`ai:save-key`) даёт
// status=true, а после ctx.restart() не расшифровывается даже отдельный тестовый блоб. В бою
// браузер завершается штатно, и ключ фактчека переживает перезапуски месяцами. Вывод на будущее:
// НИ ОДИН драйвер не должен проверять зашифрованное хранилище через ctx.restart() — он покажет
// поломку там, где её нет.
//
// Вместо перезапуска здесь вызывается ровно то, что зовёт main.ts на старте — loadFromDisk().
// Второй её вызов и есть «следующий запуск» с точки зрения хранилища.
//
// ⚠️ Модуль берётся ИЗ КЭША CommonJS, а не через require по пути. Первая версия драйвера требовала
// его абсолютным путём и получала ВТОРУЮ КОПИЮ с пустым состоянием: кэш ключуется строкой пути, а
// main грузил модуль своей. Выглядело это как три настоящих провала. Кэш отдаёт ту самую копию,
// которой пользуется человек, — сверяется с ответом IPC-обработчика первым же случаем.
//
// ⚠️ Профиль изолированный (withStand), боевой userData не открывается. Ключ ненастоящий.
//
// Запуск: npm run drive -- key-migration
import { withStand } from './isolated-stand.mjs';

let ok = 0;
let bad = 0;

function check(what, cond, extra = '') {
  if (cond) ok++; else bad++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${what}${extra ? `  (${extra})` : ''}`);
}

// Значение заведомо ненастоящее, но правдоподобной формы: ключи Gemini начинаются с AIza.
const FAKE_KEY = 'AIzaTEST-ключ-стенда-не-настоящий';

// ⚠️ `require` в контексте main НЕ определён (там внутренний bootstrap Electron) — только через
// process.mainModule.require, и только для встроенных модулей (см. шапку isolated-stand.mjs).
const R = 'process.mainModule.require';
const FS = `${R}('node:fs')`;
const PATH = `${R}('node:path')`;
const EL = `${R}('electron')`;
const DIR = `${EL}.app.getPath('userData')`;
const LEGACY = `${PATH}.join(${DIR}, 'gemini-key.enc')`;
const NEWFILE = `${PATH}.join(${DIR}, 'ai-keys.enc')`;

/** Та самая копия AiKeyStore, которую загрузил main. */
const STORE = `(() => {
  const cache = process.mainModule.constructor._cache;
  const key = Object.keys(cache).find((k) => k.endsWith('AiKeyStore.js'));
  return key ? cache[key].exports : null;
})()`;

/** Настоящий invoke-обработчик — тот путь, которым идёт нажатие в настройках. */
const call = (channel, arg = '') => `${EL}.ipcMain._invokeHandlers.get('${channel}')({}${arg ? `, ${arg}` : ''})`;

await withStand(async (ctx) => {
  // ── Модуль, который мы дёргаем, — тот же, что отвечает человеку ───────────
  const same = await ctx.evalMain(`(() => {
    const m = ${STORE};
    return m !== null && m.getKeyStatus() === ${call('ai:get-key-status')};
  })()`);
  check('дёргаем ту же копию модуля, что отвечает интерфейсу', same === true, String(same));
  if (same !== true) return;

  // ── Готовим «старую установку»: старый файл есть, нового хранилища нет ────
  const planted = await ctx.evalMain(`(() => {
    const fs = ${FS}, el = ${EL};
    if (!el.safeStorage.isEncryptionAvailable()) return 'safeStorage недоступен';
    try { fs.unlinkSync(${NEWFILE}); } catch {}
    fs.writeFileSync(${LEGACY}, el.safeStorage.encryptString(${JSON.stringify(FAKE_KEY)}));
    return 'ok';
  })()`);
  check('старый файл ключа создан на стенде', planted === 'ok', String(planted));
  if (planted !== 'ok') return;

  // ── Старт приложения: ровно то, что зовёт main.ts ─────────────────────────
  const adopted = await ctx.evalMain(`(() => { ${STORE}.loadFromDisk(); return ${call('ai:get-key-status')}; })()`);
  check('ключ подхвачен из старого файла', adopted === true, String(adopted));

  const value = await ctx.evalMain(`${STORE}.getKey()`);
  check('значение ключа не потерялось', value === FAKE_KEY, value === FAKE_KEY ? 'совпало' : String(value));

  // ⚠️ Миграция ДОБАВЛЯЮЩАЯ: старый файл остаётся. Правило после 21.08, когда unlink «чтобы
  // пересоздать после ошибки» стёр боевые пароли, закладки и историю.
  const kept = await ctx.evalMain(`${FS}.existsSync(${LEGACY})`);
  check('старый файл на месте — миграция добавляющая', kept === true, String(kept));

  // ⚠️ На загрузке на диск не пишем намеренно: трогать диск, когда человек ещё ничего не просил,
  // значит ловить непонятную ошибку записи до появления окна.
  const wroteOnLoad = await ctx.evalMain(`${FS}.existsSync(${NEWFILE})`);
  check('на загрузке в новый файл не писали', wroteOnLoad === false, String(wroteOnLoad));

  // ── Повторный старт не портит уже перенесённое ────────────────────────────
  const again = await ctx.evalMain(`(() => { ${STORE}.loadFromDisk(); return ${STORE}.getKey(); })()`);
  check('повторная загрузка не теряет ключ', again === FAKE_KEY, again === FAKE_KEY ? 'совпало' : String(again));

  // ── Удаление: человек нажал «Удалить» в настройках ────────────────────────
  await ctx.evalMain(call('ai:delete-key'));
  const afterDelete = await ctx.evalMain(call('ai:get-key-status'));
  check('после удаления ключа нет', afterDelete === false, String(afterDelete));

  // ⚠️ ЗДЕСЬ старый файл удаляется, и это не нарушение правила выше, а его граница. Правило
  // запрещает стирать данные РАДИ ВОССТАНОВЛЕНИЯ ПОСЛЕ ОШИБКИ. Здесь человек нажал «Удалить» и
  // ждёт, что ключа больше нет; оставить его лежать читаемым — невыполненное обещание про секрет.
  const legacyGone = await ctx.evalMain(`${FS}.existsSync(${LEGACY})`);
  check('старый файл удалён по явной просьбе человека', legacyGone === false, String(legacyGone));

  // ── ГЛАВНЫЙ СЛУЧАЙ: удалённое не воскресает на следующем старте ───────────
  const resurrected = await ctx.evalMain(`(() => { ${STORE}.loadFromDisk(); return ${call('ai:get-key-status')}; })()`);
  check('удалённый ключ НЕ воскрес', resurrected === false, String(resurrected));

  // ⚠️ А ВОТ ЭТОТ СЛУЧАЙ И ЕСТЬ ГЛАВНЫЙ, и он найден обратным ходом: без него драйвер проходил
  // ДАЖЕ НА НАИВНОЙ МИГРАЦИИ. Причина в том, что удаление стирает и старый файл — воскресать
  // становится нечему, и случай выше сторожит unlink, а не отметку о переносе. Отметка страхует
  // ДРУГОЕ: старый файл на месте, а ключ уже удалён. В жизни это ровно то, что бывает, когда
  // unlink не прошёл (файл занят, нет прав) — то есть единственная ситуация, ради которой отметка
  // и заведена. Возвращаем файл руками и требуем, чтобы ключ всё равно не поднялся.
  const replanted = await ctx.evalMain(`(() => {
    const fs = ${FS}, el = ${EL};
    fs.writeFileSync(${LEGACY}, el.safeStorage.encryptString(${JSON.stringify(FAKE_KEY)}));
    ${STORE}.loadFromDisk();
    return ${call('ai:get-key-status')};
  })()`);
  check('вернувшийся старый файл ключ НЕ воскрешает', replanted === false, String(replanted));

  // ── Круг через новое хранилище: сохранили → перечитали ───────────────────
  await ctx.evalMain(call('ai:save-key', JSON.stringify('AIzaНОВЫЙ-ключ')));
  const savedFile = await ctx.evalMain(`${FS}.existsSync(${NEWFILE})`);
  check('сохранение создаёт общий файл ключей', savedFile === true, String(savedFile));

  const roundTrip = await ctx.evalMain(`(() => { ${STORE}.loadFromDisk(); return ${STORE}.getKey(); })()`);
  check('сохранённый ключ читается обратно', roundTrip === 'AIzaНОВЫЙ-ключ', String(roundTrip));
}, { main: true });

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло\n`);
process.exit(bad === 0 ? 0 : 1);
