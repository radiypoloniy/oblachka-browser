// Разбор строки омнибокса: бэнг, схема, локальный файл, хост или поиск.
//
// ⚠️ Порядок несущий и единственно возможный. Бэнг («!yt котики») никогда не URL и не хост,
// а строка с точкой наоборот может притвориться всем сразу. Путь `C:\...\page.html` кончается
// на `.html` и без проверки файла уезжал на `https://C:/...`.
//
// Без импортов: проверка гоняется голым node. Бэнг, файл и поисковик приходят снаружи —
// хранилище бэнгов и диск живут в electron, сюда им незачем.

export interface OmniboxResolveDeps {
  resolveBang: (s: string) => string | null;
  fileUrl: (s: string) => string | null;
  buildSearchUrl: (query: string) => string;
}

export function resolveOmniboxInput(input: string, deps: OmniboxResolveDeps): string {
  const s = input.trim();
  if (!s) return 'about:blank';
  // Неизвестный ключ бэнгом не считается и уходит дальше как обычный запрос —
  // текст, случайно начатый с «!», не превращается в навигацию в никуда.
  const bangUrl = deps.resolveBang(s);
  if (bangUrl) return bangUrl;
  if (/^(https?|file|about):/i.test(s)) return s;
  // Несуществующий путь fileUrl не принимает — вызывающий решает, поиск это или хост.
  const fileUrl = deps.fileUrl(s);
  if (fileUrl) return fileUrl;
  const looksLikeHost =
    /^localhost(:\d+)?(\/.*)?$/i.test(s) ||
    /^(\d{1,3}\.){3}\d{1,3}(:\d+)?(\/.*)?$/.test(s) ||
    (!/\s/.test(s) && /\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s));
  if (looksLikeHost) return `https://${s}`;
  return deps.buildSearchUrl(s);
}
