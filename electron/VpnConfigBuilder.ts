// VPN, шаг 2 — сборка JSON-конфига Xray-core из VpnServer (VpnParser.ts). Чистая функция, без
// I/O — VpnProcess.ts пишет результат в файл и передаёт xray.exe через -config.
//
// MVP-объём (см. план): протоколы vless/trojan, транспорты tcp/ws/xhttp/grpc, security
// none/tls/reality. Один инбаунд (локальный SOCKS, только 127.0.0.1 — НИКОГДА 0.0.0.0, иначе
// локальный прокси видят другие процессы на машине), один аутбаунд — выбранный сервер, плюс
// служебный "direct" для трафика самого Xray (DNS-резолв и т.п., не участвует в routing.rules
// пользовательского трафика). Никакого geoip/geosite-роутинга — файлы сознательно не качаем
// (см. download-xray.mjs) и не ссылаемся на geosite:/geoip: категории в rules.
import type { VpnServer } from './VpnParser';

export interface XrayConfig {
  log: { loglevel: string };
  inbounds: unknown[];
  outbounds: unknown[];
  routing: { rules: unknown[] };
}

const SOCKS_INBOUND_TAG = 'oblako-socks-in';
const PROXY_OUTBOUND_TAG = 'oblako-proxy';
const DIRECT_OUTBOUND_TAG = 'oblako-direct';

function buildStreamSettings(server: VpnServer): Record<string, unknown> {
  const stream: Record<string, unknown> = { network: server.transport };

  if (server.security === 'tls') {
    stream.security = 'tls';
    stream.tlsSettings = {
      serverName: server.sni,
      fingerprint: server.fingerprint,
      alpn: server.alpn,
    };
  } else if (server.security === 'reality') {
    stream.security = 'reality';
    stream.realitySettings = {
      serverName: server.sni,
      fingerprint: server.fingerprint,
      publicKey: server.publicKey,
      shortId: server.shortId,
      spiderX: server.spiderX,
    };
  }

  if (server.transport === 'ws') {
    stream.wsSettings = {
      path: server.path,
      headers: server.host ? { Host: server.host } : undefined,
    };
  } else if (server.transport === 'xhttp') {
    stream.xhttpSettings = {
      path: server.path,
      host: server.host,
      mode: server.xhttpMode,
    };
  } else if (server.transport === 'grpc') {
    stream.grpcSettings = { serviceName: server.serviceName };
  }

  return stream;
}

function buildOutboundSettings(server: VpnServer): Record<string, unknown> {
  if (server.protocol === 'vless') {
    return {
      vnext: [{
        address: server.address,
        port: server.port,
        users: [{
          id: server.credential,
          encryption: server.encryption || 'none',
          flow: server.flow || undefined,
        }],
      }],
    };
  }
  // trojan
  return {
    servers: [{
      address: server.address,
      port: server.port,
      password: server.credential,
    }],
  };
}

// localSocksPort — выделяется вызывающей стороной (VpnProcess.ts::findFreePort), не здесь:
// сборка конфига не должна сама решать сетевые вопросы, только описывать то, что ей дали.
export function buildXrayConfig(server: VpnServer, localSocksPort: number): XrayConfig {
  return {
    log: { loglevel: 'warning' },
    inbounds: [
      {
        tag: SOCKS_INBOUND_TAG,
        listen: '127.0.0.1',
        port: localSocksPort,
        protocol: 'socks',
        settings: { udp: true, auth: 'noauth' },
      },
    ],
    outbounds: [
      {
        tag: PROXY_OUTBOUND_TAG,
        protocol: server.protocol,
        settings: buildOutboundSettings(server),
        streamSettings: buildStreamSettings(server),
      },
      {
        tag: DIRECT_OUTBOUND_TAG,
        protocol: 'freedom',
      },
    ],
    routing: {
      rules: [
        {
          type: 'field',
          inboundTag: [SOCKS_INBOUND_TAG],
          outboundTag: PROXY_OUTBOUND_TAG,
        },
      ],
    },
  };
}
