// Форматы документов, из которых мы умеем достать текст.
//
// ⚠️ Список живёт в shared, а не рядом с читателем (electron/FileExtract.ts), потому что о нём
// спрашивают ОБА берега: main решает, что читать, а поповер загрузок — показывать ли кнопку
// «Назвать по содержимому». Две копии в синхроне руками — ровно тот класс расхождений, от
// которого в проекте заведено правило про shared/ipc.ts и shared/translateLangs.ts.
export const DOCUMENT_EXTENSIONS = ['txt', 'md', 'markdown', 'csv', 'json', 'log', 'docx', 'pdf'];

/** Есть ли смысл предлагать имя по содержимому для этого файла. */
export function isDocumentFile(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return DOCUMENT_EXTENSIONS.includes(ext);
}
