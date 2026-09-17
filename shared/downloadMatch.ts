// Совпадение «тот же файл уже скачан» — без electron, под npm test.
//
// ⚠️ Резать query целиком нельзя: у подписанного CDN идентификатор лежит в пути, а билет — в
// query, но у трекера наоборот (dl.php?t=номер). Срезая всё, два разных торрента с одного
// форума считались одним файлом; человек удалил «свой», а вопрос «уже скачан» открывал чужой.

/** Билет, не файл: Azure SAS, S3, CloudFront, типичный token/expires. */
const EPHEMERAL = /^(?:x-amz-.+|sig(?:nature)?|expires?|expiry|exp|token|hmac|key-pair-id|policy|awsaccesskeyid|st|se|sv|sr|sp|spr|sip|skoid|sktid|skt|ske|sks|skv|it|rit|rscd|rsct|uk|sid|sessionid|phpsessid)$/i;

/**
 * Ключ адреса для сравнения загрузок. Не http(s) — пусто: blob/data каждый раз новые.
 * Эфемерные параметры выкинуты, остальные (id, t, file) остаются в стабильном порядке.
 */
export function downloadUrlKey(u: string): string {
  try {
    const p = new URL(u);
    if (p.protocol !== 'http:' && p.protocol !== 'https:') return '';
    const kept = [...p.searchParams.entries()]
      .filter(([k]) => !EPHEMERAL.test(k))
      .sort(([a], [b]) => a.localeCompare(b) || 0);
    const q = new URLSearchParams(kept).toString();
    return p.origin + p.pathname + (q ? `?${q}` : '');
  } catch {
    return '';
  }
}

export function sameDownloadUrl(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const ka = downloadUrlKey(a);
  const kb = downloadUrlKey(b);
  return ka !== '' && ka === kb;
}

/** Имя, которое сервер ставит пачкой разным файлам — по нему нельзя узнавать «тот же файл». */
export function genericDownloadName(filename: string): boolean {
  const base = filename.replace(/\.[^.]+$/, '').trim();
  return /^(download|file|document|image|video|untitled|unknown)(?: \(\d+\))?$/i.test(base);
}

export function sameDownloadFile(
  aName: string, aBytes: number,
  bName: string, bBytes: number,
): boolean {
  if (aBytes <= 0 || aBytes !== bBytes) return false;
  if (!aName || aName !== bName) return false;
  return !genericDownloadName(aName);
}
