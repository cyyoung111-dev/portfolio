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

/* Measure actual production shell/history and representative controls that
   use the production view/dialog classes. The fixture contains no user data
   and deliberately does not call any event handler. */
function auditControlRoles(d,c) {
 if(!c.unified)return {ok:true,samples:[]};
 const host=d.querySelector('#view-area');
 const fixture=d.createElement('section');
 fixture.style.cssText='display:grid;grid-template-columns:minmax(0,1fr);gap:8px;min-width:0';
 fixture.innerHTML='<div class="plan-subtabs"><button class="plan-subtab is-active" aria-selected="true">투자계획</button><button class="plan-subtab">은퇴계획</button></div>'+
 '<div class="div-month-filter"><button class="active">전체</button><button>1월</button></div>'+
 '<div style="display:flex;flex-wrap:wrap;gap:4px"><button class="f-btn active">전체</button><button class="btn-purple-sm">저장</button><button class="btn-edit-sm">수정</button><button class="btn-del-sm">삭제</button><button class="btn-sm-purple">매수</button><button class="btn-buy-lg">매수 추가</button><button class="btn-sell-lg">매도 추가</button><button class="btn-amber-outline">편집</button><button class="btn-danger-lg">초기화</button></div>'+
 '<div class="col-filter-dropdown" style="position:relative;left:auto!important;right:auto!important;top:auto!important;transform:none;max-height:none"><input class="cfd-search" placeholder="검색"><label><input type="checkbox">국내주식</label><div class="cfd-actions"><button class="cfd-btn">전체 선택</button></div></div>';
 host.appendChild(fixture);
 const status=d.querySelector('#price-updated-label');
 status.innerHTML='<div class="price-status-content"><span class="price-status-primary">업데이트 완료</span><details class="price-lookup-summary" open><summary class="price-lookup-summary-head"><span class="price-lookup-summary-title">조회 상세</span></summary><div class="price-lookup-detail"><span class="price-lookup-detail-head">조회 결과</span><button class="price-status-chip">정상</button></div></details></div>';
 status.classList.add('has-price-details');
 const settings=d.querySelector('#tabSettingsOverlay');
 settings.style.display='flex';
 const editor=d.querySelector('#realEstateEditor');
 const sizes=[8,11,12],samples=[],failures=[];
 const g=e=>d.defaultView.getComputedStyle(e);
 for(const size of sizes){
  d.documentElement.setAttribute('data-ui-font-size',String(size));
  const command=d.querySelector('.plan-subtab');
  const controls=[...fixture.querySelectorAll('button'),...settings.querySelectorAll('.settings-tab,.settings-dialog__footer button')];
  const style=g(command),min=c.width<=768?40:36;
  for(const e of controls){
   const cs=g(e);
   if(Math.abs(parseFloat(cs.fontSize)-size)>.01||parseFloat(cs.borderRadius)!==8||parseFloat(cs.minHeight)<min||
      !cs.fontFamily.includes('Pretendard'))
     failures.push({role:e.className,size,font:cs.fontSize,radius:cs.borderRadius,min:cs.minHeight});
  }
  for(const e of [d.querySelector('#histRangeSelect'),d.querySelector('#histStartMonth'),fixture.querySelector('.cfd-search'),editor.querySelector('#re-name')]){
   const cs=g(e);
   if(Math.abs(parseFloat(cs.fontSize)-(size+2))>.01||parseFloat(cs.borderRadius)!==8||parseFloat(cs.minHeight)<min)
    failures.push({role:e.id||e.className,size,font:cs.fontSize,radius:cs.borderRadius,min:cs.minHeight});
  }
  for(const e of status.querySelectorAll('.price-status-primary,.price-lookup-summary-title,.price-lookup-detail,.price-status-chip')){
   const cs=g(e);
   if(Math.abs(parseFloat(cs.fontSize)-size)>.01)failures.push({role:e.className,size,font:cs.fontSize});
  }
  const active=[...fixture.querySelectorAll('.plan-subtab.is-active,.div-month-filter button.active,.f-btn.active')];
  if(!active.every(e=>g(e).backgroundColor===g(active[0]).backgroundColor&&g(e).color===g(active[0]).color))
    failures.push({role:'active tab/filter',size,colors:active.map(e=>[g(e).color,g(e).backgroundColor])});
  const dlg=settings.querySelector('.settings-dialog');
  if(dlg.getBoundingClientRect().width>c.width+1)failures.push({role:'settings width',size});
  samples.push({size,controls:controls.length,commandFont:style.fontSize,commandHeight:style.minHeight,fieldFont:g(d.querySelector('#histRangeSelect')).fontSize,lookupFont:g(status.querySelector('.price-lookup-detail')).fontSize});
 }
 return {ok:failures.length===0,samples,failures};
}

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portfolio-ui-browser-'));
try{
 const htmlPath=path.join(dir,'check.html');
 const runner='<!DOCTYPE html><meta charset="utf-8"><pre id="result">PENDING</pre><script>'+
 'const cases='+JSON.stringify(cases).replace(/</g,'\\u003c')+';'+
 'const auditControlRoles='+auditControlRoles.toString()+';'+
 'const results=[]; let done=0;'+
 'for(const c of cases){const f=document.createElement("iframe");f.style.cssText="width:"+c.width+"px;height:1100px;border:0";'+
 'f.onload=()=>{try{const d=f.contentDocument;const icons=[...d.querySelectorAll("svg.ui-brand-icon,svg.ui-label-icon,svg.hist-query-icon")];'+
 'const boxes=icons.map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}));'+
 'const cards=[...d.querySelectorAll(".sum-row .sc")].map(e=>e.getBoundingClientRect().height);'+
 'const header=d.querySelector(".hdr").getBoundingClientRect().height;const title=d.querySelector(".hist-view-title").getBoundingClientRect().height;'+
 'const controls=auditControlRoles(d,c);'+
 'const ok=controls.ok&&icons.length===9&&boxes.every(b=>b.w>=12&&b.w<=20&&b.h>=12&&b.h<=20)&&cards.length===6&&cards.every(h=>h>0&&h<=200)&&header<=120&&title<=60;'+
 'results.push({width:c.width,unified:c.unified,ok,boxes,maxCard:Math.max(...cards),header,title,controls});'+
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
   maxCard:r.maxCard,header:r.header,title:r.title,controls:r.controls.samples
 }))));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
