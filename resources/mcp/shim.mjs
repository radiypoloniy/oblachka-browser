// Шим MCP: перекладывает строки между stdio и именованным каналом браузера.
//
// ⚠️ Он ничего не знает про MCP, и это его главное свойство. Клиент (Claude Desktop, Claude Code,
// Cursor) по спеке ЗАПУСКАЕТ сервер дочерним процессом и говорит с ним по stdin/stdout, а наш
// браузер уже запущен своим процессом. Шим закрывает эту щель: кадрирование у канала и у stdio
// одно и то же — по одному JSON-RPC сообщению на строку, — поэтому здесь достаточно передавать
// строки как есть. Разбор, политика и инструменты живут в браузере, в одном месте.
//
// ⚠️ Запускается НЕ через node, которого у человека может не быть, а самим приложением в режиме
// Node: ELECTRON_RUN_AS_NODE=1 плюс путь к этому файлу. Отдельный бинарник собирать не нужно.
//
//   claude mcp add oblako --env ELECTRON_RUN_AS_NODE=1 -- "C:\\Program Files\\Oblako\\Oblako.exe" "C:\\Program Files\\Oblako\\resources\\mcp\\shim.mjs"
//
// ⚠️ Всё, что шим говорит о себе, идёт в stderr. В stdout по спеке нельзя писать НИЧЕГО, кроме
// сообщений протокола: одна отладочная строка там — и клиент видит сломанный сервер.

import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const argEndpoint = process.argv.indexOf('--endpoint');
const endpointFile = argEndpoint !== -1 && process.argv[argEndpoint + 1]
  ? process.argv[argEndpoint + 1]
  : path.join(process.env.APPDATA ?? '', 'oblako-browser', 'mcp-endpoint.json');

function die(reason) {
  process.stderr.write(`[oblako-mcp] ${reason}\n`);
  process.exit(1);
}

let endpoint;
try {
  endpoint = JSON.parse(fs.readFileSync(endpointFile, 'utf8'));
} catch {
  die(`точка подключения не найдена: ${endpointFile}\n`
    + 'Откройте Oblako и включите MCP-сервер в настройках, затем повторите.');
}
if (!endpoint?.pipe || !endpoint?.token) die('точка подключения испорчена — включите MCP-сервер в настройках заново');

const socket = net.connect(endpoint.pipe);

socket.on('error', (e) => {
  // ⚠️ Отказ объясняем словами: клиент покажет эту строку человеку, и «Oblako не запущен» он
  // починит сам, а на таймаут без причины будет смотреть молча.
  die(`браузер не отвечает (${e.code ?? e.message}). Запущен ли Oblako?`);
});

socket.on('connect', () => {
  socket.write(`${JSON.stringify({ auth: endpoint.token })}\n`);
});

// Первая строка от браузера — подтверждение токена, наружу она не идёт.
let authorised = false;
let buffer = '';

socket.setEncoding('utf8');
socket.on('data', (chunk) => {
  buffer += chunk;
  let cut = buffer.indexOf('\n');
  while (cut !== -1) {
    const line = buffer.slice(0, cut);
    buffer = buffer.slice(cut + 1);
    if (!authorised) {
      authorised = true;
      let okAuth = false;
      try { okAuth = JSON.parse(line)?.auth === 'ok'; } catch { okAuth = false; }
      if (!okAuth) die('браузер отклонил токен — включите MCP-сервер в настройках заново');
    } else if (line.trim()) {
      process.stdout.write(`${line}\n`);
    }
    cut = buffer.indexOf('\n');
  }
});

socket.on('close', () => {
  process.stderr.write('[oblako-mcp] соединение с браузером закрыто\n');
  process.exit(0);
});

// stdin → канал. Строки не разбираем: что прислал клиент, то и уходит браузеру.
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { socket.write(chunk); });

// ⚠️ Закрытый stdin — штатный сигнал завершения по спеке stdio, а не сбой.
process.stdin.on('end', () => { socket.end(); process.exit(0); });
