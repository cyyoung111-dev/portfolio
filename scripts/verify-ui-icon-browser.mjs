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
const acctSource=fs.readFileSync(path.join(root,'views/views_portfolio.js'),'utf8');
const acctArea={innerHTML:''};
const acctCtx=vm.createContext({
 ACCT_ORDER:['전체','미래에셋','신한','우리 (연금)','LS','미래에셋 (IRP)','삼성','유진','우리','미래에셋 (ISA)','NH'],
 lsGet:(_k,d)=>d,lsSave:()=>{},lsRemove:()=>{},document:{querySelector:()=>null},
 renderView:()=>{},rows:[],EDITABLE_PRICES:[],window:{_tableData:new Map(),_tableExtra:new Map()},
 _portfolioDataKey:()=> 'empty',_portfolioAssetType:r=>r.type,
 _fBtnClass:active=>active?'f-btn active':'f-btn',_escapeHtml:v=>String(v),buildTableInner:()=>'<table></table>',
 acctArea
});
vm.runInContext(acctSource.slice(acctSource.indexOf("let acctFilter = '전체';"),acctSource.indexOf('function _portfolioDataKey()'))+
 acctSource.slice(acctSource.indexOf('function renderAcctView(area)'),acctSource.indexOf('function setAcctFilter(f)'))+';renderAcctView(acctArea);',acctCtx);
assert.equal((acctArea.innerHTML.match(/data-portfolio-action="acct-filter"/g)||[]).length,11);
const planSource=fs.readFileSync(path.join(root,'views/views_plan_overview.js'),'utf8');
const itemSource=planSource.split('\n').find(l=>l.includes('const item = (label, value, sub'));
assert(itemSource);
const planMarkup=vm.runInNewContext(itemSource+";item('연간 예상 배당','2,810만','29개 종목');");

function readView(rel){return fs.readFileSync(path.join(root,rel),'utf8')}
function renderer(source,name){
 const begin=source.indexOf('function '+name+'(');
 const end=source.indexOf('\n}',begin);
 assert(begin>=0&&end>begin,'renderer missing '+name);
 return source.slice(begin,end+2);
}
function renderSample(source,name,globals={},extra=''){
 const dest={innerHTML:''};
 const context=vm.createContext({dest,_escapeHtml:v=>String(v??''),...globals});
 vm.runInContext(extra+'\n'+renderer(source,name)+'\n'+name+'(dest);',context);
 assert(dest.innerHTML.trim().length>0,name+' empty markup');
 return dest.innerHTML;
}
const sampleHolding={name:'합성 종목',type:'주식',sector:'테스트 섹터',code:'000001',evalAmt:3000,costAmt:2000,pnl:1000,qty:2,price:1500,cost:1000,pct:50,acct:'테스트 계좌'};
const sampleTrade={id:'test-1',name:sampleHolding.name,acct:sampleHolding.acct,code:sampleHolding.code,assetType:'주식',tradeType:'buy',date:'2026-11-17',qty:2,price:1000,memo:''};
const renderCommon={rows:[sampleHolding],rawTrades:[sampleTrade],ACCT_COLORS:{'테스트 계좌':'#789abc'},SECTOR_COLORS:{'테스트 섹터':'#789abc'},
 pColor:v=>v>=0?'var(--green)':'var(--red)',pSign:v=>v>=0?'+':'',fmt:String,fmtW:String,fmtDateDot:String,
 getEP:()=>({code:'000001',sector:'테스트 섹터'}),getEPType:()=> '주식',getAcctList:()=>['전체','테스트 계좌'],
 savedPrices:{'000001':1500},getCode:()=> '000001',renderTabSyncPanel:()=>'',_portfolioDataKey:()=> 'sample',
 GSHEET_API_URL:'',EDITABLE_PRICES:[],window:{},localStorage:{getItem:()=>null},$el:()=>null};
