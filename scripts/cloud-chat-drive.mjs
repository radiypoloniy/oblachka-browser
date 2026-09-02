// Чат ДЕЙСТВИТЕЛЬНО уходит в подключённую модель. Не *-check.mjs — поднимает настоящее приложение.
//
// ⚠️ ЗАВЕДЕНО ПО ЖИВОЙ ЖАЛОБЕ: «вроде корректно подключил модель, но нихуя не работает». Настройки
// на диске были верные — подключение сохранено, маршрут чата на него указывает, ключ на месте.
// Значит ломалось между настройкой и запросом, а этого куска не видел никто: contract-check
// разбирает исходники, ipc-wiring проверяет регистрацию, а «дошёл ли запрос до провайдера и вернул
// ли он ответ» не проверяло ничто.
//
// ⚠️ БЕЗ ЧУЖОГО КЛЮЧА И БЕЗ БОЕВОГО ПРОФИЛЯ. Поддельный OpenAI-совместимый сервер на localhost
// отвечает тем же протоколом, что настоящий: SSE, куски `data:`, финальный `[DONE]`. Для loopback
// ключ не требуется по устройству (см. capsFor), поэтому проверка не тратит ни копейки и не трогает
// ничьи секреты — а путь проходит тот же самый.
//
// ⚠️ Куски специально рвутся ПОСЕРЕДИНЕ события: сеть режет поток где хочет, и наивный разбор
// «split по пустой строке» ломается именно так (разбор — в shared/sseParse.ts).
//
// Запуск: npm run drive -- cloud-chat
import http from 'node:http';
import { withStand, wait } from './isolated-stand.mjs';

let ok = 0;
let bad = 0;
const check = (what, cond, detail = '') => {
  if (cond) { ok++; console.log(`  ok   ${what}${detail ? ` — ${detail}` : ''}`); }
  else { bad++; console.log(` FAIL  ${what}${detail ? ` — ${detail}` : ''}`); }
};

const ANSWER = 'Привет! Это ответ подключённой модели.';

/** Поддельный провайдер: тот же протокол, что у настоящего, но локальный и бесплатный. */
function startFakeProvider() {
  return new Promise((resolve) => {
    let lastBody = '';
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        lastBody = body;
        if (!req.url.includes('/chat/completions')) { res.writeHead(404).end(); return; }
        const streaming = /"stream"\s*:\s*true/.test(body);
        if (!streaming) {
          // Проба подключения ходит без потока — отвечаем обычным JSON.
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        // ⚠️ Рвём поток посреди события, а не по границам: именно так ведёт себя настоящая сеть.
        const chunks = ANSWER.match(/.{1,7}/gs) ?? [];
        let raw = '';
        for (const piece of chunks) {
          raw += `data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`;
        }
        raw += ': keep-alive\n\ndata: [DONE]\n\n';
        let i = 0;
        const pump = () => {
          if (i >= raw.length) { res.end(); return; }
          res.write(raw.slice(i, i + 11));   // 11 байт за раз: границы событий гарантированно рвутся
          i += 11;
          setTimeout(pump, 4);
        };
        pump();
      });
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port, body: () => lastBody }));
  });
}

const R = 'process.mainModule.require';
const EL = `${R}('electron')`;
// ⚠️ Модуль берём ИЗ КЭША CommonJS: require по абсолютному пути отдаёт ВТОРУЮ копию с пустым
// состоянием — на этом уже спотыкались в key-migration-drive.
const SVC = `(() => {
  const cache = process.mainModule.constructor._cache;
  const key = Object.keys(cache).find((k) => k.endsWith('TranslationService.js'));
  return key ? cache[key].exports : null;
})()`;
const call = (ch, args = '') => `${EL}.ipcMain._invokeHandlers.get('${ch}')({}${args ? `, ${args}` : ''})`;

const fake = await startFakeProvider();
const conn = {
  id: 'test-fake', label: 'Стенд', kind: 'openai-compatible',
  baseUrl: `http://127.0.0.1:${fake.port}/v1`, model: 'fake-1', concurrency: 4, schema: 'none',
};

