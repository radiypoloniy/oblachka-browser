// Никакого жёсткого фильтра в продукте: проверяем существующий детектор на текстах стенда.
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {francAll} from 'franc-min';
import {deepPages} from './fixtures/history-semantic-deep.mjs';
import {evidenceHeldout} from './fixtures/history-semantic-evidence.mjs';
const req=createRequire(import.meta.url),{pickLanguage,FRANC_TO_CODE}=req('../dist-electron/shared/langDetect.js');
const rows=[],measure=(key,kind,text,expected=null)=>{
  const started=performance.now(),candidates=francAll(text,{only:Object.keys(FRANC_TO_CODE),minLength:3}),picked=pickLanguage(candidates,text);
  rows.push({key,kind,textChars:text.length,expected,raw:candidates[0]?.[0]??'und',picked,ms:performance.now()-started});
};
for(const page of deepPages)measure(page.key,'stored-text',page.text.slice(0,12000),page.key==='english-short'?'en':page.key==='russian-short'?'ru':null);
const seen=new Set();for(const test of evidenceHeldout)for(const page of test.candidates)if(!seen.has(page.key)){
  seen.add(page.key);measure('fresh-'+page.key,'snippet',page.snippet,{german:'de',english:'en',russian:'ru'}[page.key]??null);
}
const chain=JSON.parse(fs.readFileSync('scripts/reports/history-semantic-chain.json','utf8'));
for(const run of chain.runs.filter(r=>r.mode==='chain'&&r.repeat===0&&['language','heldout-french'].includes(r.key)))for(const page of run.evidence)measure(run.key+':'+page.key,'retrieval-snippet',page.snippet??'');
measure('empty','unknown','');measure('numeric-only','unknown','12345');
const values=rows.map(r=>r.ms).sort((a,b)=>a-b);
const report={measuredAt:new Date().toISOString(),detector:'Existing franc-min + shared/langDetect',rows,summary:{samples:rows.length,marked:rows.filter(r=>r.expected).length,
  markedCorrect:rows.filter(r=>r.expected&&r.expected===r.picked.code).length,medianMs:values[Math.floor(values.length/2)],p95Ms:values[Math.ceil(values.length*.95)-1]}};
fs.writeFileSync('scripts/reports/history-semantic-language-probe.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report.summary));
console.log(JSON.stringify(rows.filter(r=>r.expected||r.key==='english'||r.kind==='unknown'||r.key.includes(':english')).map(({key,kind,raw,picked,ms})=>({key,kind,raw,picked,ms})),null,2));
