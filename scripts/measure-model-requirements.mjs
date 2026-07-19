#!/usr/bin/env node
/**
 * Разведочный инструмент: снимает VRAM/RAM-требования GGUF-модели через метаданные заголовка —
 * БЕЗ loadModel() (модель не грузится в память) и без скачивания файла целиком. readGgufFileInfo()
 * для сетевых URL читает только заголовок через HTTP Range-запросы (порядка единиц-десятков МБ на
 * модель — размер зависит от объёма metadata/tensor-info в самом GGUF, не от размера весов).
 *
 * ⚠️ GgufInsights.from(ggufFileInfo) БЕЗ второго аргумента (реального Llama-инстанса) создаёт
 * внутри себя "slim"-заглушку без GPU-бэкенда — тогда estimateModelResourceRequirementsV2()
 * и estimateContextResourceRequirementsV2() МОЛЧА возвращают gpuVram: 0 для любых входных данных
 * (все "деньги" утекают в cpuRam) — БЕЗ единой ошибки или предупреждения. Подтверждено на практике
 * при разработке этого скрипта: первый прогон без переданного llama дал gpuVram:0 на всех точках.
 * Поэтому здесь инстанс передаётся ОБЯЗАТЕЛЬНО — через getLlama() (реальный GPU-бэкенд
 * инициализируется, но loadModel так и не вызывается).
 *
 * Запуск: node scripts/measure-model-requirements.mjs <url-или-путь> [...ещё]
 *   npm run measure-model -- <url-или-путь> [...ещё]
 *
 * Ничего не пишет на диск и не изменяет — только печатает JSON в stdout, по объекту на модель.
 */
import { getLlama, readGgufFileInfo, GgufInsights } from 'node-llama-cpp';

// Точки контекста для снятия estimateContextResourceRequirementsV2 — пять точек, не три: см. живую
// проверку линейности (задача после первой версии этого скрипта), где трёх точек оказалось
// недостаточно, чтобы уверенно отличить "линейно" от "линейно с фиксированным смещением на малых
// contextSize". 4096 — минимальная осмысленная точка (меньше — сам оверхед графа/батча может
// доминировать над KV-кэшем и исказить оценку байт/токен).
const CONTEXT_POINTS = [4096, 8192, 32768, 65536, 131072];

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/measure-model-requirements.mjs <url-или-путь> [...ещё]');
  process.exit(1);
}

console.error('Инициализирую llama-бэкенд (getLlama(), без loadModel)...');
const llama = await getLlama();
console.error(`llama.gpu = ${llama.gpu}`);

for (const pathOrUrl of args) {
  console.error(`\nЧитаю метаданные: ${pathOrUrl}`);
  const info = await readGgufFileInfo(pathOrUrl);
  // РЕАЛЬНЫЙ llama-инстанс вторым аргументом — см. предупреждение в шапке файла.
  const insights = await GgufInsights.from(info, llama);
  const totalLayers = insights.totalLayers;

  const full = await insights.estimateModelResourceRequirementsV2({ gpuLayers: totalLayers });

  const contextVramBytes = {};
  for (const contextSize of CONTEXT_POINTS) {
    const r = await insights.estimateContextResourceRequirementsV2({
      contextSize,
      modelGpuLayers: totalLayers,
      sequences: 1,
    });
    contextVramBytes[contextSize] = r.gpuVram;
  }

  const fileName = pathOrUrl.split(/[\\/]/).pop();
  console.log(JSON.stringify({
    fileName,
    sizeBytes: insights.modelSize, // память под тензоры (GgufInsights.modelSize) — НЕ размер .gguf-файла на диске, тот обычно больше (метаданные/токенизатор)
    totalLayers,
    vramFullOffloadBytes: full.gpuVram,
    cpuRamFullOffloadBytes: full.cpuRam,
    contextVramBytes,
  }, null, 2));
}

await llama.dispose();
