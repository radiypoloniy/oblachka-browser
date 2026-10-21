// Живая проверка «закрыл браузер и тут же открыл заново».
//
// ⚠️ Живой случай: после закрытия процесс ещё несколько секунд доигрывает выход (останавливает VPN
// и модель, чистит куки) и держит замок одного экземпляра. Клик по ярлыку в этот момент прилетал
// в него как second-instance, а тот поднимал окно БЕЗ сессии — человек видел пустой браузер.
// Теперь такой запуск перезапускает приложение после выхода (shared/secondInstance.ts).
//
// ⚠️ Выход на стенде без VPN занимает миллисекунды — в такой зазор живой клик не попадает. Поэтому
// выход здесь искусственно задерживается на несколько секунд: это и есть остановка VPN, только
// воспроизводимая.
//
// ⚠️ Перезапущенный процесс — НЕ потомок стенда (его порождает уходящий процесс), и снятие дерева
// стенда его не заденет. Снимаем его сами по профилю в командной строке — только его.
//
// Запуск: npm run drive -- second-instance
import { spawn, execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withStand, wait, connectCdp } from './isolated-stand.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const QUIT_DELAY_MS = 4000;

let ok = 0;
let bad = 0;
const check = (what, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ok   ${what}${detail ? ` — ${detail}` : ''}`); }
  else { bad++; console.log(` FAIL  ${what}${detail ? ` — ${detail}` : ''}`); }
};

const leaf = (url) => {
  const tail = String(url ?? '').replace(/\/$/, '').split('/').pop();
  try { return decodeURIComponent(tail); } catch { return tail; }
};

async function chromeTargets(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1500) });
    return (await res.json()).filter((t) => t.url?.includes('index.html'));
  } catch { return []; }
}

function killByProfile(profile) {
  // Только процессы, у которых в командной строке профиль ЭТОГО стенда.
  const needle = profile.replace(/'/g, "''");
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*${needle}*' } | ForEach-Object { $_.ProcessId }`,
    ], { encoding: 'utf8' });
    for (const pid of out.split(/\s+/).filter(Boolean)) {
      try { execFileSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' }); } catch { /* уже ушёл */ }
    }
  } catch { /* PowerShell недоступен — снимет подметальщик drive.mjs */ }
}

await withStand(async (ctx) => {
  // Страховка от зависания: перезапущенный процесс не потомок стенда, и повисший прогон оставил бы его жить.
  const guard = setTimeout(() => { console.log(' FAIL  прогон завис'); console.log(ctx.appLog.join('').slice(-3000)); killByProfile(ctx.profile); process.exit(1); }, 90000);
  const NAMES = ['первая', 'вторая'];
  for (const n of NAMES) {
    await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(ctx.echoUrl(`/${n}`))})`);
    await wait(500);
  }
  const before = ((await ctx.chrome.evaluate('window.oblako.getAllTabs()')) ?? []).map((t) => leaf(t.url));
  check('вкладки открылись', NAMES.every((n) => before.includes(n)), before.join(', '));
  await wait(2500); // отложенный автосейв

  // Задержка выхода: ПОСЛЕ штатной обработки will-quit (AppShutdown.ts) держим процесс ещё
  // QUIT_DELAY_MS — ровно то окно, в которое прилетает клик по ярлыку.
  await ctx.evalMainSync(`(() => {
    const { app, BrowserWindow } = process.mainModule.require('electron');
    let held = false;
    app.on('will-quit', (e) => {
      if (held) return;
      held = true;
      e.preventDefault();
      setTimeout(() => app.quit(), ${QUIT_DELAY_MS});
    });
    setTimeout(() => BrowserWindow.getAllWindows().forEach((w) => w.close()), 50);
    return 1;
  })()`);
  console.log('  …окна закрыты, выход задержан');
  await wait(800);

  // Второй запуск на том же профиле: замок занят, аргументы уходят уходящему процессу.
  const port2 = 9500 + Math.floor(Math.random() * 400);
  const second = spawn(ELECTRON, [`--remote-debugging-port=${port2}`, `--user-data-dir=${ctx.profile}`, ROOT],
    { env: { ...process.env, NODE_ENV: 'production' }, stdio: 'ignore' });
  second.unref();

  // Пустое окно старого кода появилось бы ЗДЕСЬ, на старом порту, пока выход ещё держится.
  await wait(1500);
  const revivedOld = await chromeTargets(ctx.cdpPort);
  check('уходящий процесс не поднял пустое окно', revivedOld.length === 0, `окон хрома: ${revivedOld.length}`);

  let targets = [];
  for (let i = 0; i < 80 && targets.length === 0; i++) {
    await wait(250);
    targets = await chromeTargets(port2);
  }
  check('после выхода браузер перезапустился', targets.length > 0, targets.length ? `порт ${port2}` : 'окна нет');

  if (targets.length > 0) {
    const chrome = connectCdp(targets[0]);
    await chrome.ready;
    await wait(2500);
    const after = ((await chrome.evaluate('window.oblako.getAllTabs()')) ?? []).map((t) => leaf(t.url));
    check('вернулась сессия, а не пустой хаб', NAMES.every((n) => after.includes(n)), after.join(', ') || 'пусто');
    check('окно одно', targets.length === 1, `окон: ${targets.length}`);
  }

  if (bad > 0) {
    const lines = ctx.appLog.join('').split('\n').filter((l) => /\[(startup|shutdown|session)\]/.test(l));
    console.log(`\nлог уходящего процесса:\n${lines.join('\n')}`);
  }
  clearTimeout(guard);
  killByProfile(ctx.profile);
  await wait(800);
}, { main: true });

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло\n`);
process.exit(bad === 0 ? 0 : 1);
