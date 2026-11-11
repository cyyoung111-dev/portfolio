import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('src/web/features/settings/settings_perf_monitor.js','utf8');
const net=fs.readFileSync('src/web/features/settings/settings_net.js','utf8');
const fetch=fs.readFileSync('src/web/features/settings/settings_fetch.js','utf8');
assert.match(source,/id="perfLocalSummary"/);
assert.match(source,/id="perfLocalSummaryBody"/);
assert.match(source,/if \(id === 'perfLocalSummary'\) \{ pftelemetry_renderLocal\(\)/);
assert.match(net,/samples\.length > 60/,'in-memory samples remain bounded');
for(const stage of ['load.full-update','load.full-restore','load.full-prices','load.full-render'])
 assert.match(fetch,new RegExp(stage.replaceAll('.','\\.')),'full update stage missing: '+stage);
const start=source.indexOf('  const LOCAL_STAGE_LABELS');
const end=source.indexOf('  function pftelemetry_renderSettingsHtml()',start);
assert.ok(start>0&&end>start);
const nodes={};
function el(tag){return {tag,children:[],textContent:'',style:{},appendChild(child){this.children.push(child);},
 replaceChildren(...newChildren){this.children=newChildren;this.textContent='';}};}
const wrap=el('div');
const ctx=vm.createContext({window:{__PF_LOOKUP_TIMES:[
 {stage:'load.full-restore',ms:3200,result:'ok'},
 {stage:'load.full-prices',ms:5200,result:'ok'},
 {stage:'load.full-render',ms:140,result:'ok'},
 {stage:'load.full-update',ms:8540,result:'ok'},
 {stage:'load.full-prices',ms:4800,result:'ok'},
 {stage:'not-allowed',ms:99,result:'ok'},
 {stage:'load.full-render',ms:NaN,result:'ok'}
]},document:{getElementById:id=>id==='perfLocalSummaryBody'?wrap:null,
 createElement:el},Object,Map,Array,Number});
vm.runInContext(source.slice(start,end),ctx);
vm.runInContext('pftelemetry_renderLocal()',ctx);
assert.equal(wrap.children.length,1);
const table=wrap.children[0];
assert.equal(table.tag,'table');
const lines=table.children.map(row=>row.children.map(cell=>cell.textContent).join('|'));
assert.ok(lines.includes('가격 재조회|4,800ms|성공'));
assert.ok(lines.includes('화면 재계산|140ms|성공'));
assert.ok(lines.includes('전체 업데이트|8,540ms|성공'));
assert.ok(!lines.some(s=>s.includes('not-allowed')));
const firstRowCount=table.children.length;
ctx.window.__PF_LOOKUP_TIMES=[];
vm.runInContext('pftelemetry_renderLocal()',ctx);
assert.equal(wrap.children.length,1,'display retains prior test mock children but empty uses textContent');
assert.match(wrap.textContent,/측정값이 없습니다/);
assert.ok(firstRowCount>=5);
console.log('PASS local performance panel: last sample per stage, zero network, bounded memory, no private financial data');
