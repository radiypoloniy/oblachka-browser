// Волна 1 аудита: утечки. Живой прогон на изолированном профиле (см. isolated-stand.mjs).
//
//   npm run leak-check
//   $env:OBLAKO_TEST_VPN_SUB='https://…'; npm run leak-check
//
// Ссылку подписки в репозиторий не класть. Имя НЕ *-check.mjs.
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withStand, connectCdp, wait } from './isolated-stand.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
let warned = 0;
let skipped = 0;

function ok(what, detail = '') {
  passed++;
  console.log(`  ok   ${what}${detail ? `\n         ${detail}` : ''}`);
}
function fail(what, detail = '') {
  failed++;
  console.log(` FAIL  ${what}${detail ? `\n         ${detail}` : ''}`);
}
function warn(what, detail = '') {
  warned++;
  console.log(` WARN  ${what}${detail ? `\n         ${detail}` : ''}`);
}
function skip(what, detail = '') {
  skipped++;
  console.log(` skip  ${what}${detail ? `\n         ${detail}` : ''}`);
}

async function onGuest(ctx, needle, fn) {
  const t = await ctx.findTarget((x) => typeof x.url === 'string' && x.url.includes(needle), 50);
  if (!t) throw new Error(`нет CDP-таргета для ${needle}`);
  const page = connectCdp(t);
  await page.ready;
  try {
    return await fn(page);
  } finally {
    page.close();
  }
}

async function waitTitle(page, title, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const t = await page.evaluate('document.title');
    if (t === title) return true;
    await wait(200);
  }
  return false;
}

function sessionBlob(profile) {
  const p = path.join(profile, 'session.json');
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

function scanMainFetch() {
  const dir = path.join(ROOT, 'electron');
  const hits = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, name.name);
      if (name.isDirectory()) { walk(p); continue; }
      if (!name.name.endsWith('.ts')) continue;
      const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        const t = line.trim();
        if (t.startsWith('//') || t.startsWith('*')) return;
        if (!/\bfetch\s*\(/.test(line)) return;
        if (/\bnet\.fetch\s*\(/.test(line)) return;
        if (/\.fetch\s*\(/.test(line)) return; // session.defaultSession.fetch
        hits.push(`${path.relative(ROOT, p)}:${i + 1}: ${t.slice(0, 120)}`);
      });
    }
  };
  walk(dir);
  return hits;
}

function hostIpsFromIce(cands) {
  const ips = [];
  for (const c of cands ?? []) {
    const m = String(c).match(/(\d{1,3}(?:\.\d{1,3}){3})/);
    if (m) ips.push(m[1]);
  }
  return [...new Set(ips)];
}

function isLoopback(ip) {
  return ip === '127.0.0.1' || ip === '::1' || ip.startsWith('::ffff:127.0.0.1');
}
function isPrivateLan(ip) {
  return /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip) || /^169\.254\./.test(ip);
}
function httpsText(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { timeout: 12000 }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve(b.trim()));
    }).on('error', reject);
  });
}

function isPublicIp(s) {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(s) || (s.includes(':') && !s.startsWith('::ffff:'));
}

async function waitHit(ctx, part, tries = 40) {
  for (let i = 0; i < tries; i++) {
    if (ctx.echo.hits.some((h) => String(h.url).includes(part))) return true;
    await wait(150);
  }
  return false;
}

console.log('\nВолна 1 — утечки (изолированный профиль)\n');

