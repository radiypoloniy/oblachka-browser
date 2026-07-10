// VPN, шаг 1 — чистый парсинг ссылок подписки в структуру сервера. Никакого I/O здесь
// (ни сети, ни диска) — это отдельно (VpnSubscription.ts — фетч, VpnKeyStore.ts — хранение),
// чтобы парсинг можно было тестировать и переиспользовать независимо от них.
//
// MVP (см. бриф): протоколы vless/trojan, транспорты tcp/ws/xhttp/grpc, security none/tls/reality.
// Поля, которые Xray-конфигу для этих транспортов не нужны, не парсим — не расширяем поверхность
// разбора ради полей, которые всё равно некуда будет применить на шаге 2 (генерация конфига).
import crypto from 'node:crypto';

export type VpnProtocol = 'vless' | 'trojan';
export type VpnTransport = 'tcp' | 'ws' | 'grpc' | 'xhttp';
export type VpnSecurity = 'none' | 'tls' | 'reality';

export interface VpnServer {
  // Стабильный id — хэш нормализованной строки подключения (без remark, тот у одного и того же
  // сервера может меняться между обновлениями подписки) — чтобы выбор активного сервера
  // переживал refresh подписки, если сам сервер не поменялся.
  id: string;
  protocol: VpnProtocol;
  remark: string; // из #fragment — то, что видит пользователь в списке
  address: string;
  port: number;
  // vless — uuid; trojan — пароль. Секрет, наружу в renderer не уходит (см. shared/ipc.ts::VpnServerMeta).
  credential: string;

  security: VpnSecurity;
  sni?: string;
  fingerprint?: string; // fp
  alpn?: string[];
  // Reality
  publicKey?: string; // pbk
  shortId?: string;   // sid
  spiderX?: string;   // spx

  // VLESS-специфичное
  encryption?: string; // почти всегда 'none' у vless, но парсим как есть
  flow?: string;       // например xtls-rprx-vision — осмыслен только с tcp+reality

  transport: VpnTransport;
  path?: string;        // ws/xhttp
  host?: string;        // Host-заголовок ws/xhttp
  xhttpMode?: string;   // xhttp: auto/packet-up/stream-up/stream-one
  serviceName?: string; // grpc
}

function stableId(protocol: string, address: string, port: number, credential: string): string {
  return crypto.createHash('sha256').update(`${protocol}|${address}|${port}|${credential}`).digest('hex').slice(0, 16);
}

function parseAlpn(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length > 0 ? list : undefined;
}

function normalizeTransport(raw: string | null): VpnTransport {
  const t = (raw ?? 'tcp').toLowerCase();
  if (t === 'ws' || t === 'grpc' || t === 'xhttp') return t;
  return 'tcp';
}

function normalizeSecurity(raw: string | null): VpnSecurity {
  const s = (raw ?? 'none').toLowerCase();
  if (s === 'tls' || s === 'reality') return s;
  return 'none';
}

// vless://<uuid>@<host>:<port>?<query>#<remark>
function parseVless(uri: string): VpnServer | null {
  try {
    const u = new URL(uri);
    const uuid = decodeURIComponent(u.username);
    const address = u.hostname;
    const port = Number(u.port);
    if (!uuid || !address || !port) return null;
    const q = u.searchParams;
    return {
      id: stableId('vless', address, port, uuid),
      protocol: 'vless',
      remark: decodeURIComponent(u.hash.replace(/^#/, '')) || address,
      address,
      port,
      credential: uuid,
      security: normalizeSecurity(q.get('security')),
      sni: q.get('sni') ?? undefined,
      fingerprint: q.get('fp') ?? undefined,
      alpn: parseAlpn(q.get('alpn')),
      publicKey: q.get('pbk') ?? undefined,
      shortId: q.get('sid') ?? undefined,
      spiderX: q.get('spx') ?? undefined,
      encryption: q.get('encryption') ?? 'none',
      flow: q.get('flow') ?? undefined,
      transport: normalizeTransport(q.get('type')),
      path: q.get('path') ?? undefined,
      host: q.get('host') ?? undefined,
      xhttpMode: q.get('mode') ?? undefined,
      serviceName: q.get('serviceName') ?? undefined,
    };
  } catch {
    return null;
  }
}

// trojan://<password>@<host>:<port>?<query>#<remark>
function parseTrojan(uri: string): VpnServer | null {
  try {
    const u = new URL(uri);
    const password = decodeURIComponent(u.username);
    const address = u.hostname;
    const port = Number(u.port);
    if (!password || !address || !port) return null;
    const q = u.searchParams;
    return {
      id: stableId('trojan', address, port, password),
      protocol: 'trojan',
      remark: decodeURIComponent(u.hash.replace(/^#/, '')) || address,
      address,
      port,
      credential: password,
      // trojan по умолчанию TLS, даже если security не указан явно (в отличие от vless).
      security: q.has('security') ? normalizeSecurity(q.get('security')) : 'tls',
      sni: q.get('sni') ?? undefined,
      fingerprint: q.get('fp') ?? undefined,
      alpn: parseAlpn(q.get('alpn')),
      publicKey: q.get('pbk') ?? undefined,
      shortId: q.get('sid') ?? undefined,
      spiderX: q.get('spx') ?? undefined,
      transport: normalizeTransport(q.get('type')),
      path: q.get('path') ?? undefined,
      host: q.get('host') ?? undefined,
      xhttpMode: q.get('mode') ?? undefined,
      serviceName: q.get('serviceName') ?? undefined,
    };
  } catch {
    return null;
  }
}

// Редактированная версия для renderer — см. shared/ipc.ts::VpnServerMeta. credential (uuid/
// пароль) и прочие транспортные детали (reality-ключи, sni и т.п.) сюда не попадают — не нужны
// для отображения списка серверов, показывать/копировать их пользователю в UI незачем.
export function toServerMeta(s: VpnServer): { id: string; protocol: VpnProtocol; remark: string; address: string; port: number; security: VpnSecurity; transport: VpnTransport } {
  return {
    id: s.id, protocol: s.protocol, remark: s.remark,
    address: s.address, port: s.port, security: s.security, transport: s.transport,
  };
}

export function parseServerUri(uri: string): VpnServer | null {
  const trimmed = uri.trim();
  if (trimmed.startsWith('vless://')) return parseVless(trimmed);
  if (trimmed.startsWith('trojan://')) return parseTrojan(trimmed);
  return null; // неподдержанная в MVP схема (vmess/ss/...) — тихо пропускаем, не бросаем
}

function looksLikeServerList(text: string): boolean {
  return /^(vless|trojan):\/\//m.test(text);
}

// Содержимое подписки — либо base64-блок (классический формат), либо уже развёрнутый
// текстовый список URI построчно. Пробуем как есть, потом base64 — так надёжнее, чем
// пытаться угадать формат заранее по заголовкам ответа (провайдеры их не гарантируют).
export interface ParsedSubscription {
  servers: VpnServer[];
  skipped: number; // строки, которые распознали как непустые, но не смогли распарсить
}

export function parseSubscriptionContent(raw: string): ParsedSubscription {
  let text = raw.trim();
  if (!looksLikeServerList(text)) {
    try {
      const decoded = Buffer.from(text, 'base64').toString('utf8');
      if (looksLikeServerList(decoded)) text = decoded;
    } catch {
      // не base64 — оставляем как есть, лишь бы не уронить парсинг
    }
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const servers: VpnServer[] = [];
  let skipped = 0;
  for (const line of lines) {
    const server = parseServerUri(line);
    if (server) servers.push(server);
    else skipped++;
  }
  return { servers, skipped };
}
