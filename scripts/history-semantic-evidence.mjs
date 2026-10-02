// Сохранённые реальные списки кандидатов: генератор и FTS зафиксированы, меняется только реранкер.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {withStand} from './isolated-stand.mjs';
import {chainRerankPrompt,parseChainIndices} from './history-semantic-chain-policy.mjs';
import {evidencePrompt,evidenceSchema,parseEvidence} from './history-semantic-evidence-policy.mjs';
import {evidenceHeldout} from './fixtures/history-semantic-evidence.mjs';
import {deepCases} from './fixtures/history-semantic-deep.mjs';
import {compactPrompt,compactSchema,parseCompact} from './history-semantic-compact-policy.mjs';
import {conditionFilterPrompt} from './history-semantic-filter-policy.mjs';
import {francAll} from 'franc-min';
import {createRequire} from 'node:module';
assert.ok(['--compact','--filter','--language'].filter(flag=>process.argv.includes(flag)).length<=1,'Run one experimental variant at a time');
if(process.argv.includes('--policy-check')){
  const cs=[{snippet:'Суккуленты поливают после высыхания грунта.'}];
  const response=matches=>JSON.stringify({requirements:[],matches});
  const row={index:0,relevance:'answer',conditions:'not_requested',quote:'Суккуленты поливают'};
  assert.deepEqual(parseEvidence(response([row]),'полив',cs).indices,[0]);assert.deepEqual(parseEvidence(response([]),'полив',cs).indices,[]);
  assert.equal(parseEvidence(response([{...row,quote:'придуманная цитата'}]),'полив',cs).rejected[0].reasons[0],'quote-not-in-snippet');
  assert.deepEqual(parseEvidence(response([{...row,conditions:'unknown'}]),'полив',cs).indices,[]);
  assert.throws(()=>parseEvidence(response([row,row]),'полив',cs));assert.throws(()=>parseEvidence(response([{...row,index:1}]),'полив',cs));
  assert.throws(()=>parseEvidence(JSON.stringify({requirements:['Linux'],matches:[]}),'полив',cs));
  assert.deepEqual(parseEvidence(JSON.stringify({requirements:['без сети'],matches:[{...row,conditions:'not_requested'}]}),'перевод без сети',cs).indices,[]);
  assert.deepEqual(parseEvidence(response([{...row,quote:'заголовок'}]),'полив',[{title:'заголовок'}]).indices,[]);
  assert.deepEqual(parseCompact('{"relevant":[1,0],"excluded":[0]}',2).indices,[1]);
  assert.deepEqual(parseCompact('{"relevant":[],"excluded":[]}',0).indices,[]);
  for(const raw of ['{"relevant":[0,0],"excluded":[]}','{"relevant":[2],"excluded":[]}','{"relevant":[],"excluded":[-1]}','{"relevant":["0"],"excluded":[]}'])assert.throws(()=>parseCompact(raw,2));
  console.log('Evidence policy checks passed');process.exit(0);
}
const sourcePath='scripts/reports/history-semantic-chain.json',sourceText=fs.readFileSync(sourcePath,'utf8'),source=JSON.parse(sourceText);
// В прежнем отчёте сохранены списки и ключи, а формулировки вопросов живут в исходном корпусе.
const queries=new Map([...deepCases.map(t=>[t.key,t.query]),
  ['heldout-windows','нужна инструкция по установке сетевого клиента для Windows'],
  ['heldout-macos','установка сетевого клиента только в macOS'],
  ['heldout-french','найди французскую заметку об уменьшении износа литиевого аккумулятора при зарядке'],
  ['crowding','уличный гул гарнитура'],['lexical-refusal','ресурс аккумулятора Honda Civic']]);