try {
  await withStand(async (ctx) => {
    const chrome = ctx.chrome;
    const token = `t${Date.now().toString(36)}`;
    const histMark = `hist-${token}`;
    const privMark = `priv-${token}`;
    const cookieNorm = `cn_${token}`;
    const cookiePriv = `cp_${token}`;
    const copyPriv = `INCOG_${token}`;
    const copyNorm = `NORM_${token}`;

    const fetchHits = scanMainFetch();
    const realFetch = fetchHits.filter((h) => !h.includes('graphWebApps.ts'));
    if (realFetch.length === 0) {
      ok('в main нет глобального fetch() мимо net.fetch / session.fetch',
        fetchHits.length ? `инъекция в страницу: ${fetchHits[0].split(':')[0]}` : '');
    } else {
      fail('глобальный fetch() в main — ходит мимо VPN', realFetch.join('\n         '));
    }

    let vpn = await chrome.evaluate('window.oblako.getVpnConnectionState()');
    const sub = (process.env.OBLAKO_TEST_VPN_SUB ?? '').trim();
    let nodeIp4 = '';
    try { nodeIp4 = await httpsText('https://api.ipify.org'); } catch { /* нет сети у Node */ }

    if (!sub) {
      skip('WebRTC/DNS/IPv6 при включённом VPN', 'задайте OBLAKO_TEST_VPN_SUB (не коммитить ссылку)');
    } else {
      const imported = await chrome.evaluate(
        `window.oblako.setVpnSubscription(${JSON.stringify(sub)})`,
        25000,
      );
      if (!imported || imported.ok === false) {
        fail('импорт тестовой подписки', String(imported?.error ?? imported).slice(0, 200));
      } else {
        const servers = await chrome.evaluate('window.oblako.listVpnServers()');
        const first = Array.isArray(servers) ? servers[0] : null;
        if (!first?.id) {
          fail('подписка без серверов');
        } else {
          const conn = await chrome.evaluate(
            `window.oblako.vpnConnect(${JSON.stringify(first.id)})`,
            60000,
          );
          for (let i = 0; i < 50; i++) {
            vpn = await chrome.evaluate('window.oblako.getVpnConnectionState()');
            if (vpn?.state === 'running' || vpn?.state === 'error') break;
            await wait(400);
          }
          if (vpn?.state !== 'running') {
            fail('VPN не вышел в running', `${vpn?.state ?? '?'} ${vpn?.error ?? ''} ${conn?.error ?? ''}`);
          } else {
            ok('VPN running на изолированном стенде', String(first.remark ?? first.id).slice(0, 80));

            await chrome.evaluate("window.oblako.createTab('https://api.ipify.org').then(function(){return 1;})");
            try {
              const guestIp = await onGuest(ctx, 'api.ipify.org', async (page) => {
                for (let i = 0; i < 30; i++) {
                  const t = String(await page.evaluate('document.body.innerText || ""')).trim();
                  if (isPublicIp(t.split(/\s+/)[0] ?? '')) return t.split(/\s+/)[0];
                  await wait(300);
                }
                return '';
              });
              if (!nodeIp4) skip('сравнение IPv4: Node не достучался до ipify');
              else if (!guestIp) fail('гость не получил внешний IPv4 (туннель/сайт)');
              else if (guestIp === nodeIp4) fail('гость видит тот же IPv4, что Node без прокси — HTTPS мимо туннеля', guestIp);
              else ok('IPv4 гостя через туннель не совпадает с IP хоста', `host=${nodeIp4} guest=${guestIp}`);
            } catch (e) {
              fail('вкладка api.ipify.org', e.message);
            }

            let nodeIp6 = '';
            try { nodeIp6 = await httpsText('https://api64.ipify.org'); } catch { /* нет v6 у Node */ }
            await chrome.evaluate("window.oblako.createTab('https://api64.ipify.org/').then(function(){return 1;})");
            try {
              const guest6raw = await onGuest(ctx, 'api64.ipify.org', async (page) => {
                for (let i = 0; i < 25; i++) {
                  const t = String(await page.evaluate('document.body.innerText || ""')).trim();
                  if (t) return t.split(/\s+/)[0];
                  await wait(300);
                }
                return '';
              });
              const guest6 = guest6raw;
              const nodeHasV6 = nodeIp6.includes(':');
              const guestHasV6 = guest6.includes(':');
              if (!nodeHasV6 && !guestHasV6) ok('IPv6 нет ни у хоста, ни у гостя — обхода по v6 на этой сети нет');
              else if (guestHasV6 && nodeHasV6 && guest6 === nodeIp6) {
                fail('гость получил тот же IPv6, что хост без VPN — IPv6 мимо туннеля', guest6);
              } else if (guestHasV6 && nodeHasV6 && guest6 !== nodeIp6) {
                ok('IPv6 гостя через туннель не совпадает с хостовым');
              } else if (guestHasV6 && !nodeHasV6) {
                warn('гость видит IPv6, а Node — нет (возможный обход, если это адрес провайдера)', guest6);
              } else {
                ok('гость не взял IPv6 хоста', `host=${nodeIp6 || 'нет'} guest=${guest6 || 'нет'}`);
              }
            } catch (e) {
              skip('проверка IPv6 через ipify', e.message);
            }
          }
        }
      }
    }

    await chrome.evaluate(
      `window.oblako.createTab(${JSON.stringify(ctx.echoUrl(`/visit/${histMark}`))}).then(function(){return 1;})`,
    );
    const histLog = ctx.appLog.join('');
    const histDisabled = /\[History\].*(не загружен|отключена|не удалось)/i.test(histLog);
    const histPage = await waitHit(ctx, histMark);
    await wait(400);
    if (histDisabled) {
      skip('запись истории на этом стенде', 'better-sqlite3 не открылся (ABI Node vs Electron) — не утечка, прогон истории не из чего строить');
    } else {
      const hist = await chrome.evaluate(
        `window.oblako.searchHistory(${JSON.stringify(histMark)})`,
      );
      const recent = await chrome.evaluate('window.oblako.getHistory(50)');
      const histHit = (Array.isArray(hist) && hist.some((e) => String(e.url ?? '').includes(histMark)))
        || (Array.isArray(recent) && recent.some((e) => String(e.url ?? '').includes(histMark)));
      if (histHit) ok('обычный визит попал в историю');
      else fail('обычный визит не записался — дальше инкогнито не с чем сравнивать',
        `эхо=${histPage} search=${JSON.stringify(hist)?.slice(0, 120)}`);
    }

    await chrome.evaluate(
      `window.oblako.createIncognitoTab(${JSON.stringify(ctx.echoUrl(`/visit/${privMark}`))}).then(function(){return 1;})`,
    );
    await wait(2200);
    if (!histDisabled) {
      const privHist = await chrome.evaluate(
        `window.oblako.searchHistory(${JSON.stringify(privMark)})`,
      );
      const privInHist = Array.isArray(privHist) && privHist.some((e) => String(e.url ?? e.title ?? '').includes(privMark));
      if (!privInHist) ok('инкогнито-визит не попал в историю');
      else fail('инкогнито оставило след в истории', JSON.stringify(privHist).slice(0, 200));
    }

    const sess = sessionBlob(ctx.profile);
    if (!sess.includes(privMark)) ok('session.json не содержит адрес инкогнито');
    else {
      const line = sess.split(/\r?\n/).find((l) => l.includes(privMark)) ?? sess.slice(0, 240);
      fail('инкогнито попало в session.json', line.slice(0, 240));
    }

    await chrome.evaluate(
      `window.oblako.createTab(${JSON.stringify(ctx.echoUrl(`/set-cookie?name=${cookieNorm}&value=NORMAL`))}).then(function(){return 1;})`,
    );
    await wait(600);
    await chrome.evaluate(
      `window.oblako.createIncognitoTab(${JSON.stringify(ctx.echoUrl('/show-cookie'))}).then(function(){return 1;})`,
    );
    await wait(800);
    let incogCookie = '';
    try {
      incogCookie = await onGuest(ctx, '/show-cookie', async (page) => {
        const body = await page.evaluate('document.body.innerText');
        try { return JSON.parse(body).cookie ?? ''; } catch { return String(body); }
      });
    } catch (e) {
      fail('не открылся /show-cookie в инкогнито', e.message);
    }
    if (incogCookie.includes(cookieNorm)) fail('кука обычной сессии видна в инкогнито', incogCookie);
    else ok('куки обычной сессии не протекают в инкогнито');

    await chrome.evaluate(
      `window.oblako.createIncognitoTab(${JSON.stringify(ctx.echoUrl(`/set-cookie?name=${cookiePriv}&value=PRIV`))}).then(function(){return 1;})`,
    );
    await wait(600);
    await chrome.evaluate(
      `window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/show-cookie?from=normal'))}).then(function(){return 1;})`,
    );
    await wait(800);
    let normCookie = '';
    try {
      normCookie = await onGuest(ctx, 'from=normal', async (page) => {
        const body = await page.evaluate('document.body.innerText');
        try { return JSON.parse(body).cookie ?? ''; } catch { return String(body); }
      });
    } catch (e) {
      fail('не открылся /show-cookie в обычной вкладке', e.message);
    }
    if (normCookie.includes(cookiePriv)) fail('кука инкогнито видна в обычной сессии', normCookie);
    else ok('куки инкогнито не протекают в обычную сессию');

    const count0 = await chrome.evaluate('window.oblako.getClipboardCount()');
    await chrome.evaluate(
      `window.oblako.createTab(${JSON.stringify(ctx.echoUrl(`/copy?text=${copyNorm}`))}).then(function(){return 1;})`,
    );
    try {
      await onGuest(ctx, copyNorm, async (page) => {
        await waitTitle(page, 'copied');
      });
    } catch { /* */ }
    await wait(400);
    const countAfterNorm = await chrome.evaluate('window.oblako.getClipboardCount()');
    const copyHookLive = countAfterNorm > count0;
    if (!copyHookLive) {
      skip('буфер скопированного', 'execCommand(copy) без жеста не дошёл до хука — изоляцию инкогнито этим прогоном не доказали');
    } else {
      ok('копия из обычной вкладки попадает в буфер');
      await chrome.evaluate(
        `window.oblako.createIncognitoTab(${JSON.stringify(ctx.echoUrl(`/copy?text=${copyPriv}`))}).then(function(){return 1;})`,
      );
      try {
        await onGuest(ctx, copyPriv, async (page) => {
          await waitTitle(page, 'copied');
        });
      } catch { /* */ }
      await wait(400);
      const countAfterIncog = await chrome.evaluate('window.oblako.getClipboardCount()');
      if (countAfterIncog === countAfterNorm) ok('копия из инкогнито не попала в буфер браузера');
      else fail('копия из инкогнито увеличила буфер', `${countAfterNorm} → ${countAfterIncog}`);
    }

    await chrome.evaluate(
      `window.oblako.createTab(${JSON.stringify(ctx.echoUrl('/webrtc'))}).then(function(){return 1;})`,
    );
    try {
      const ice = await onGuest(ctx, '/webrtc', async (page) => {
        for (let i = 0; i < 25; i++) {
          const v = await page.evaluate('window.__ice || null');
          if (v) return v;
          await wait(200);
        }
        return null;
      });
      const ips = hostIpsFromIce(ice?.host);
      const lan = ips.filter((ip) => isPrivateLan(ip) && !isLoopback(ip));
      const loop = ips.filter(isLoopback);
      if (vpn?.state === 'running' || vpn?.state === 'starting' || vpn?.state === 'error') {
        if (lan.length === 0) ok('при VPN/kill switch WebRTC не отдаёт LAN IP');
        else fail('WebRTC светит LAN IP при включённой защите', lan.join(', '));
      } else if (lan.length) {
        warn('без VPN WebRTC отдаёт LAN IP — политика default, ожидаемо до включения туннеля',
          lan.join(', '));
      } else {
        ok('без VPN host-кандидаты только loopback или пусто', loop.join(', ') || 'пусто');
      }
    } catch (e) {
      fail('страница WebRTC не открылась', e.message);
    }

    const ipv6Hits = ctx.echo.hits.filter((h) => h.ip === '::1' || (h.ip.includes(':') && !h.ip.startsWith('::ffff:')));
    if (ipv6Hits.length) {
      warn('гость ходил на эхо по IPv6', ipv6Hits[0].ip);
    } else {
      ok('на IPv4-эхо гость пришёл с loopback v4 (IPv6-обхода этого сервера нет)');
    }
  });
} catch (e) {
  fail('стенд упал', e?.message ?? String(e));
}

console.log(`\nИтого: ${passed} прошло, ${failed} не прошло, предупреждений ${warned}, пропусков ${skipped}\n`);
process.exit(failed === 0 ? 0 : 1);