const tradeSource=readView('views/views_trades.js'),groupSource=readView('views/views_tradegroup.js'),managementSource=readView('views/views_history.js');
const wholeViewFixtures={
 acct:acctArea.innerHTML,
 sector:renderSample(acctSource,'renderSectorView',renderCommon),
 merge:renderSample(acctSource,'renderMergeView',{...renderCommon,_mergeListCache:{},mergeSortKey:'eval'}),
 trades:renderSample(tradeSource,'renderTradesView',{...renderCommon,_getFilteredTrades:()=>[sampleTrade],_tradeFilter:{name:'',acct:'',type:'all'},_tradeSort:{key:'date',dir:1},
  calcRealizedPnl:()=>({totalPnl:0,totalCost:0,pct:0}),_buildTradeDateRepairHTML:()=>'',_buildTradeRealizedContext:()=>({realizedByTrade:new Map(),currentAvgByKey:{}}),
  _tradeRepairDateIsValid:()=>true,_bindTradesViewEvents:empty,_updateTradeSelBar:empty},
  renderer(tradeSource,'_buildTradesSummaryHTML')+'\n'+renderer(tradeSource,'_buildTradesTableHTML')),
 tradegroup:renderSample(groupSource,'renderTradeGroupView',{...renderCommon,_tgFilter:{name:'',acct:''},_tgSearchKey:()=>'',_tgMatchesFilter:()=>true,
  _tgBuildGroup:()=>({qty:2,avgCost:1000,realizedPnl:0,buyCount:1,sellCount:0,accounts:[],trades:[sampleTrade]}),_bindTradeGroupViewEvents:empty}),
 history:area.innerHTML,
 // Asset/dividend/plan cards use their production role classes; the prior
 // test continues to measure those roles and the actual plan item template.
 asset:'<div class="asset-summary-grid"><div><div class="label-muted-68">시가</div><div class="asset-summary-value">12억</div></div></div><div class="asset-detail-grid"><div class="s2-rounded"><div class="lbl-62-muted-3">취득가</div><div class="fw-600">9억</div></div></div><button class="btn-amber-outline">수정</button>',
 div:'<div class="div-stat-card"><div class="div-stat-label">연간 예상</div><div class="div-stat-value">123,456</div><div class="div-stat-sub">확정 지급액</div></div><div class="div-month-filter"><button class="active">전체</button></div><table class="div-monthly-matrix"><thead><tr><th>월</th></tr></thead><tbody><tr><td>123</td></tr></tbody></table>',
 plan:'<div data-view-section="plan"><div class="plan-subtabs"><button class="plan-subtab is-active">현황</button></div><div class="retire-metric-grid">'+planMarkup+'</div><table class="retirement-cashflow-table"><thead><tr><th>연도</th></tr></thead><tbody><tr><td>123</td></tr></tbody></table></div>',
 stocks:renderSample(managementSource,'renderStocksView',{...renderCommon,BROKER_CODES:['UNCLASSIFIED'],BROKER_LABELS:{UNCLASSIFIED:'미지정'},buildAcctMgmt:empty,buildStockMgmt:empty,buildSectorMgmt:empty}),
 gsheet:renderSample(managementSource,'renderGsheetView',renderCommon)
};
const dialogFixtures={
 trade:vm.runInNewContext(renderer(readView('features/trade/editor/mgmt_trade.js'),'buildTradeEditOverlayHTML')+'\nbuildTradeEditOverlayHTML();'),
 bulk:vm.runInNewContext(renderer(readView('features/import/mgmt_bulk.js'),'buildBulkOverlayHTML')+'\nbuildBulkOverlayHTML();')
};
assert.equal(Object.keys(wholeViewFixtures).length,11);


const divStatusSource=readView('views/views_div_asset.js');
const divStart=divStatusSource.indexOf('  <!-- ── 배당 자동 연동 + 수동 갱신 ── -->');
const divEnd=divStatusSource.indexOf('  <!-- ── 수량 0 숨김',divStart);
assert(divStart>=0&&divEnd>divStart,'dividend panel not found');
const divStatusMarkup=vm.runInNewContext('\x60'+divStatusSource.slice(divStart,divEnd)+'\x60',{
 _dividendLinkState:{state:'idle',message:'자동 연동 대기 중'},GSHEET_API_URL:'fixture',
 _escapeHtml:String,_tabSyncText:()=>({text:'GAS 데이터 다시 받기: 최근 성공'}),
 dividendUpdatedLabel:'2026.11.18 09:30',publicKeySaved:true,publicKeyLabel:'공공데이터 키 저장됨'
});
const syncSource=readView('features/settings/settings_tabsync.js');
const syncMarkup=vm.runInNewContext(renderer(syncSource,'renderTabSyncPanel')+'\nrenderTabSyncPanel("asset");',{
 GSHEET_API_URL:'fixture',_tabSyncText:()=>({text:'재동기화: 최근 실패 · 테스트',color:'var(--red-lt)'})
});
const feedbackFunctions='let _dividendLinkState={};const GSHEET_API_URL="fixture";'+renderer(readView('features/dividend/mgmt_div.js'),'_setDividendLinkState')+
 renderer(readView('views/views_history_state.js'),'_setHistoryStatus')+';function _historySnapshotGapHtml(){return ""}';

