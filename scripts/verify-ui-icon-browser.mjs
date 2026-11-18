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
const statusSource=fs.readFileSync(path.join(root,'features/settings/settings_fetch.js'),'utf8');
const statusSlice=statusSource.slice(statusSource.indexOf('function _priceLookupDuration('),statusSource.indexOf('function _pricePortfolioSummary('));
const setterSlice=statusSource.slice(statusSource.indexOf('function setStatusLabel('),statusSource.indexOf('function _resolvePriceDateLabel('));
assert(statusSlice.includes('function _priceLookupDetail(')&&setterSlice.includes('function setStatusLabel('));
const tabSource=fs.readFileSync(path.join(root,'views/views_system.js'),'utf8');
const tabDefs=tabSource.slice(tabSource.indexOf('const TAB_DEFAULTS = ['),tabSource.indexOf('// TAB_ORDER:'));
const tabBuilder=tabSource.slice(tabSource.indexOf('function buildTabBar()'),tabSource.indexOf('// ── 탭 순서 설정 패널'));
assert(tabDefs.includes("label:'계좌별'")&&tabBuilder.includes('vs.appendChild(btn)'));
const navFixture=tabDefs+";let TAB_ORDER=TAB_DEFAULTS.map(t=>({...t}));let currentView='acct';const switchView=v=>{currentView=v;buildTabBar()};const saveTabOrder=()=>{};"+tabBuilder+";buildTabBar();";
const toolbarFixtureScript='<script>const $el=id=>document.getElementById(id);const _escapeHtml=s=>String(s);'+statusSlice+setterSlice+navFixture+'</'+'script>';
const cases=[];
for(const width of [1440,1100,1024,768,390,320]){
 for(const unified of (width===1100||width===1024?[true]:[true,false])){
  cases.push({width,unified,html:documentWithStyles(unified).replace('</body>',toolbarFixtureScript+'</body>')});
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
  const style=g(command),min=32;
  const expectedHeight=e=>e.matches('.f-btn,.f-btn-sm,.plan-subtab,.div-month-filter button,.settings-tab')?30:e.matches('.btn-purple-sm,.btn-amber,.btn-apply')?36:32;
  for(const e of controls){
   const cs=g(e);
   if(Math.abs(parseFloat(cs.fontSize)-size)>.01||parseFloat(cs.borderRadius)!==8||parseFloat(cs.minHeight)!==expectedHeight(e)||
      (e.getBoundingClientRect().height>0&&Math.abs(e.getBoundingClientRect().height-expectedHeight(e))>1)||
      !cs.fontFamily.includes('Pretendard'))
     failures.push({role:e.className,size,font:cs.fontSize,radius:cs.borderRadius,min:cs.minHeight,actualHeight:e.getBoundingClientRect().height});
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
  for(const e of [d.querySelector('#histRangeSelect'),d.querySelector('#histStartMonth'),d.querySelector('#btn-history-query')]){
   const cs=g(e);if(parseFloat(cs.height)!==36||parseFloat(cs.minHeight)!==36)
    failures.push({role:e.id,size,height:cs.height,min:cs.minHeight});
  }
  const active=[...fixture.querySelectorAll('.plan-subtab.is-active,.div-month-filter button.active,.f-btn.active')];
  if(!active.every(e=>g(e).backgroundColor===g(active[0]).backgroundColor&&g(e).color===g(active[0]).color))
    failures.push({role:'active tab/filter',size,colors:active.map(e=>[g(e).color,g(e).backgroundColor])});
  const dlg=settings.querySelector('.settings-dialog');
  if(dlg.getBoundingClientRect().width>c.width+1)failures.push({role:'settings width',size});
  samples.push({size,controls:controls.length,commandFont:style.fontSize,filterHeight:style.minHeight,commandHeight:g(fixture.querySelector('.btn-edit-sm')).minHeight,primaryHeight:g(fixture.querySelector('.btn-purple-sm')).minHeight,fieldFont:g(d.querySelector('#histRangeSelect')).fontSize,lookupFont:g(status.querySelector('.price-lookup-detail')).fontSize});
 }
 return {ok:failures.length===0,samples,failures};
}


function auditStableToolbar(d,c) {
 if(!c.unified)return {ok:true,cases:[]};
 const w=d.defaultView,sel=id=>d.getElementById(id),button=sel('btn-price-lookup-toggle'),label=sel('price-updated-label');
 const overlay=sel('tabSettingsOverlay');overlay.style.display='none';
 const date=sel('quickDateInput');date.value='2026-11-18';
 const geometry=()=>[date,sel('quickFetchBtn'),sel('quickPriceBtn'),button,...d.querySelectorAll('.toolbar-btn-group .toolbar-btn'),...d.querySelectorAll('#viewSwitcher .vs-btn')].map(e=>{
  const b=e.getBoundingClientRect();return [b.x,b.y,b.width,b.height];
 });
 const same=(a,b,limit)=>a.slice(0,limit).every((r,i)=>r.every((v,j)=>Math.abs(v-b[i][j])<=1));
 const cases=[],failures=[];
 for(const size of [8,11,12]){
  d.documentElement.dataset.uiFontSize=String(size);
  w._lastPriceLookup={tossResultCount:37,krxResultCount:0,recentHistoryFallbackCount:2,tossStatus:'SUCCESS',serverElapsedMs:71900,clientRoundTripMs:76200,recentHistoryFallbackItems:[{name:'합성 테스트 종목',code:'F00001',priceDate:'2026-11-17'}]};
  const lookup=w._priceLookupSummary();
  w.setStatusLabel('조회 중...','loading');
  if(!button.disabled||button.getAttribute('aria-expanded')!=='false')failures.push({size,role:'loading button'});
  const loading=geometry();
  const markup=w._priceStatusLayout('업데이트 완료 · 39/39개','거래 338건 · 보유 61건 · 미조회 0개','',lookup);
  w.setStatusLabel(markup,'ok');
  const closed=geometry(),detail=label.querySelector('details');
  if(button.disabled||detail.open||button.getAttribute('aria-expanded')!=='false')failures.push({size,role:'closed state'});
  // Desktop right controls stay fixed too; on stacked mobile the second row
  // naturally moves downward so it never overlaps the expanded diagnostics.
  const desktop=c.width>=1100;
  const limit=desktop?closed.length:4;
  if(!same(loading,closed,limit))failures.push({size,role:'loading to complete geometry',loading,closed});
  w._priceLookupDetail('toggle-summary');
  const opened=geometry();
  if(!detail.open||button.getAttribute('aria-expanded')!=='true'||!same(closed,opened,limit))failures.push({size,role:'open geometry',closed,opened});
  w._priceLookupDetail('timings');
  const nested=geometry();
  if(sel('price-lookup-detail').hidden||!same(closed,nested,limit))failures.push({size,role:'nested detail geometry'});
  w._priceLookupDetail('toggle-summary');
  const reclosed=geometry();
  if(detail.open||button.getAttribute('aria-expanded')!=='false'||!same(closed,reclosed,limit))failures.push({size,role:'close geometry'});
  w.setStatusLabel(w._priceStatusLayout('현재가 갱신 · 39개 · 화면만 반영','','저장 이력/Snapshot 미변경',lookup,'info'),'ok');
  if(!same(closed,geometry(),limit))failures.push({size,role:'price-only geometry'});
  const card=d.querySelector('.action-update-card').getBoundingClientRect();
  const menu=d.querySelector('.toolbar-btn-group').getBoundingClientRect();
  const nav=d.querySelector('#viewSwitcher').getBoundingClientRect();
  const navButtons=[...d.querySelectorAll('#viewSwitcher .vs-btn')];
  const first=navButtons[0]?.getBoundingClientRect();
  const managementEl=d.querySelector('.toolbar-btn-group');
  const navEl=d.querySelector('#viewSwitcher');
  const lastSection=managementEl.querySelector('.toolbar-section-settings').getBoundingClientRect();
  const lastTab=navButtons.at(-1)?.getBoundingClientRect();
  const menuFits=managementEl.scrollWidth<=managementEl.clientWidth+1;
  const navFits=navEl.scrollWidth<=navEl.clientWidth+1;
  // Check visible controls, not just two equally sized invisible containers.
  // At the desktop width boundary overflow must still be reachable by scroll.
  const rightAligned=Math.abs(menu.right-nav.right)<=1&&
    (!menuFits||Math.abs(lastSection.right-menu.right)<=1)&&
    (!navFits||Math.abs(lastTab.right-nav.right)<=1);
  if(navButtons.length!==9||!first||!navButtons[0].classList.contains('active')||
     nav.top<menu.bottom-1||
     (desktop&&(Math.min(menu.left,nav.left)<card.right-1||Math.abs(menu.top-card.top)>1||!rightAligned))||
     (!desktop&&(Math.abs(nav.left-menu.left)>1||menu.top<card.bottom-1))||
     nav.right>c.width+1||menu.right>c.width+1)
    failures.push({size,role:'menu stack geometry',desktop,card:[card.left,card.top,card.right,card.bottom],menu:[menu.left,menu.top,menu.right,menu.bottom],nav:[nav.left,nav.top,nav.right,nav.bottom],tabCount:navButtons.length,rightAligned,menuFits,navFits,lastSectionRight:lastSection.right,lastTabRight:lastTab?.right});
  const statusWidth=label.getBoundingClientRect().width;
  if(statusWidth<card.width-20)failures.push({size,role:'status uses card width',statusWidth,cardWidth:card.width});
  if(closed[0][2]!==126||closed.slice(1,4).some(b=>b[2]!==58||b[3]!==44)||closed[0][3]!==44||card.right>c.width+1)failures.push({size,role:'command dimensions',closed,cardRight:card.right});
  cases.push({size,dateWidth:closed[0][2],buttonWidth:closed[1][2],buttonHeight:closed[1][3],fixedDesktopToolbar:desktop,navBelowManagement:nav.top>=menu.bottom-1,rightAligned:desktop?rightAligned:null,tabCount:navButtons.length,geometry:!failures.some(f=>f.size===size)});
 }
 return {ok:failures.length===0,cases,failures};
}

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portfolio-ui-browser-'));
try{
 const htmlPath=path.join(dir,'check.html');
 const runner='<!DOCTYPE html><meta charset="utf-8"><pre id="result">PENDING</pre><script>'+
 'const cases='+JSON.stringify(cases).replace(/</g,'\\u003c')+';'+
 'const auditControlRoles='+auditControlRoles.toString()+';'+
 'const auditStableToolbar='+auditStableToolbar.toString()+';'+
 'const results=[]; let done=0;'+
 'for(const c of cases){const f=document.createElement("iframe");f.style.cssText="width:"+c.width+"px;height:1100px;border:0";'+
 'f.onload=()=>{try{const d=f.contentDocument;const icons=[...d.querySelectorAll("svg.ui-brand-icon,svg.ui-label-icon,svg.hist-query-icon")];'+
 'const boxes=icons.map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}));'+
 'const cards=[...d.querySelectorAll(".sum-row .sc")].map(e=>e.getBoundingClientRect().height);'+
 'const header=d.querySelector(".hdr").getBoundingClientRect().height;const title=d.querySelector(".hist-view-title").getBoundingClientRect().height;'+
 'const controls=auditControlRoles(d,c);'+
 'const toolbar=auditStableToolbar(d,c);'+
 'const ok=toolbar.ok&&controls.ok&&icons.length===9&&boxes.every(b=>b.w>=12&&b.w<=20&&b.h>=12&&b.h<=20)&&cards.length===6&&cards.every(h=>h>0&&h<=200)&&header<=120&&title<=60;'+
 'results.push({width:c.width,unified:c.unified,ok,boxes,maxCard:Math.max(...cards),header,title,controls,toolbar});'+
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
   maxCard:r.maxCard,header:r.header,title:r.title,controls:r.controls.samples,toolbar:r.toolbar.cases
 }))));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
