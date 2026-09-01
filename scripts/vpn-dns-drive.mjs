// Утекает ли DNS мимо туннеля: что браузер шлёт в SOCKS-прокси — ИМЯ хоста или уже разрешённый IP.
// Не *-check.mjs — поднимает НАСТОЯЩЕЕ приложение.
//
// ⚠️ ЗАЧЕМ. В аудитах 21.08 и 23.08 висит непроверенная находка: «DNS при socks5:// vs socks5h://».
// Смысл опасения такой: в мире curl схема socks5:// означает «резолвить имя ЛОКАЛЬНО и отдать
// прокси готовый адрес», а socks5h:// — «отдать прокси само имя». Если Chromium ведёт себя как
// curl, то при включённом VPN провайдер по-прежнему видит, на какие домены человек ходит: сам
// трафик в туннеле, а DNS-запросы — нет. Для браузера, который обещает приватность, это дыра
// первого порядка.
//
// ⚠️ ПОЧЕМУ ЭТО НЕЛЬЗЯ «ПРОСТО ПОЧИНИТЬ». В конфиге прокси Chromium схемы socks5h НЕ СУЩЕСТВУЕТ
// (net/docs/proxy.md знает direct, http, https, socks4, socks5, quic). Написать её наугад — значит
// подсунуть setProxy неизвестную схему, и в лучшем случае правило будет отброшено, а трафик пойдёт
// НАПРЯМУЮ. То есть «починка» вслепую открывает дыру шире исходной. Отсюда замер вместо правки.
//
// ⚠️ Ответ читается по первому байту адреса в запросе CONNECT протокола SOCKS5 (RFC 1928):
//   ATYP = 3 — прокси получил ИМЯ хоста, значит имя резолвит он, а не мы: утечки нет;
//   ATYP = 1 — прокси получил IPv4, значит имя разрешили локально: DNS ушёл мимо туннеля;
//   соединения не было вовсе — имя пытались разрешить локально и не смогли, что тоже утечка
//   (запрос к резолверу провайдера уже ушёл).
//
// Запуск: npm run drive -- vpn-dns
import net from 'node:net';
import { withStand, wait } from './isolated-stand.mjs';

let ok = 0;
let bad = 0;
const check = (what, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ok   ${what}${detail ? ` — ${detail}` : ''}`); }
  else { bad++; console.log(` FAIL  ${what}${detail ? ` — ${detail}` : ''}`); }
};

// ⚠️ Имя нарочно несуществующее и в зоне .test (RFC 6761 — она гарантированно не делегирована).
// Если браузер попробует разрешить его сам, он ничего не найдёт и до прокси не дойдёт вовсе —
// это и будет ответ.
const PROBE_HOST = 'oblako-dns-probe.test';

/** Поддельный SOCKS5: доводит рукопожатие до запроса CONNECT и запоминает, ЧТО в нём пришло. */
function fakeSocks() {
  const seen = [];
  const server = net.createServer((sock) => {
    let stage = 'greeting';
    sock.on('error', () => { /* браузер рвёт соединение когда захочет — это норма */ });
    sock.on('data', (buf) => {
      if (stage === 'greeting') {
        // VER=5, NMETHODS, METHODS… — отвечаем «без аутентификации».
        sock.write(Buffer.from([0x05, 0x00]));
        stage = 'request';
        return;
      }
      if (stage !== 'request') return;
      stage = 'done';
      // VER CMD RSV ATYP …
      const atyp = buf[3];
      let host = '';
      if (atyp === 3) host = buf.subarray(5, 5 + buf[4]).toString('latin1');
      else if (atyp === 1) host = `${buf[4]}.${buf[5]}.${buf[6]}.${buf[7]}`;
      seen.push({ atyp, host });
      // Отвечаем отказом: подключать никуда не собираемся, нам нужен был сам запрос.
      sock.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
      sock.end();
    });
  });
  return { server, seen };
}

await withStand(async (ctx) => {
  console.log('профиль:', ctx.profile, '\n');
  await wait(4000);

  const { server, seen } = fakeSocks();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  console.log(`  поддельный SOCKS5 слушает 127.0.0.1:${port}\n`);

  // Открываем вкладку и переводим ЕЁ сессию на наш «прокси». Именно сессию вкладки, а не
  // defaultSession: гостевые страницы живут в партиции профиля (см. profilePartition).
  await ctx.chrome.evaluate(`window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/dns-probe'))}).then(function(){return 1;})`);
  await wait(2500);

  const set = await ctx.evalMain(`(async () => {
    const { webContents } = process.mainModule.require('electron');
    const w = webContents.getAllWebContents().find((x) => x.getURL().includes('/dns-probe'));
    if (!w) return { ошибка: 'подопытная вкладка не найдена' };
    await w.session.setProxy({ proxyRules: 'socks5://127.0.0.1:${port}' });
    const resolved = await w.session.resolveProxy('http://${PROBE_HOST}/');
    return { ok: true, resolved };
  })()`);
  check('прокси применён к сессии вкладки', set?.ok === true, set?.ошибка ?? String(set?.resolved ?? ''));
  if (!set?.ok) { server.close(); return; }

  // ⚠️ resolveProxy показывает, КАК Chromium разобрал наши правила. Если бы схема оказалась
  // неизвестной, здесь стояло бы DIRECT — и весь дальнейший замер был бы про прямой выход,
  // а не про прокси. Проверяем явно, чтобы не принять утечку за отсутствие утечки.
  check('правило разобрано как SOCKS5, а не DIRECT',
    String(set.resolved).includes('SOCKS5'), String(set.resolved));

  await ctx.evalMain(`(() => {
    const { webContents } = process.mainModule.require('electron');
    const w = webContents.getAllWebContents().find((x) => x.getURL().includes('/dns-probe'));
    if (w) w.loadURL('http://${PROBE_HOST}/').catch(() => {});
    return 1;
  })()`);
  await wait(4000);
  server.close();

  console.log(`\n  запросов в прокси: ${seen.length}`);
  for (const s of seen) console.log(`    ATYP=${s.atyp} → ${s.host}`);

  // ── Приговор ──────────────────────────────────────────────────────────────────────────────
  const gotName = seen.some((s) => s.atyp === 3 && s.host === PROBE_HOST);
  const gotIp = seen.some((s) => s.atyp === 1);

  check('браузер вообще пошёл в прокси', seen.length > 0,
    seen.length === 0 ? 'соединений не было — имя резолвили локально, это и есть утечка' : `${seen.length}`);
  check('DNS НЕ утекает: прокси получает имя хоста, а не адрес', gotName && !gotIp,
    gotName ? 'ATYP=3, имя целиком' : 'имя до прокси не доехало');
}, { main: true });

console.log(`\nИтого: ${ok} прошло, ${bad} не прошло\n`);
process.exit(bad === 0 ? 0 : 1);
