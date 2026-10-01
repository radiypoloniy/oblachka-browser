export function parsePasswordRange(body: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of body.split(/\r?\n/)) {
    const [rawSuffix, rawCount] = line.trim().split(':', 2);
    const suffix = rawSuffix?.toUpperCase() ?? '';
    const count = Number(rawCount);
    // Add-Padding добавляет синтетические строки с count=0 — они намеренно отбрасываются.
    if (/^[A-F0-9]{35}$/.test(suffix) && Number.isSafeInteger(count) && count > 0) counts.set(suffix, count);
  }
  return counts;
}
