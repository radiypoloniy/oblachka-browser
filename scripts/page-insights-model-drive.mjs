// Реальная локальная модель в отдельном контексте. CPU по умолчанию; GPU — только с явным флагом.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { getLlama, LlamaChatSession, resolveChatWrapper } from 'node-llama-cpp';
import { INSIGHTS_SCHEMA, selectInsightFragments, validateInsights } from '../shared/pageInsights.ts';
const modelPath = process.argv[2];
if (!modelPath) throw new Error('Передайте путь к GGUF');
const source = fs.readFileSync('electron/aipanel/InsightsGeneration.ts','utf8');
const template = source.match(/const prompt = (`[\s\S]*?`);/)[1];
const rulesText = Array.from({length:6},(_,i)=>`Условие ${i+1}: документы для проекта нужно скачать отдельно в течение ${i+10} дней. После этого срока доступ к архиву закрывается, поэтому сохраните необходимые файлы заранее. Экспорт содержит сообщения и настройки, но не загруженные пользователем файлы.`).join('\n');
const article = [
  'Современная библиотека постепенно становится общественным пространством. Посетители приходят не только за книгами: здесь проводят занятия, обсуждают местные проекты и работают вместе. Такое изменение требует пересмотра организации помещений и роли сотрудников.',
  'Традиционный большой читальный зал удобен для индивидуального чтения, но плохо подходит для разговоров. Поэтому архитекторам приходится разделять тихие зоны и помещения для совместной работы. Одного запрета на шум недостаточно, если акустика связывает все комнаты.',
  'Гибкая мебель помогает менять назначение зала без ремонта. Однако мобильность сама по себе не делает пространство удобным. Необходимы понятные маршруты, доступные розетки и места для хранения оборудования, иначе перестановки создают дополнительные препятствия.',
  'Цифровые услуги дополняют бумажный фонд, но не заменяют помощь библиотекаря. Человеку бывает трудно проверить источник или сформулировать запрос. Сотрудник помогает разобраться с информацией, а не просто выдаёт готовую ссылку.',
  'События привлекают новых посетителей, но число участников не описывает всю пользу библиотеки. Для оценки важны также регулярность посещений, доступность спокойной работы и возможность получить помощь. Опросы дополняют статистику выдачи книг.',
  'Участие жителей в планировании помогает обнаружить потребности, которые не видны из отчётов. Родителям нужны места для ожидания, подросткам — возможность работать группой, пожилым посетителям — удобная навигация. Универсальная планировка часто игнорирует эти различия.',
];
const text = process.argv.includes('--article') ? article.join('\n') : rulesText;
const title = process.argv.includes('--article') ? 'Библиотека как общественное пространство' : 'Правила экспорта документов';
const fragments = selectInsightFragments(text);
const prompt = Function('title','fragments','return '+template)(title,fragments);
const gpu = process.argv.includes('--gpu');
console.log('Загрузка модели',gpu ? 'GPU' : 'CPU',modelPath);
const llama = await getLlama(gpu ? {} : {gpu:false});
const model = await llama.loadModel({modelPath,...(gpu ? {} : {gpuLayers:0}),defaultContextFlashAttention:true,experimentalDefaultContextKvCacheKeyType:'Q8_0',experimentalDefaultContextKvCacheValueType:'Q8_0'});
const context = await model.createContext({contextSize:4096,threads:4});
const sequence = context.getSequence();
const chatWrapper = resolveChatWrapper({bosString:model.tokens.bosString,filename:model.filename,fileInfo:model.fileInfo,tokenizer:model.tokenizer,customWrapperSettings:{qwen:{variation:'3.5',thoughts:'discourage'}}});
try {
  const scenarios = [{label:'Новая схема',schema:INSIGHTS_SCHEMA,prompt}];
  if (process.argv.includes('--compare')) {
    const old = execFileSync('git',['show','e4cb818:electron/aipanel/InsightsGeneration.ts'],{encoding:'utf8'});
    const oldPrompt = Function('title','fragments','return '+old.match(/const prompt = (`[\s\S]*?`);/)[1])(title,fragments);
    const oldContract = execFileSync('git',['show','e4cb818:shared/pageInsights.ts'],{encoding:'utf8'});
    const oldSchema = Function('INSIGHTS_MAX','return '+oldContract.match(/export const INSIGHTS_SCHEMA: JsonSchema = (\{[\s\S]*?\});/)[1])(5);
    scenarios.unshift({label:'Прежняя схема',schema:oldSchema,prompt:oldPrompt});
  }
  for (const scenario of scenarios) {
    console.log('Начинаю:',scenario.label);
    const session = new LlamaChatSession({contextSequence:sequence,systemPrompt:'',chatWrapper});
    const grammar = await llama.createGrammarForJsonSchema(scenario.schema);
    const started = Date.now();
    const result = await session.promptWithMeta(scenario.prompt,{grammar,maxTokens:1200,temperature:0,signal:AbortSignal.timeout(180000)});
    console.log('Реальный ответ:',result.responseText,'stop:',result.stopReason,'ms:',Date.now()-started);
    const raw = JSON.parse(result.responseText.replace(/<think>[\s\S]*?<\/think>/gi,'').trim());
    if (scenario.label === 'Новая схема') {
      const cards = validateInsights(raw,fragments);
      console.log('Карточек:',cards.length);
      assert.ok(cards.length > 0 && cards.length <= 5);
    }
    await sequence.clearHistory();
  }
} finally {await context.dispose(); await model.dispose(); await llama.dispose();}