const statusSource=fs.readFileSync(path.join(root,'features/settings/settings_fetch.js'),'utf8');
const statusSlice=statusSource.slice(statusSource.indexOf('function _priceLookupDuration('),statusSource.indexOf('function _pricePortfolioSummary('));
const setterSlice=statusSource.slice(statusSource.indexOf('function setStatusLabel('),statusSource.indexOf('function _resolvePriceDateLabel('));
assert(statusSlice.includes('function _priceLookupDetail(')&&setterSlice.includes('function setStatusLabel('));
const tabSource=fs.readFileSync(path.join(root,'views/views_system.js'),'utf8');
const tabDefs=tabSource.slice(tabSource.indexOf('const TAB_DEFAULTS = ['),tabSource.indexOf('// TAB_ORDER:'));
const tabBuilder=tabSource.slice(tabSource.indexOf('function buildTabBar()'),tabSource.indexOf('// ── 탭 순서 설정 패널'));
assert(tabDefs.includes("label:'계좌별'")&&tabBuilder.includes('vs.appendChild(btn)'));
const navFixture=tabDefs+";let TAB_ORDER=TAB_DEFAULTS.map(t=>({...t}));let currentView='acct';const switchView=v=>{currentView=v;buildTabBar()};const saveTabOrder=()=>{};"+tabBuilder+";buildTabBar();";
const toolbarFixtureScript='<script>const $el=id=>document.getElementById(id);const _escapeHtml=s=>String(s);'+statusSlice+setterSlice+navFixture+feedbackFunctions+'</'+'script>';
const cases=[];
for(const width of [1440,1366,1100,1024,768,390,320]){
 for(const unified of (width===1366||width===1100||width===1024?[true]:[true,false])){
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
  const headerGeometry=()=>[d.querySelector('.action-bar'),d.querySelector('.action-update-card'),label,label.querySelector('.price-status-primary'),d.querySelector('#view-area')].map(e=>{
    const r=e.getBoundingClientRect();return [r.y,r.height];
  });
  const closedHeader=headerGeometry();
  const stableHeader=()=>headerGeometry().slice(0,4).every((r,i)=>r.every((v,j)=>Math.abs(v-closedHeader[i][j])<=0.5))
    &&Math.abs(headerGeometry()[4][0]-closedHeader[4][0])<=0.5;
  if(button.disabled||detail.open||button.getAttribute('aria-expanded')!=='false')failures.push({size,role:'closed state'});
  // Desktop right controls stay fixed too; on stacked mobile the second row
  // naturally moves downward so it never overlaps the expanded diagnostics.
  const desktop=c.width>=1100;
  const limit=desktop?closed.length:4;
  if(!same(loading,closed,limit))failures.push({size,role:'loading to complete geometry',loading,closed});
  w._priceLookupDetail('toggle-summary');
  const opened=geometry();
  const openDetail=detail.getBoundingClientRect(), openCard=d.querySelector('.action-update-card').getBoundingClientRect(), openMenu=d.querySelector('.action-menu-stack').getBoundingClientRect();
  const command=button.getBoundingClientRect(), primary=label.querySelector('.price-status-primary').getBoundingClientRect();
  const side=c.width>=1360;
  const positionOk=side?(openDetail.left>=command.right-1&&Math.abs(openDetail.top-command.top)<=2&&openDetail.right<=openMenu.left+1&&openCard.right<=openMenu.left+1&&openDetail.width>=180):(openDetail.top>=primary.bottom-1&&openDetail.left>=openCard.left-1&&openDetail.right<=openCard.right+1);
  if(side&&!stableHeader())failures.push({size,role:'open summary changes card/header/body height',closed:closedHeader,opened:headerGeometry()});
  if(!positionOk)failures.push({size,role:'lookup responsive placement',viewport:c.width,detail:[openDetail.left,openDetail.top,openDetail.right,openDetail.bottom],command:[command.left,command.top,command.right],menu:[openMenu.left,openMenu.right]});
  if(!detail.open||button.getAttribute('aria-expanded')!=='true'||!same(closed,opened,limit))failures.push({size,role:'open geometry',closed,opened});
  w._priceLookupDetail('timings');
  const nested=geometry();
  const nestedBox=sel('price-lookup-detail').getBoundingClientRect(), headerBottom=d.querySelector('.action-bar').getBoundingClientRect().bottom;
  if(side) {
    const panel=detail.getBoundingClientRect();
    if(!stableHeader()||panel.bottom>headerBottom+1)failures.push({size,role:'desktop drilldown must not resize header',closed:closedHeader,nested:headerGeometry()});
    // Longer details can scroll within the panel rather than displacing the dashboard.
    detail.scrollTop=detail.scrollHeight;
    const last=sel('price-lookup-detail').querySelector('li:last-child')||sel('price-lookup-detail');
    if(last.getBoundingClientRect().bottom>detail.getBoundingClientRect().bottom+1)
      failures.push({size,role:'desktop drilldown last row not reachable'});
    detail.scrollTop=0;
  } else if(nestedBox.bottom>headerBottom+1)failures.push({size,role:'details stay in header flow',viewport:c.width,detailBottom:nestedBox.bottom,headerBottom});
  if(sel('price-lookup-detail').hidden||!same(closed,nested,limit))failures.push({size,role:'nested detail geometry'});
  w._priceLookupDetail('toggle-summary');
  const reclosed=geometry();
  if(side&&!stableHeader())failures.push({size,role:'close summary changes header height',closed:closedHeader,reclosed:headerGeometry()});
  if(detail.open||button.getAttribute('aria-expanded')!=='false'||!same(closed,reclosed,limit))failures.push({size,role:'close geometry'});
  w.setStatusLabel(w._priceStatusLayout('현재가 갱신 · 39개 · 화면만 반영','','저장 이력/Snapshot 미변경',lookup,'info'),'ok');
  if(!same(closed,geometry(),limit))failures.push({size,role:'price-only geometry'});
  if(side){
    const base=headerGeometry();
    w._priceLookupDetail('toggle-summary');
    const expanded=headerGeometry();
    if(!base.slice(0,4).every((r,i)=>r.every((v,j)=>Math.abs(v-expanded[i][j])<=0.5))||Math.abs(base[4][0]-expanded[4][0])>0.5)
      failures.push({size,role:'price-only summary changes header height',base,expanded});
    w._priceLookupDetail('toggle-summary');
  }
  const card=d.querySelector('.action-update-card').getBoundingClientRect();
  const menu=d.querySelector('.toolbar-btn-group').getBoundingClientRect();
  const nav=d.querySelector('#viewSwitcher').getBoundingClientRect();
  const navButtons=[...d.querySelectorAll('#viewSwitcher .vs-btn')];
  const first=navButtons[0]?.getBoundingClientRect();
  const managementEl=d.querySelector('.toolbar-btn-group');
  const navEl=d.querySelector('#viewSwitcher');
  const groups=[...managementEl.querySelectorAll('.toolbar-section')];
  const expectedGroups=[['btn-trigger-import','btn-export-data','btn-open-reset-dialog'],['fixed-btn-stocks','fixed-btn-gsheet','btn-open-tab-settings']];
  const groupIds=groups.map(g=>[...g.querySelectorAll('button')].map(b=>b.id));
  if(JSON.stringify(groupIds)!==JSON.stringify(expectedGroups))failures.push({size,role:'utility grouping',groupIds});
  if(!sel('btn-open-reset-dialog')?.classList.contains('toolbar-btn-danger'))failures.push({size,role:'reset danger treatment'});
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
  cases.push({size,dateWidth:closed[0][2],buttonWidth:closed[1][2],buttonHeight:closed[1][3],fixedDesktopToolbar:desktop,stableWideHeader:side?true:null,headerHeight:closedHeader[0][1],navBelowManagement:nav.top>=menu.bottom-1,rightAligned:desktop?rightAligned:null,tabCount:navButtons.length,geometry:!failures.some(f=>f.size===size)});
 }
 return {ok:failures.length===0,cases,failures};
}


