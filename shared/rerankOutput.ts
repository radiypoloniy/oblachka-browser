// Ответ модели считается списком только если он целиком состоит из номеров.
// Иначе цифры из пояснения или повторённого промпта нельзя принимать за выбор.
export function parseRerankIndices(output: string, count: number): number[] {
  const trimmed = output.trim();
  if (!trimmed) return [];
  if (!/^\d+(?:\s*,\s*\d+)*$/.test(trimmed)) throw new Error('неверный формат списка реранка');
  const seen = new Set<number>();
  const indices: number[] = [];
  for (const raw of trimmed.split(',')) {
    const index = Number(raw.trim());
    if (!Number.isSafeInteger(index) || index < 0 || index >= count) {
      throw new Error('номер реранка вне списка кандидатов');
    }
    if (!seen.has(index)) {
      seen.add(index);
      indices.push(index);
    }
  }
  return indices;
}
