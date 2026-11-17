// Real-browser rendering check, using synthetic data only. No service worker,
// external resources, authentication, API calls, or financial writes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const root=path.resolve('src/web');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const history=fs.readFileSync(path.join(root,'views/views_history_render.js'),'utf8');
const area={innerHTML:''};
const empty=()=>{};
const ctx=vm.createContext({
  _getHistBenchmarks:()=>['KOSPI','SPX'],HIST_BENCHMARK_TYPES:['KOSPI','SPX'],
  _escapeHtml:s=>String(s),formatBenchmarkLabel:s=>s,
  _initHistState:empty,_applyHistModeUI:empty,_getHistMode:()=> 'day',
  _renderHistBenchmarkButtons:empty,_restoreSuccessfulHistoryView:()=>false,
  _setHistoryStatus:empty,$el:()=>null
});
vm.runInContext(history,ctx);
ctx.renderHistoryView(area);
assert(area.innerHTML.includes('손익 그래프'));
const fixture=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')
.replace(/<link\b[^>]*>/gi,'')
.replace(/<div id="view-area" class="fade d4"><\/div>/,
 '<div id="view-area" class="fade d4" data-active-view="history">'+area.innerHTML+'</div>');
assert(fixture.includes('hist-view-title'));
const allStyles=[...html.matchAll(/<link rel="stylesheet" href="(styles\/[^"?]+)(?:\?[^"]*)?">/g)]
 .map(m=>[m[1],fs.readFileSync(path.join(root,m[1]),'utf8')]);
assert(allStyles.some(([f])=>f==='styles/ui-unified.css'));
function documentWithStyles(includeUnified){
 const css=allStyles.filter(([f])=>includeUnified||f!=='styles/ui-unified.css')
  .map(([,s])=>s).join('\n');
 return fixture.replace('</head>','<style>'+css+'</style></head>');
}
const cases=[];
for(const width of [1440,768,390,320]){
 for(const unified of [true,false]){
  cases.push({width,unified,html:documentWithStyles(unified)});
 }
}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portfolio-ui-browser-'));
try{
 const htmlPath=path.join(dir,'check.html');
 const runner='<!DOCTYPE html><meta charset="utf-8"><pre id="result">PENDING</pre><script>'+
 'const cases='+JSON.stringify(cases).replace(/</g,'\\u003c')+';'+
 'const results=[]; let done=0;'+
 'for(const c of cases){const f=document.createElement("iframe");f.style.cssText="width:"+c.width+"px;height:1100px;border:0";'+
 'f.onload=()=>{try{const d=f.contentDocument;const icons=[...d.querySelectorAll("svg.ui-brand-icon,svg.ui-label-icon,svg.hist-query-icon")];'+
 'const boxes=icons.map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}));'+
 'const cards=[...d.querySelectorAll(".sum-row .sc")].map(e=>e.getBoundingClientRect().height);'+
 'const header=d.querySelector(".hdr").getBoundingClientRect().height;const title=d.querySelector(".hist-view-title").getBoundingClientRect().height;'+
 'const ok=icons.length===9&&boxes.every(b=>b.w>=12&&b.w<=20&&b.h>=12&&b.h<=20)&&cards.length===6&&cards.every(h=>h>0&&h<=200)&&header<=120&&title<=60;'+
 'results.push({width:c.width,unified:c.unified,ok,boxes,maxCard:Math.max(...cards),header,title});'+
 '}catch(e){results.push({width:c.width,unified:c.unified,ok:false,error:String(e)});}'+
 'if(++done===cases.length)document.getElementById("result").textContent=JSON.stringify(results);};'+
 'f.srcdoc=c.html;document.body.appendChild(f);}</script>';
 fs.writeFileSync(htmlPath,runner);
 const candidates=[process.env.CHROME_BIN,'google-chrome','chromium','chromium-browser'].filter(Boolean);
 const bin=candidates.find(c=>spawnSync(c,['--version'],{encoding:'utf8'}).status===0);
 assert(bin,'CI requires a real Chromium browser; do not silently skip layout testing');
 const proc=spawnSync(bin,['--headless=new','--no-sandbox','--disable-gpu',
  '--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND',
  '--virtual-time-budget=6000','--dump-dom',pathToFileURL(htmlPath).href],
  {encoding:'utf8',timeout:45000,maxBuffer:16*1024*1024});
 assert.equal(proc.status,0,proc.error?.message||String(proc.stderr).slice(-1000));
 const match=proc.stdout.match(/<pre id="result">([^<]+)<\/pre>/);
 assert(match&&match[1]!=='PENDING','browser result missing (not a successful check)');
 const report=JSON.parse(match[1].replaceAll('&quot;','"').replaceAll('&amp;','&'));
 assert.equal(report.length,cases.length);
 assert(report.every(r=>r.ok),JSON.stringify(report.filter(r=>!r.ok)));
 console.log('UI_REAL_BROWSER_LAYOUT_PASS '+JSON.stringify(report.map(r=>({
   viewport:r.width,unifiedCss:r.unified,maxIcon:Math.max(...r.boxes.map(b=>Math.max(b.w,b.h))),
   maxCard:r.maxCard,header:r.header,title:r.title
 }))));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