/* Actual account markup from renderAcctView plus representative detail cards
   using the production plan overview item template and view class names. */
function auditCompactDetails(d,c,acctMarkup,planMarkup) {
 if(!c.unified)return {ok:true,cases:[]};
 const host=d.querySelector('#view-area'),prior=host.dataset.activeView,oldSize=d.documentElement.dataset.uiFontSize;
 const box=d.createElement('section');host.appendChild(box);
 const failures=[],cases=[],w=d.defaultView;
 const px=e=>parseFloat(w.getComputedStyle(e).fontSize);
 const check=(ok,info)=>{if(!ok)failures.push(info)};
 for(const size of [8,9,10,11,12]){
  d.documentElement.dataset.uiFontSize=String(size);
  host.dataset.activeView='acct';box.innerHTML=acctMarkup;
  const track=box.querySelector('.acct-filter-track'),buttons=[...track.querySelectorAll('.acct-filter-btn')];
  const rects=buttons.map(b=>b.getBoundingClientRect());
  check(buttons.length===11&&rects.every(b=>Math.abs(b.height-44)<=1&&Math.abs(b.y-rects[0].y)<=1),{size,role:'account height/row',heights:rects.map(b=>b.height)});
  for(const b of buttons){
   const r=b.getBoundingClientRect();
   check([...b.children].every(e=>{const z=e.getBoundingClientRect();return z.top>=r.top&&z.bottom<=r.bottom+1&&e.scrollWidth<=e.clientWidth+1}),{size,role:'account label fit',account:b.getAttribute('aria-label')});
  }
  const sample=[];
  for(const view of ['plan','asset','div']){
   host.dataset.activeView=view;
   box.innerHTML=view==='plan'?'<div data-view-section="plan"><h4 class="h3-card">투자계획</h4><div class="retire-metric-grid">'+planMarkup+'</div></div>':view==='asset'?'<h4 class="h3-card">부동산</h4><div class="asset-summary-grid"><div><div class="label-muted-68">시가</div><div class="asset-summary-value">12억</div></div></div><div class="asset-detail-grid"><div class="s2-rounded"><div class="lbl-62-muted-3">취득가</div><div class="fw-600">9억</div></div></div>':'<h4 class="h3-card">배당</h4><div class="div-stat-card"><div class="div-stat-label">연간 예상 배당</div><div class="div-stat-value">28,099,251</div><div class="div-stat-sub">확정 지급액</div></div>';
   const value=box.querySelector(view==='plan'?'.lbl-62-muted-3+div':view==='asset'?'.asset-summary-value':'.div-stat-value');
   const caption=box.querySelector(view==='plan'?'.caption-text':view==='asset'?'.label-muted-68':'.div-stat-sub');
   const heading=box.querySelector('.h3-card');
   const v=px(value),s=px(caption),h=px(heading),weight=Number(w.getComputedStyle(caption).fontWeight);
   check(v===size+2&&s===size&&h===size+2&&weight<=500,{size,role:'detail typography',view,value:v,caption:s,heading:h,weight});
   if(view==='asset')check(px(box.querySelector('.asset-detail-grid .fw-600'))===size+2,{size,role:'asset detail value'});
   sample.push({view,value:v,caption:s,heading:h,captionWeight:weight});
  }
  cases.push({size,accountHeight:rects[0]?.height,metrics:sample});
 }
 box.remove();host.dataset.activeView=prior;
 if(oldSize===undefined)delete d.documentElement.dataset.uiFontSize;else d.documentElement.dataset.uiFontSize=oldSize;
 return {ok:failures.length===0,cases,failures};
}


