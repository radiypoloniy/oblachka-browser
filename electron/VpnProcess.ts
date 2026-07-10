// VPN, шаг 2 — жизненный цикл процесса Xray-core: резолв бинарника, свободный локальный порт,
// запись конфига, спавн, health-check, graceful shutdown.
//
// ⚠️ Этот модуль ЕЩЁ НЕ подключает session.setProxy — это шаг 3 (самый рискованный, реальный
// трафик). Здесь только "поднять процесс и убедиться, что локальный SOCKS-порт отвечает".
//
// Платформенная часть (resolveXrayBinaryPath) изолирована в одной функции — единственное
// место, которое макOS-порт должен будет расширить (см. CLAUDE.md «Кроссплатформенность»).
import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import type { VpnServer } from './VpnParser';
import { buildXrayConfig } from './VpnConfigBuilder';

export type VpnProcessState = 'stopped' | 'starting' | 'running' | 'error';

const HEALTH_CHECK_TIMEOUT_MS = 8_000;
const HEALTH_CHECK_INTERVAL_MS = 200;
const SHUTDOWN_GRACE_MS = 3_000;
// Последние строки stdout/stderr — для диагностики в Settings при ошибке. Не пишем xray-лог
// на диск по умолчанию: он может содержать SNI/адреса серверов, а это не более секретно, чем
// уже открытая вкладка на этот сервер, но лишний файл на диске всё равно не нужен без причины.
const LOG_RING_SIZE = 200;

let child: ChildProcess | null = null;
let state: VpnProcessState = 'stopped';
let currentPort: number | null = null;
let logRing: string[] = [];
let onStateChangeCb: ((s: VpnProcessState, error?: string) => void) | null = null;

export function onStateChange(cb: (s: VpnProcessState, error?: string) => void): void {
  onStateChangeCb = cb;
}

function setState(next: VpnProcessState, error?: string): void {
  state = next;
  onStateChangeCb?.(next, error);
}

export function getState(): VpnProcessState {
  return state;
}

export function getLocalSocksPort(): number | null {
  return currentPort;
}

export function getRecentLogs(): string[] {
  return [...logRing];
}

function pushLog(chunk: string): void {
  for (const line of chunk.split('\n')) {
    if (!line.trim()) continue;
    logRing.push(line);
  }
  if (logRing.length > LOG_RING_SIZE) logRing = logRing.slice(-LOG_RING_SIZE);
}

function resolveXrayBinaryPath(): string {
  if (process.platform !== 'win32') {
    throw new Error(`VPN пока поддерживается только на Windows (платформа: ${process.platform})`);
  }
  if (app.isPackaged) return path.join(process.resourcesPath, 'xray', 'xray.exe');
  // dev / npm start: __dirname = dist-electron/electron/ → ../../resources/xray
  return path.join(__dirname, '../../resources', 'xray', 'xray.exe');
}

// Слушаем 127.0.0.1:0 → ОС выделяет свободный порт → сразу закрываем и переиспользуем номер
// для Xray. Обычная гонка (порт теоретически может кто-то перехватить между close() и стартом
// Xray) — тот же компромисс, на который идёт любой инструмент с автовыбором порта.
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      if (address && typeof address === 'object') {
        const port = address.port;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error('не удалось получить свободный порт'));
      }
    });
  });
}

function waitForSocksPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect({ host: '127.0.0.1', port }, () => {
        sock.end();
        resolve();
      });
      sock.on('error', () => {
        sock.destroy();
        if (Date.now() >= deadline) reject(new Error('Xray не поднял локальный порт за отведённое время'));
        else setTimeout(attempt, HEALTH_CHECK_INTERVAL_MS);
      });
    };
    attempt();
  });
}

function configFilePath(): string {
  return path.join(app.getPath('userData'), 'xray-config.json');
}

// Запускает Xray с выбранным сервером. Уже запущенный процесс сначала останавливается — два
// конкурентных SOCKS-порта только всё запутают, активным должен быть ровно один.
export async function start(server: VpnServer): Promise<{ ok: boolean; error?: string }> {
  if (state === 'starting' || state === 'running') await stop();
  setState('starting');
  logRing = [];

  let binaryPath: string;
  try {
    binaryPath = resolveXrayBinaryPath();
    if (!fs.existsSync(binaryPath)) {
      throw new Error(`бинарник не найден: ${binaryPath} (запустите npm run download-xray)`);
    }
  } catch (e) {
    setState('error', (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }

  let port: number;
  try {
    port = await findFreePort();
  } catch {
    setState('error', 'Не удалось выделить локальный порт');
    return { ok: false, error: 'Не удалось выделить локальный порт' };
  }

  const config = buildXrayConfig(server, port);
  const cfgPath = configFilePath();
  try {
    // ⚠️ Конфиг содержит credential сервера (uuid/пароль) в открытом виде — это оперативный
    // файл (перезаписывается на каждый connect), не персистентное хранилище (то —
    // VpnKeyStore.ts, зашифровано). Права на userData и так ограничены учёткой пользователя
    // ОС, как и у остальных файлов браузера (history.sqlite и т.п.) — тот же уровень защиты.
    fs.writeFileSync(cfgPath, JSON.stringify(config));
  } catch {
    setState('error', 'Не удалось записать конфиг');
    return { ok: false, error: 'Не удалось записать конфиг' };
  }

  try {
    child = spawn(binaryPath, ['-config', cfgPath], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    setState('error', (e as Error).message);
    return { ok: false, error: 'Не удалось запустить процесс' };
  }

  const proc = child;
  proc.stdout?.on('data', (d: Buffer) => pushLog(d.toString()));
  proc.stderr?.on('data', (d: Buffer) => pushLog(d.toString()));
  proc.on('exit', (code, signal) => {
    // child уже null → это был наш собственный stop(), не неожиданное падение — no-op.
    // Иначе процесс умер сам: fail-closed — вызывающая сторона (main.ts) обязана сбросить
    // session.setProxy на direct при виде состояния 'error' (см. план, шаг 3). Здесь только
    // сообщаем факт, решение про трафик — не забота этого модуля.
    if (child === proc) {
      child = null;
      currentPort = null;
      setState('error', `Xray завершился неожиданно (код ${code}, сигнал ${signal})`);
    }
  });

  try {
    await waitForSocksPort(port, HEALTH_CHECK_TIMEOUT_MS);
  } catch (e) {
    await stop();
    setState('error', (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }

  currentPort = port;
  setState('running');
  return { ok: true };
}

// ⚠️ ВСЕГДА переводит в 'stopped', даже если до этого было 'error' — это осознанный выбор
// после живого теста: более ранняя версия сохраняла 'error' навсегда (чтобы UI не терял
// сообщение о том, какой сервер отвалился), но это означало, что kill switch
// (см. main.ts::applyVpnProxy) блокировал ВЕСЬ трафик НАВСЕГДА без единого способа выйти —
// disconnect обязан быть гарантированным путём назад к рабочему (пусть и незащищённому)
// состоянию, иначе это не «безопасно по умолчанию», а тупик. Сообщение об ошибке в UI решается
// иначе — см. Settings.tsx (кнопка «Отключить» видна и в состоянии error, не только running).
export async function stop(): Promise<void> {
  const proc = child;
  child = null;
  currentPort = null;

  if (!proc || proc.exitCode !== null) {
    setState('stopped');
    return;
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* уже мёртв */ }
    }, SHUTDOWN_GRACE_MS);
    proc.once('exit', () => { clearTimeout(timer); resolve(); });
    try {
      proc.kill('SIGTERM');
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });

  setState('stopped');
}
