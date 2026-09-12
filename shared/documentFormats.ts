// Форматы файлов, о которых спрашивают оба берега.
//
// ⚠️ Живут в shared, не рядом с читателем (electron/FileExtract.ts) и не в renderer: main решает,
// что читать и из чего делать кадр, поповер — показывать ли «Назвать» и стопку фото. Две копии
// в синхроне руками — ровно тот класс расхождений, от которого заведено правило про shared/ipc.ts.
export const DOCUMENT_EXTENSIONS = ['txt', 'md', 'markdown', 'csv', 'json', 'log', 'docx', 'pdf'];

/**
 * Картинки, из которых nativeImage умеет сделать превью. HEIC/SVG/AVIF часто пустые —
 * для них остаётся иконка Проводника, не «битый кадр».
 */
export const IMAGE_THUMB_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'];

function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot < 0 ? '' : filename.slice(dot + 1).toLowerCase();
}

/** Есть ли смысл предлагать имя по содержимому для этого файла. */
export function isDocumentFile(filename: string): boolean {
  return DOCUMENT_EXTENSIONS.includes(extOf(filename));
}

/** Можно ли показать сам кадр вместо значка типа. */
export function isImageFile(filename: string): boolean {
  return IMAGE_THUMB_EXTENSIONS.includes(extOf(filename));
}