/* UI matrix: actual renderers for main views with isolated dummy dependencies,
   representative financial-detail cards and actual dynamic overlay builders. */
function auditViewMatrix(d,c,fixtures,dialogs) {
 if(!c.unified)return {ok:true,views:[],dialogs:[]};
 const host=d.querySelector('#view-area'),prior=host.dataset.activeView,oldSize=d.documentElement.dataset.uiFontSize;
 const f=d.createElement('section');f.style.minWidth='0';host.appendChild(f);
 const w=d.defaultView,style=e=>w.getComputedStyle(e),visible=e=>e.getClientRects().length>0;
 const errors=[],views=[],dialogResults=[];
 const closeTo=(a,b)=>Math.abs(a-b)<=.5;
 const assertFont=(e,size,role,view)=>{if(!e||!closeTo(parseFloat(style(e).fontSize),size))errors.push({view,role,expected:size,actual:e?style(e).fontSize:null})};
 const assertButton=(e,size,h,role,view)=>{if(!e){errors.push({view,role,missing:true});return}const b=style(e);if(!closeTo(parseFloat(b.fontSize),size)||!closeTo(parseFloat(b.minHeight),h)||!closeTo(parseFloat(b.borderRadius),8))errors.push({view,role,size,height:h,actual:[b.fontSize,b.minHeight,b.borderRadius]});};
 const sample={
  sector:['.sector-hdr h4','.sector-hdr .sval'],trades:['.trade-stat-value'],tradegroup:['.tg-name'],
  asset:['.asset-summary-value','.asset-detail-grid .fw-600'],div:['.div-stat-value'],
  plan:['.s2-rounded>.lbl-62-muted-3+div']
 };
 for(const [view,markup] of Object.entries(fixtures)){
  host.dataset.activeView=view;f.innerHTML=markup;
  if(view==='tradegroup')f.querySelector('.tg-detail').style.display='block';
  if(view==='stocks')f.querySelector('#acctMgmtNewWrap').style.display='block';
  const viewErrors=errors.length;
  for(const size of [8,9,10,11,12]){
   d.documentElement.dataset.uiFontSize=String(size);
   for(const sel of sample[view]||[])assertFont(f.querySelector(sel),size+2,sel,view);
   // All visible financial table header/cells follow caption/body; a nested
   // badge or secondary text may intentionally retain its own caption role.
   for(const e of f.querySelectorAll('table th,table td'))if(visible(e))assertFont(e,e.tagName==='TH'?size:size+2,e.tagName,view);
   for(const e of f.querySelectorAll('.h3-card,.h3-section,.section-title,.card-title,.tbl-head h3'))if(visible(e))assertFont(e,size+2,'section heading',view);
   if(view==='trades'){
    assertButton(f.querySelector('[data-trade-action="bulk"]'),size,36,'bulk entry',view);
    assertButton(f.querySelector('[data-trade-action="add-sell"]'),size,32,'sell',view);
    assertFont(f.querySelector('#tradeNameFilter'),size+2,'search input',view);
   }
   if(view==='tradegroup'){
    assertButton(f.querySelector('.btn-buy-sm'),size,32,'buy',view);
    assertButton(f.querySelector('.btn-sell-sm'),size,32,'sell',view);
   }
   if(view==='stocks')assertButton(f.querySelector('#btn-acct-add'),size,36,'account add',view);
   if(view==='gsheet')assertButton(f.querySelector('[data-status-action="automation-refresh"]'),size,36,'automation refresh',view);
  }
  views.push({view,ok:errors.length===viewErrors});
 }
 f.remove();host.dataset.activeView=prior;
 for(const [kind,markup] of Object.entries(dialogs)){
  const shell=d.createElement('div');d.body.appendChild(shell);shell.innerHTML=markup;
  const overlay=shell.firstElementChild;overlay.style.display='flex';
  const initialErrors=errors.length;
  for(const size of [8,9,10,11,12]){
   d.documentElement.dataset.uiFontSize=String(size);
   assertFont(overlay.querySelector('.h3-95'),size+2,'dialog title',kind);
   assertButton(overlay.querySelector('.btn-amber'),size,36,'primary',kind);
   assertButton(overlay.querySelector('.btn-ghost-muted'),size,32,'cancel',kind);
   const panel=overlay.firstElementChild.getBoundingClientRect();
   if(panel.left<-1||panel.right>c.width+1)errors.push({kind,role:'dialog viewport',size,panel:[panel.left,panel.right]});
   if(kind==='trade'){
    for(const el of overlay.querySelectorAll('.te-type-btn'))assertFont(el,size,'trade type',kind);
    for(const el of overlay.querySelectorAll('input:not([type="hidden"])'))if(visible(el))assertFont(el,size+2,'trade input',kind);
   }else for(const el of overlay.querySelectorAll('[data-bulk-action="tab"]'))assertFont(el,size,'bulk tab',kind);
  }
  dialogResults.push({kind,ok:errors.length===initialErrors});
  shell.remove();
 }
 if(oldSize===undefined)delete d.documentElement.dataset.uiFontSize;else d.documentElement.dataset.uiFontSize=oldSize;
 return {ok:errors.length===0,views,dialogs:dialogResults,errors:errors.slice(0,30),errorCount:errors.length};
}


