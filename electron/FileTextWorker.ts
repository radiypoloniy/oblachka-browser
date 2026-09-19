// Разбор документов может быть тяжёлым; он не должен занимать main-поток браузера.
import { parentPort } from 'node:worker_threads';
import { extractFileText } from './FileExtract';

type Request = { id: number; filePath: string };

parentPort?.on('message', async ({ id, filePath }: Request) => {
  try {
    const result = await extractFileText(filePath);
    parentPort?.postMessage({ id, result });
  } catch (error) {
    parentPort?.postMessage({ id, result: { ok: false, error: String(error) } });
  }
});
