// Нормализация домена — общая для main-процесса (AdBlockManager: сверка whitelist) и renderer'а
// (поповер «Защита»: определение домена активной вкладки для отображения/IPC-запросов).
// Только Web-API (URL) внутри — безопасно бандлится и в Vite (браузер), и в tsc (Node).
// "https://www.Reddit.com/r/..." → "reddit.com"
export function normalizeDomain(raw: string): string | null {
  let s = raw.trim().toLowerCase();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try {
    let host = new URL(s).hostname;
    if (host.startsWith('www.')) host = host.slice(4);
    return host || null;
  } catch { return null; }
}