function auditStatusTypography(d,c,divMarkup,syncMarkup,fixtures,dialogs) {
 if(!c.unified)return {ok:true,checks:0,errors:[]};
 const w=d.defaultView,host=d.querySelector('#view-area'),prior=host.dataset.activeView,oldSize=d.documentElement.dataset.uiFontSize;
 const f=d.createElement('section');f.style.minWidth='0';host.appendChild(f);
 const errors=[];let checks=0;
 const verify=(el,size,weight,role)=>{
  checks++;if(!el){errors.push({role,missing:true});return}
  const s=w.getComputedStyle(el);
  if(Math.abs(parseFloat(s.fontSize)-size)>.1||Number(s.fontWeight)!==weight)
   errors.push({role,size,weight,actual:[s.fontSize,s.fontWeight]});
 };
 for(const size of [8,9,10,11,12]){
  d.documentElement.dataset.uiFontSize=String(size);
  host.dataset.activeView='div';f.innerHTML=divMarkup;
  const status=f.querySelector('#dividendLinkStatus'),colors=[];
  for(const state of ['idle','syncing','ok','fail']){
   w._setDividendLinkState(state,'자동 연동 실패 · 공공데이터 조회 또는 GAS 저장 결과 미확인 · 마지막 정상 데이터를 표시합니다.');
   verify(status,size,500,'dividend '+state);
   colors.push(w.getComputedStyle(status).color);
   checks++;
   if(status.dataset.state!==state||status.textContent.length<35||f.querySelector('#divFetchBtn').disabled!==(state==='syncing'))
     errors.push({role:'dividend state',state});
  }
  if(new Set(colors).size!==4)errors.push({role:'state colors',colors});
  verify(f.querySelector('.ui-status-heading'),size,600,'dividend title');
  verify(f.querySelector('#sync-badge-div'),size,400,'dividend sync log');
  verify(f.querySelector('span[title^="현재 화면"]'),size,400,'dividend date log');
  verify(f.querySelector('.div-gas-link-badge'),size,500,'dividend badge');
  // All 11 view scopes share the same explicit status role. Actual sync markup
  // is used even when a particular tab has no sync panel in its normal layout.
  for(const view of Object.keys(fixtures)){
   host.dataset.activeView=view;f.innerHTML=syncMarkup;
   verify(f.querySelector('[id^="sync-badge-"]'),size,500,'sync '+view);
  }
  host.dataset.activeView='history';f.innerHTML='<div class="hist-status" id="fixture-history-status"></div>';
  const hist=f.firstElementChild;hist.id='histStatusMsg';
  for(const type of ['query_ready','loading','summary','error','no_api']){
   w._setHistoryStatus(hist,type,{message:'테스트 오류',step:1,total:2});
   verify(hist,size,500,'history '+type);
   const child=hist.querySelector('.hist-progress-copy span')||hist.querySelector('span');
   verify(child,size,500,'history message '+type);
  }
  host.dataset.activeView='gsheet';f.innerHTML=fixtures.gsheet;
  for(const id of ['automationStatusBody','gsheetTestResult','gsheetAccessTokenStatus','publicDataKeyStatus','krxAuthKeyStatus','krxSourceStatus','nhConfigStatus'])
   verify(f.querySelector('#'+id),size,500,id);
  host.dataset.activeView='stocks';f.innerHTML=fixtures.stocks;
  for(const id of ['acctMgmtMsg','smMgmtMsg','secMgmtMsg'])verify(f.querySelector('#'+id),size,500,id);
  for(const [kind,markup] of Object.entries(dialogs)){
   f.innerHTML=markup;
   verify(f.querySelector(kind==='trade'?'#te-error':'#bulkError'),size,500,kind+' error');
  }
  verify(d.querySelector('#price-updated-label'),size,500,'price status');
 }
 f.remove();host.dataset.activeView=prior;
 if(oldSize===undefined)delete d.documentElement.dataset.uiFontSize;else d.documentElement.dataset.uiFontSize=oldSize;
 return {ok:errors.length===0,checks,errors:errors.slice(0,24)};
}

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portfolio-ui-browser-'));
try{
 const htmlPath=path.join(dir,'check.html');
 const runner='<!DOCTYPE html><meta charset="utf-8"><pre id="result">PENDING</pre><script>'+
 'const cases='+JSON.stringify(cases).replace(/</g,'\\u003c')+';'+
 'const auditControlRoles='+auditControlRoles.toString()+';'+
 'const auditStableToolbar='+auditStableToolbar.toString()+';'+
 'const auditCompactDetails='+auditCompactDetails.toString()+';'+
 'const auditViewMatrix='+auditViewMatrix.toString()+';'+
 'const auditStatusTypography='+auditStatusTypography.toString()+';'+
 'const divStatusMarkup='+JSON.stringify(divStatusMarkup).replace(/</g,'\\u003c')+';const syncMarkup='+JSON.stringify(syncMarkup).replace(/</g,'\\u003c')+';'+
 'const wholeViewFixtures='+JSON.stringify(wholeViewFixtures).replace(/</g,'\\u003c')+';const dialogFixtures='+JSON.stringify(dialogFixtures).replace(/</g,'\\u003c')+';'+
 'const acctMarkup='+JSON.stringify(acctArea.innerHTML).replace(/</g,'\\u003c')+';const planMarkup='+JSON.stringify(planMarkup).replace(/</g,'\\u003c')+';'+
 'const results=[]; let done=0;'+
 'for(const c of cases){const f=document.createElement("iframe");f.style.cssText="width:"+c.width+"px;height:1100px;border:0";'+
 'f.onload=()=>{try{const d=f.contentDocument;const icons=[...d.querySelectorAll("svg.ui-brand-icon,svg.ui-label-icon,svg.hist-query-icon")];'+
 'const boxes=icons.map(e=>({w:e.getBoundingClientRect().width,h:e.getBoundingClientRect().height}));'+
 'const cards=[...d.querySelectorAll(".sum-row .sc")].map(e=>e.getBoundingClientRect().height);'+
 'const header=d.querySelector(".hdr").getBoundingClientRect().height;const title=d.querySelector(".hist-view-title").getBoundingClientRect().height;'+
 'const controls=auditControlRoles(d,c);'+
 'const toolbar=auditStableToolbar(d,c);'+
 'const detail=auditCompactDetails(d,c,acctMarkup,planMarkup);'+
 'const matrix=auditViewMatrix(d,c,wholeViewFixtures,dialogFixtures);'+
 'const feedback=auditStatusTypography(d,c,divStatusMarkup,syncMarkup,wholeViewFixtures,dialogFixtures);'+
 'const ok=feedback.ok&&matrix.ok&&detail.ok&&toolbar.ok&&controls.ok&&icons.length===9&&boxes.every(b=>b.w>=12&&b.w<=20&&b.h>=12&&b.h<=20)&&cards.length===6&&cards.every(h=>h>0&&h<=200)&&header<=120&&title<=60;'+
 'results.push({width:c.width,unified:c.unified,ok,boxes,maxCard:Math.max(...cards),header,title,controls,toolbar,detail,matrix,feedback});'+
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
   maxCard:r.maxCard,header:r.header,title:r.title,controls:r.controls.samples,toolbar:r.toolbar.cases,detail:r.detail.cases,viewMatrix:r.matrix.views,dialogMatrix:r.matrix.dialogs,statusChecks:r.feedback.checks
 }))));
}finally{fs.rmSync(dir,{recursive:true,force:true});}