await withStand(async (ctx) => {
  await wait(5000);

  const probe = await ctx.evalMain(call('ai:connection-test', `${JSON.stringify(conn)}, null`));
  check('проба подключения проходит', probe?.ok === true, JSON.stringify(probe));

  const saved = await ctx.evalMain(call('ai:connection-save', `${JSON.stringify(conn)}, null`));
  check('подключение сохранено', saved === true, String(saved));

  const routed = await ctx.evalMain(call('ai:set-route', `'chat', ${JSON.stringify(conn.id)}`));
  check('маршрут чата назначен', routed === true, String(routed));

  const state = await ctx.evalMain(call('ai:connections'));
  check('подключение считается готовым', (state?.ready ?? []).includes(conn.id), JSON.stringify(state?.ready));

  // ── Собственно чат ────────────────────────────────────────────────────────
  // ⚠️ Зовём runChatMessage напрямую: путь от панели идёт через ad-hoc канал с контекстом
  // отправителя, который со стенда не подделать, а проверяем мы слой, а не панель.
  const out = await ctx.evalMain(`(async () => {
    const svc = ${SVC};
    if (!svc) return { ошибка: 'TranslationService не найден в кэше' };
    // ⚠️ ОБЯЗАТЕЛЬНО С onChunk: боевой путь всегда со стримингом (панель печатает по мере
    // генерации), и именно наличие колбэка переключает адаптер на SSE. Проверка без него шла бы
    // другой веткой — той, которой у человека не бывает.
    let streamed = '';
    const t0 = Date.now();
    const r = await svc.runChatMessage('привет', [], (t) => { streamed += t; }, undefined);
    return { ok: r.ok, out: r.ok ? r.out : null, error: r.ok ? null : r.error, via: r.ok ? r.via : null,
      streamed, ms: Date.now() - t0, localLoaded: svc.getLoadedModelId() };
  })()`, 90000);

  check('чат ответил без ошибки', out?.ok === true, out?.error ?? JSON.stringify(out));
  // ⚠️ Главный ассерт: ответ пришёл ИМЕННО ОТ ПОДКЛЮЧЕНИЯ, а не от локальной модели. Именно это и
  // ломалось у человека: настройки верные, а отвечает всё равно не то.
  check('ответ пришёл от подключения, а не от локальной', out?.via?.label === 'Стенд', JSON.stringify(out?.via));
  check('текст ответа собран из кусков потока целиком', out?.out === ANSWER, JSON.stringify(out?.out));
  // ⚠️ И то же самое ПО МЕРЕ ГЕНЕРАЦИИ: панель печатает ответ кусками, и если поток доехал только
  // целиком в конце, человек полминуты смотрит на пустоту, думая, что ничего не работает.
  check('куски приходили по мере генерации', out?.streamed === ANSWER, JSON.stringify(out?.streamed));
  // ⚠️ И проверяем, что в запрос уехала МОДЕЛЬ ПОДКЛЮЧЕНИЯ: перепутать её с именем по умолчанию
  // легко, а снаружи это выглядит как «отвечает не та модель».
  check('в запрос ушла модель подключения', fake.body().includes('"fake-1"'), fake.body().slice(0, 60));
  check('запрос ушёл ПОТОКОМ', fake.body().includes('"stream":true'), fake.body().slice(0, 60));
  // ⚠️ ГЛАВНОЕ ПРО СКОРОСТЬ: облачный ответ НЕ ДОЛЖЕН поднимать локальную модель. Она грузится
  // десятки секунд и занимает гигабайты видеопамяти — а человек, отдавший чат облаку, ждёт ответ
  // от облака. Снаружи лишняя загрузка выглядит ровно как «нихуя не работает»: браузер молчит.
  check('локальная модель НЕ поднималась', out?.localLoaded === null, `загружено: ${JSON.stringify(out?.localLoaded)}`);
  check('ответ пришёл быстро, без ожидания локальной', (out?.ms ?? 99999) < 5000, `${out?.ms} мс`);
}, { main: true });

fake.server.close();
console.log(`\nИтого: ${ok} прошло, ${bad} не прошло\n`);
process.exit(bad === 0 ? 0 : 1);
