// Реальный ответ локальной модели: отдельный контекст, CPU, без изменения профиля браузера.
import fs from 'node:fs';
import { availableParallelism } from 'node:os';
import assert from 'node:assert/strict';
import { getLlama, LlamaChatSession, resolveChatWrapper } from 'node-llama-cpp';
import { parseCompareAdvice } from '../shared/compareAdvice.ts';
const modelPath = process.argv[2];
if (!modelPath) throw new Error('Передайте путь к GGUF');
const products = ['Xiaomi 17 12/256 ГБ', 'REDMI Note 17 Pro 8/512 ГБ', 'REDMI 17 4G 8/256 ГБ'].map((title, i) => ({
  tabId: String(i), url: 'https://shop.test/'+i, title, category: 'Смартфоны', capturedAt: 1, method: 'page', note: '',
  facts: [{id:1,label:'Вариант по названию',value:title,quote:title},
    {id:2,label:'Цена на странице',value:[69193,44305,25825][i]+' RUB',quote:[69193,44305,25825][i]+' RUB'},
    {id:3,label:'Оценка покупателей',value:['4','5','4.9'][i],quote:['4','5','4.9'][i]},
    {id:4,label:'Количество оценок',value:['9','2','16'][i],quote:['9','2','16'][i]}],
}));
const source = fs.readFileSync('electron/compare/CompareEngine.ts','utf8');
const declarations = source.match(/const refs = ([\s\S]*?)\n  const prompt =/)[1];
const schema = Function('products', 'const refs = '+declarations+'\nreturn schema;')(products);
const prompt = Function('products','return '+source.match(/const prompt = (`[\s\S]*?`);/)[1])(products);
const llama = await getLlama({gpu:false});
const model = await llama.loadModel({modelPath,gpuLayers:0,defaultContextFlashAttention:true});
const context = await model.createContext({contextSize:4096,threads:Math.min(8,availableParallelism())});
try {
  const chatWrapper = resolveChatWrapper({bosString:model.tokens.bosString,filename:model.filename,fileInfo:model.fileInfo,tokenizer:model.tokenizer,customWrapperSettings:{qwen:{variation:'3.5',thoughts:'discourage'}}});
  const session = new LlamaChatSession({contextSequence:context.getSequence(),systemPrompt:'',chatWrapper});
  const grammar = await llama.createGrammarForJsonSchema(schema);
  console.log('Начинаю реальный разбор трёх вариантов на CPU');
  const started = Date.now();
  let chars = 0, reported = false, tokenStarted = false;
  console.log('Токенов на входе:',model.tokenize(prompt).length);
  const result = await session.promptWithMeta(prompt,{grammar,maxTokens:2400,temperature:0,signal:AbortSignal.timeout(240000),onToken:()=>{
    if (!tokenStarted) {console.log('Первый токен генерации через',Date.now()-started,'мс');tokenStarted=true;}
  },onTextChunk:chunk=>{
    chars += chunk.length;
    if (!reported) {console.log('Первый токен через',Date.now()-started,'мс');reported=true;}
  }});
  console.log('Получено символов:',chars);
  const raw = JSON.parse(result.responseText.replace(/<think>[\s\S]*?<\/think>/gi,'').trim());
  const advice = parseCompareAdvice(raw,products);
  assert.ok(advice.cards.length > 0 && advice.cards.length <= 3);
  console.log(JSON.stringify({ms:Date.now()-started,stop:result.stopReason,advice},null,2));
} finally {await context.dispose();await model.dispose();await llama.dispose();}
