// Последний ограниченный этап разведки: без Electron, LLM и изменений рабочего детектора.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {francAll} from 'franc-min';
import {languageEdgeCases,languageQueryCases} from './fixtures/history-language-edge.mjs';
const {pickLanguage,FRANC_TO_CODE}=createRequire(import.meta.url)('../dist-electron/shared/langDetect.js');
const detect=text=>{const start=performance.now(),candidates=francAll(text,{only:Object.keys(FRANC_TO_CODE),minLength:3});return {raw:candidates[0]?.[0]??'und',picked:pickLanguage(candidates,text),ms:performance.now()-start};};
const rows=languageEdgeCases.map(test=>{
  const text=test.text.slice(0,9600),full=detect(text),querySnippet=detect((test.querySnippet??text).replace(/\s+/g,' ').trim().slice(0,240));
  // Три ограниченные пробы показывают несогласие сигналов, а не устанавливают новый порог уверенности.
  const offsets=[0,Math.max(0,Math.floor((text.length-240)/2)),Math.max(0,text.length-240)];
  const samples=[...new Set(offsets)].map(offset=>({offset,...detect(text.slice(offset,offset+240))}));
  return {key:test.key,kind:test.kind,expected:test.expected,declaredLang:test.declaredLang??null,textChars:text.length,full,querySnippet,samples,
    sampleDisagreement:new Set(samples.map(s=>s.raw==='und'?'unknown':s.picked.code)).size>1,
    fullMismatch:!!test.expected&&!test.expected.includes(full.picked.code),snippetMismatch:!!test.expected&&!test.expected.includes(querySnippet.picked.code)};
});
const queries=languageQueryCases.map(test=>({...test,detected:/английск/iu.test(test.query)?'en':/немецк/iu.test(test.query)?'de':/французск/iu.test(test.query)?'fr':null}));
const known=rows.filter(r=>r.expected),uncertain=rows.filter(r=>r.kind==='insufficient'),times=rows.map(r=>r.full.ms).sort((a,b)=>a-b);
const report={measuredAt:new Date().toISOString(),scope:'20 fixture documents, one offline pass, existing detector unchanged',rows,queries,summary:{documents:rows.length,knownLanguageDocuments:known.length,
  fullMismatches:known.filter(r=>r.fullMismatch).length,snippetMismatches:known.filter(r=>r.snippetMismatch).length,sampleDisagreements:rows.filter(r=>r.sampleDisagreement).length,
  insufficientGuessed:uncertain.filter(r=>r.full.raw!=='und').length,insufficientEnglishFallback:uncertain.filter(r=>r.full.raw==='und'&&r.full.picked.code==='en').length,
  queryFalseLanguageRequirements:queries.filter(r=>!r.expected&&r.detected).length,queryMissedRequirements:queries.filter(r=>r.expected&&!r.detected).length,
  fullTextMedianMs:times[Math.floor(times.length/2)],fullTextP95Ms:times[Math.ceil(times.length*.95)-1]}};
assert.equal(rows.length,20);assert.equal(queries.length,8);assert.ok(rows.every(r=>r.samples.length<=3));
assert.equal(rows.find(r=>r.key==='empty').full.raw,'und');
fs.writeFileSync('scripts/reports/history-language-edge.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report.summary));console.log(JSON.stringify(rows.filter(r=>r.fullMismatch||r.snippetMismatch||r.kind==='insufficient').map(({key,full,querySnippet,sampleDisagreement})=>({key,full:full.picked.code,raw:full.raw,snippet:querySnippet.picked.code,sampleDisagreement})),null,2));
