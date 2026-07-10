// VPN, шаг 1 — оркестрация: fetch ссылки подписки + парсинг + сохранение. Разделено с
// VpnParser.ts (чистая логика) и VpnKeyStore.ts (хранение) — здесь только склейка.
//
// ⚠️ net.fetch (модуль Electron 'net'), НЕ глобальный fetch() — тот идёт через сетевой стек
// Node/undici и НЕ уважает session.setProxy(), см. живой аудит утечек (SearchSuggestFetcher.ts
// тем же багом). net.fetch — часть session.defaultSession, когда шаг 3 включит прокси на VPN,
// обновление подписки автоматически пойдёт через тот же туннель, а не в обход него.
import { net } from 'electron';
import { parseSubscriptionContent } from './VpnParser';
import * as store from './VpnKeyStore';

const FETCH_TIMEOUT_MS = 15_000;

// Живой аудит на реальной подписке (панель Remnawave): дефолтный браузерный User-Agent
// (Chrome/Safari/AppleWebKit-подобный) получает HTTP 502 — панели-обёртки над Xray/sing-box
// массово блокируют похожие-на-браузер UA (анти-скрапинг), но пропускают практически любую
// другую строку, включая честное имя приложения — проверено эмпирически (curl, "Oblako/1.0" и
// сторонние клиентские UA все одинаково получают 200 с тем же телом ответа). Не притворяемся
// другим приложением (v2rayNG и т.п.) — это было бы обманом сервера, а не необходимостью.
const SUBSCRIPTION_USER_AGENT = 'Oblako/1.0';

export interface SubscriptionResult {
  ok: boolean;
  error?: string;
  count?: number;
  skipped?: number;
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await net.fetch(url, { signal: controller.signal, headers: { 'User-Agent': SUBSCRIPTION_USER_AGENT } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function validateUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Ссылка должна быть http(s)';
    return null;
  } catch {
    return 'Некорректная ссылка';
  }
}

// Явное действие пользователя (вставил новую ссылку в Settings) — fetch, парсинг, если хоть
// один сервер распознан — сохраняем. Пустой результат (0 серверов) не считаем успехом: не
// затираем уже сохранённую рабочую подписку неудачным ответом (провайдер мог отдать ошибку/
// пустую страницу вместо списка).
export async function setSubscription(url: string): Promise<SubscriptionResult> {
  const urlError = validateUrl(url);
  if (urlError) return { ok: false, error: urlError };

  let text: string;
  try {
    text = await fetchText(url);
  } catch (e) {
    return { ok: false, error: `Не удалось загрузить: ${(e as Error).message}` };
  }

  const { servers, skipped } = parseSubscriptionContent(text);
  if (servers.length === 0) {
    return { ok: false, error: 'В подписке не найдено ни одного поддерживаемого сервера (vless/trojan)', skipped };
  }

  const saved = store.save(url, servers);
  if (!saved) return { ok: false, error: 'Не удалось сохранить (шифрование недоступно на этой машине)' };

  return { ok: true, count: servers.length, skipped };
}

// Повторный fetch по уже сохранённой ссылке — url остаётся main-only (см. VpnKeyStore.ts).
export async function refresh(): Promise<SubscriptionResult> {
  const url = store.getUrl();
  if (!url) return { ok: false, error: 'Подписка не сохранена' };
  return setSubscription(url);
}
