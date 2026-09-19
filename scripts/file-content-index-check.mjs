// Проверяет поиск по тексту, обновление, удаление и изоляцию на временном профиле.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { withStand } from './isolated-stand.mjs';

await withStand(async (ctx) => {
  const filePath = path.join(ctx.profile, 'neutral-name.txt');
  await fs.writeFile(filePath, 'Исследование квантовых материалов и сверхпроводимости', 'utf8');
  const docxPath = path.join(ctx.profile, 'neutral-document.docx');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Арктические минералы</w:t></w:r></w:p></w:body></w:document>');
  await fs.writeFile(docxPath, await zip.generateAsync({ type: 'nodebuffer' }));
  const pdfPath = path.join(ctx.profile, 'neutral-document.pdf');
  const stream = 'BT /F1 18 Tf 72 720 Td (Solar spectrum analysis) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  await fs.writeFile(pdfPath, pdf, 'latin1');
  const indexModule = path.resolve('dist-electron/electron/FileContentIndex.js');
  const dbA = path.join(ctx.profile, 'files-a.sqlite');
  const dbB = path.join(ctx.profile, 'files-b.sqlite');
  const result = await ctx.evalMain(`(async () => {
    const { FileContentIndex } = process.mainModule.require(${JSON.stringify(indexModule)});
    const fs = process.mainModule.require('node:fs/promises');
    const entry = { id: 'download-1', filename: 'neutral-name.txt', savePath: ${JSON.stringify(filePath)},
      state: 'completed', fileMissing: false, startedAt: Date.now() };
    const docx = { ...entry, id: 'download-2', filename: 'neutral-document.docx', savePath: ${JSON.stringify(docxPath)} };
    const pdf = { ...entry, id: 'download-3', filename: 'neutral-document.pdf', savePath: ${JSON.stringify(pdfPath)} };
    const a = new FileContentIndex('test-a', ${JSON.stringify(dbA)});
    const b = new FileContentIndex('test-b', ${JSON.stringify(dbB)});
    await a.sync([entry, docx, pdf]);
    const first = a.search('сверхпроводимость').map((hit) => hit.downloadId);
    const docxHits = a.search('минералы').map((hit) => hit.downloadId);
    const pdfHits = a.search('spectrum').map((hit) => hit.downloadId);
    const reopened = new FileContentIndex('test-a', ${JSON.stringify(dbA)});
    const persisted = reopened.search('spectrum').map((hit) => hit.downloadId);
    const isolated = b.search('сверхпроводимость').length;
    await fs.writeFile(${JSON.stringify(filePath)}, 'Биология клеток и белков', 'utf8');
    await a.sync([entry, docx, pdf]);
    const oldGone = a.search('сверхпроводимость').length;
    const updated = a.search('биология').map((hit) => hit.downloadId);
    await a.sync([]);
    const deleted = a.search('биология').length;
    return { first, docxHits, pdfHits, persisted, isolated, oldGone, updated, deleted };
  })()`);
  assert.deepEqual(result.first, ['download-1']);
  assert.deepEqual(result.docxHits, ['download-2']);
  assert.deepEqual(result.pdfHits, ['download-3']);
  assert.deepEqual(result.persisted, ['download-3']);
  assert.equal(result.isolated, 0);
  assert.equal(result.oldGone, 0);
  assert.deepEqual(result.updated, ['download-1']);
  assert.equal(result.deleted, 0);
  console.log('Файл найден по содержимому; изменение и удаление обновили профильный индекс');
}, { main: true });