const tests=source.runs.filter(r=>r.mode==='chain').map(r=>({...r,query:queries.get(r.key),candidates:r.evidence,group:'saved:'+r.group}));
for(let repeat=0;repeat<2;repeat++)for(const test of evidenceHeldout)tests.push({...test,repeat,group:'fresh',candidates:repeat?[...test.candidates].reverse():test.candidates});
assert.ok(tests.every(test=>typeof test.query==='string'&&test.query.length));
const compactOnly=process.argv.includes('--compact');
const languageOnly=process.argv.includes('--language');
if(languageOnly){
  const {pickLanguage,FRANC_TO_CODE}=createRequire(import.meta.url)('../dist-electron/shared/langDetect.js');
  for(let i=tests.length-1;i>=0;i--){
    const test=tests[i],requested=/английск/iu.test(test.query)?'en':/немецк/iu.test(test.query)?'de':/французск/iu.test(test.query)?'fr':null;
    // Это опыт только для трёх явных языков, а не готовый парсер произвольных пользовательских условий.
    if(!requested){tests.splice(i,1);continue;}
    const started=performance.now(),checks=test.candidates.map(c=>{
      const text=(c.snippet??'').replace(/\s+/g,' ').trim().slice(0,240),raw=francAll(text,{only:Object.keys(FRANC_TO_CODE),minLength:3}),picked=pickLanguage(raw,text);
      return {key:c.key,raw:raw[0]?.[0]??'und',picked,keep:(raw[0]?.[0]??'und')!=='und'&&picked.code===requested};
    });
    const kept=new Set(checks.filter(c=>c.keep).map(c=>c.key));test.candidates=test.candidates.filter(c=>kept.has(c.key));
    test.languageCheck={requested,checks,ms:performance.now()-started};
  }
}
const filterOnly=process.argv.includes('--filter'),filterSourcePath='scripts/reports/history-semantic-evidence.json';
const filterSourceText=filterOnly?fs.readFileSync(filterSourcePath,'utf8'):null;
if(filterOnly){
  const controls=JSON.parse(filterSourceText).runs.filter(r=>r.mode==='current-reranker');
  for(const test of tests){
    const control=controls.find(r=>r.key===test.key&&r.repeat===test.repeat);assert.ok(control&&!control.error,'Valid semantic control required');
    const candidates=test.candidates;test.candidates=control.chosen.map(key=>candidates.find(c=>c.key===key));assert.ok(test.candidates.every(Boolean));
    test.baseChosen=control.chosen;test.semanticMs=control.ms;
  }
}
const modes=languageOnly?['language']:filterOnly?['filter']:compactOnly?['compact']:['current-reranker','strict-json','evidence'],output=languageOnly?'scripts/reports/history-semantic-language-gate.json':filterOnly?'scripts/reports/history-semantic-filter.json':compactOnly?'scripts/reports/history-semantic-compact.json':'scripts/reports/history-semantic-evidence.json',summarize=process.argv.includes('--summarize');
const report=summarize?JSON.parse(fs.readFileSync(output,'utf8')):{measuredAt:new Date().toISOString(),model:'Qwen3.5 4B Q4_K_M',source:sourcePath,sourceSha256:createHash('sha256').update(sourceText).digest('hex'),savedPools:38,freshPools:14,runs:[]};
assert.equal(report.sourceSha256,createHash('sha256').update(sourceText).digest('hex'),'Replay source changed');
if(filterOnly){const sha256=createHash('sha256').update(filterSourceText).digest('hex');if(report.semanticControl)assert.equal(report.semanticControl.sha256,sha256,'Semantic control changed');else report.semanticControl={source:filterSourcePath,sha256};}
if(!summarize)await withStand(async ctx=>{
  const p=name=>JSON.stringify(path.resolve(`dist-electron/electron/${name}.js`)),modelPath=path.join(process.env.APPDATA??'','oblako-browser/models/gguf/Qwen3.5-4B-Q4_K_M.gguf');assert.ok(fs.existsSync(modelPath));
  report.loadMs=await ctx.main.evaluate(`(async()=>{
    const req=process.mainModule.require.bind(process.mainModule),service=req(${p('TranslationService')}),registry=req(${p('ModelRegistry')});
    registry.add({id:'evidence-qwen4b',label:'Qwen3.5 4B',filePath:${JSON.stringify(modelPath)},sizeBytes:${fs.statSync(modelPath).size},source:'legacy'});registry.setDefault('evidence-qwen4b');
    globalThis.__evidence={service,strict:${chainRerankPrompt.toString()},parseStrict:${parseChainIndices.toString()},prompt:${evidencePrompt.toString()},parse:${parseEvidence.toString()},schema:${JSON.stringify(evidenceSchema)},
      compactPrompt:${compactPrompt.toString()},compactSchema:${JSON.stringify(compactSchema)},parseCompact:${parseCompact.toString()},filterPrompt:${conditionFilterPrompt.toString()}};
    const t=performance.now();await service.ensureLoaded();return performance.now()-t;
  })()`,60000);
  console.log('Model loaded: '+Math.round(report.loadMs)+' ms');
  try{
    for(const test of tests){
      const result=await ctx.main.evaluate(`(async()=>{
        const s=globalThis.__evidence,test=${JSON.stringify(test)},cs=test.candidates,runs=[];
        for(const mode of (test.repeat%2?${JSON.stringify([...modes].reverse())}:${JSON.stringify(modes)})){
          const t=performance.now();let indices=[],raw=null,error=null,parsed=null;
          try{
            if(cs.length){
              if(mode==='current-reranker'||mode==='language')indices=(await s.service.rerankHistoryCandidates(test.query,cs)).slice(0,8);
              else{
                const indexSchema={type:'object',properties:{indices:{type:'array',items:{type:'integer'},...(mode==='filter'?{maxItems:8}:{})}}};
                raw=await s.service.runTabOrganizePrompt(mode==='filter'?s.filterPrompt(test.query,cs):mode==='compact'?s.compactPrompt(test.query,cs):mode==='evidence'?s.prompt(test.query,cs):s.strict(test.query,cs),{role:'search',schema:mode==='compact'?s.compactSchema:mode==='evidence'?s.schema:indexSchema,maxTokens:mode==='compact'?128:mode==='evidence'?256:96});
                if(!raw.ok||raw.stopReason==='maxTokens')throw Error(raw.error??'Truncated output');
                if(mode==='compact'){parsed=s.parseCompact(raw.out,cs.length);indices=parsed.indices;}else if(mode==='evidence'){parsed=s.parse(raw.out,test.query,cs);indices=parsed.indices;}else indices=s.parseStrict(raw.out,cs.length);
              }
            }
          }catch(e){error=String(e);}
          runs.push({key:test.key,query:test.query,group:test.group,repeat:test.repeat,mode,target:test.target,acceptable:test.acceptable,forbidden:test.forbidden,
            candidates:cs.map(c=>c.key),chosen:indices.map(i=>cs[i].key),ms:performance.now()-t,error,raw,parsed,
            ...(mode==='filter'?{baseChosen:test.baseChosen,semanticMs:test.semanticMs}: {}),...(mode==='language'?{languageCheck:test.languageCheck}: {})});
        }
        return runs;
      })()`,60000);
      report.runs.push(...result);fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
      console.log(test.key+' '+test.repeat+' | '+result.map(r=>r.mode+': '+(r.chosen.join(',')||'empty')+(r.error?' ERROR':'')).join(' | '));
    }
    report.perfLines=ctx.appLog.join('').split(/\r?\n/).filter(line=>line.includes('[perf] segment:'));
  }finally{await ctx.main.evaluate('globalThis.__evidence.service.unloadModel()',30000);}
},{main:true});
assert.equal(report.runs.length,tests.length*modes.length);
report.savedPools=tests.filter(t=>t.group.startsWith('saved:')).length;report.freshPools=tests.filter(t=>t.group==='fresh').length;
const stats=xs=>{xs.sort((a,b)=>a-b);return {medianMs:xs[Math.floor(xs.length/2)],p95Ms:xs[Math.ceil(xs.length*.95)-1]};};
const metrics=runs=>({runs:runs.length,positiveRuns:runs.filter(r=>r.target).length,selected:runs.filter(r=>r.target&&r.chosen.some(k=>r.acceptable.includes(k))).length,
  violationRuns:runs.filter(r=>r.chosen.some(k=>r.forbidden.includes(k))).length,negativeRuns:runs.filter(r=>!r.target).length,negativeFalseHits:runs.filter(r=>!r.target&&r.chosen.length).length,
  validNegativeEmpty:runs.filter(r=>!r.target&&!r.chosen.length&&!r.error).length,negativeErrors:runs.filter(r=>!r.target&&r.error).length,
  errors:runs.filter(r=>r.error).length,rejectedRows:runs.reduce((n,r)=>n+(r.parsed?.rejected.length??0),0),rerank:stats(runs.map(r=>r.ms)),
  ...(runs.every(r=>typeof r.semanticMs==='number')?{combinedRerank:stats(runs.map(r=>r.semanticMs+r.ms))}:{})});
report.summary={};for(const mode of modes){const runs=report.runs.filter(r=>r.mode===mode);report.summary[mode]={all:metrics(runs),saved:metrics(runs.filter(r=>r.group.startsWith('saved:'))),fresh:metrics(runs.filter(r=>r.group==='fresh'))};}
if(report.perfLines)report.perfLines=report.perfLines.filter(line=>line.includes('[perf] segment: inputTokens='));
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary));
