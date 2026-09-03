import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { app } from 'electron';
import { dispatch, type McpDeps, type McpSession } from './McpDispatch';

// Транспорт: именованный канал Windows, а не порт на localhost.
//
// ⚠️ ЭТО ГЛАВНОЕ РЕШЕНИЕ ФАЗЫ, И ОНО ПРО БЕЗОПАСНОСТЬ, А НЕ ПРО УДОБСТВО. Слушающий сокет на
// 127.0.0.1 доступен ЛЮБОЙ ОТКРЫТОЙ СТРАНИЦЕ — в том числе странице, открытой в нашем же
// браузере. Так уже ломали: CVE-2025-49596 (RCE в MCP Inspector визитом на сайт, через то, что
// браузеры считают 0.0.0.0 равным localhost) и CVE-2026-25253 (утечка токена шлюза OpenClaw с
// одной открытой страницы, без единого клика). Именованный канал из веб-страницы не открыть
// вовсе: у JS в браузере нет такого API. Самый надёжный порт — тот, которого нет.
//
// ⚠️ ТОКЕН ВСЁ РАВНО НУЖЕН. По умолчанию именованный канал на Windows доступен другим процессам
// машины, а «другой процесс» — это и чужая программа, запущенная под тем же пользователем.
// Поэтому первая строка соединения обязана быть токеном; он лежит в userData, то есть под ACL
// профиля человека, и генерируется один раз.
//
// ⚠️ Клиент (Claude Desktop, Cursor) умеет запускать сервер ДОЧЕРНИМ ПРОЦЕССОМ и говорить с ним
// по stdio — таков транспорт stdio в спеке. Наш браузер уже запущен, поэтому клиент запускает
// крошечный шим (resources/mcp/shim.mjs), а тот просто перекладывает строки между stdin/stdout и
// этим каналом. Кадрирование одно и то же — по одному JSON-RPC сообщению на строку, — так что
// шим ничего не разбирает и знать про MCP ему не надо.

const ENDPOINT_FILE = 'mcp-endpoint.json';

let server: net.Server | null = null;
let endpoint: { pipe: string; token: string } | null = null;

/** Своё имя канала на установку: два браузера на машине не должны драться за один канал. */
function pipeNameFor(userData: string): string {
  const tag = crypto.createHash('sha1').update(userData.toLowerCase()).digest('hex').slice(0, 8);
  return `\\\\.\\pipe\\oblako-mcp-${tag}`;
}

/**
 * Токен живёт РЯДОМ С ПРОФИЛЕМ и переживает перезапуск.
 *
 * ⚠️ Файл не удаляется при выключении сервера: правило проекта — не трогать пользовательские
 * файлы в userData ради «чистоты». Выключенный сервер не слушает канал, и токен без канала не
 * значит ничего.
 */
function loadEndpoint(): { pipe: string; token: string } {
  const dir = app.getPath('userData');
  const file = path.join(dir, ENDPOINT_FILE);
  const pipe = pipeNameFor(dir);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { token?: unknown };
    if (typeof raw.token === 'string' && raw.token.length >= 32) return { pipe, token: raw.token };
  } catch { /* файла нет или он испорчен — заведём новый ниже */ }

  const token = crypto.randomBytes(24).toString('hex');
  try {
    fs.writeFileSync(file, JSON.stringify({ pipe, token }, null, 2), 'utf8');
  } catch (e) {
    console.warn('[mcp] не удалось записать точку подключения:', (e as Error).message);
  }
  return { pipe, token };
}

/** Где лежит файл с адресом канала — интерфейсу настроек, чтобы показать команду подключения. */
export function endpointPath(): string {
  return path.join(app.getPath('userData'), ENDPOINT_FILE);
}

export function mcpRunning(): boolean {
  return server !== null;
}

export function startMcpServer(deps: McpDeps): void {
  if (server) return;
  endpoint = loadEndpoint();

  const srv = net.createServer((socket) => {
    let authorised = false;
    let buffer = '';
    // ⚠️ Имя клиента живёт на СОЕДИНЕНИИ: выпущенные клиенты называют себя только в рукопожатии,
    // а решать про разрешения надо на каждом вызове (разбор — у McpSession в McpDispatch.ts).
    const session: McpSession = { label: 'неизвестный клиент' };

    // ⚠️ Потолок на строку: без него один клиент, шлющий байты без перевода строки, съедает
    // память main-процесса. Разговор с браузером обрывается, а браузер продолжает работать.
    const MAX_LINE = 1 << 20;

    socket.setEncoding('utf8');
    socket.on('error', (e) => console.warn('[mcp] соединение оборвалось:', e.message));

    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_LINE) {
        console.warn('[mcp] строка длиннее потолка — соединение закрыто');
        socket.destroy();
        return;
      }
      let cut = buffer.indexOf('\n');
      while (cut !== -1) {
        const line = buffer.slice(0, cut).trim();
        buffer = buffer.slice(cut + 1);
        if (line) void handleLine(line);
        cut = buffer.indexOf('\n');
      }
    });

    const handleLine = async (line: string): Promise<void> => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line) as Record<string, unknown>;
      } catch {
        // ⚠️ На мусор отвечаем разрывом, а не ошибкой протокола: это не сбойный клиент, а кто-то
        // посторонний, стучащийся в канал.
        socket.destroy();
        return;
      }

      if (!authorised) {
        // Первая строка — только токен. Разговор до неё не начинается.
        const given = typeof msg.auth === 'string' ? msg.auth : '';
        const want = endpoint?.token ?? '';
        const okAuth = given.length === want.length
          && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want));
        if (!okAuth) {
          console.warn('[mcp] соединение с неверным токеном отклонено');
          socket.destroy();
          return;
        }
        authorised = true;
        socket.write(`${JSON.stringify({ auth: 'ok' })}\n`);
        return;
      }

      const answer = await dispatch(msg, deps, session);
      // Уведомление: ответа нет, и слать его протокол запрещает.
      if (answer && !socket.destroyed) socket.write(`${JSON.stringify(answer)}\n`);
    };
  });

  srv.on('error', (e) => {
    console.warn('[mcp] канал не поднялся:', e.message);
    server = null;
  });

  srv.listen(endpoint.pipe, () => {
    console.log('[mcp] сервер слушает канал', endpoint?.pipe);
  });
  server = srv;
}

export function stopMcpServer(): void {
  if (!server) return;
  server.close();
  server = null;
  console.log('[mcp] сервер остановлен');
}
