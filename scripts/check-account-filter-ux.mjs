import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('src/web/views/views_portfolio.js','utf8');
const handlers=fs.readFileSync('src/web/app/event_delegation.js','utf8');
const css=fs.readFileSync('src/web/styles/ui-unified.css','utf8');
const stateStart=source.indexOf("let acctFilter = '전체';");
const stateEnd=source.indexOf('function _portfolioDataKey()');
const viewStart=source.indexOf('function renderAcctView(area)');
const viewEnd=source.indexOf('function setAcctFilter(f)');
assert.ok(stateStart>0 && stateEnd>stateStart && viewStart>stateEnd && viewEnd>viewStart);

const original=['전체','미래에셋','신한','우리 (연금)','LS','미래에셋 (IRP)','삼성','유진','우리','미래에셋 (ISA)','NH'];
const store=new Map();
const renders=[];
function createContext(){
  const master=[...original];
  const ctx=vm.createContext({
    ACCT_ORDER:master,
    lsGet:(k,d)=>store.has(k)?store.get(k):d,
    lsSave:(k,v)=>store.set(k,[...v]),
    lsRemove:k=>store.delete(k),
    document:{querySelector:()=>null},
    renderView:force=>renders.push(force),
    rows:[], EDITABLE_PRICES:[],
    window:{_tableData:new Map(),_tableExtra:new Map()},
    _portfolioDataKey:()=> 'empty',
    _portfolioAssetType:r=>r.type,
    _fBtnClass:active=>active?'f-btn active':'f-btn',
    _escapeHtml:v=>String(v).replaceAll('&','&amp;').replaceAll('"','&quot;')
      .replaceAll('<','&lt;').replaceAll('>','&gt;'),
    buildTableInner:()=>'<table></table>',
  });
  vm.runInContext(source.slice(stateStart,stateEnd)+source.slice(viewStart,viewEnd),ctx);
  return {ctx,master};
}
const first=createContext(),ctx=first.ctx;
const run=code=>vm.runInContext(code,ctx);
const toArray=value=>JSON.parse(JSON.stringify(value));
assert.deepEqual(toArray(run('_orderedAcctFilters()')),original.slice(1));
const area={innerHTML:''};
ctx.area=area;
run('renderAcctView(area)');
const html=area.innerHTML;
assert.match(html,/class="acct-filter-track"/);
assert.match(html,/<section class="acct-filter-group" aria-label="계좌 필터">/);
assert.match(html,/<section class="acct-type-filter-group" aria-label="자산 종류 필터">/);
assert.match(html,/class="acct-type-filter-options flex-wrap-gap4"/);
assert.ok(html.indexOf('acct-filter-track') < html.indexOf('acct-type-filter-group'),
  '계좌 필터는 종류 필터 위에 있어야 합니다.');
assert.match(html,/--acct-filter-count:11/);
assert.doesNotMatch(html,/class="flex-wrap-gap4">.*data-portfolio-action="acct-filter"/);
assert.equal((html.match(/data-portfolio-action="acct-filter"/g)||[]).length,11);
assert.ok(html.indexOf('data-value="전체"')<html.indexOf('data-value="미래에셋"'));
for(const [name,rows] of [['미래에셋',2],['미래에셋 (IRP)',3],['미래에셋 (ISA)',3],['우리 (연금)',2]]){
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const match=html.match(new RegExp('data-value="'+escaped+'"[^>]*>([\\s\\S]*?)<\\/button>'));
  assert.ok(match,'filter missing '+name);
  assert.equal((match[1].match(/<span/g)||[]).length,rows,'unexpected broker/type lines: '+name);
}
assert.match(css,/grid-template-columns:repeat\(var\(--acct-filter-count\),minmax\(30px,1fr\)\)/);
assert.match(css,/overflow-x:auto/);
assert.match(css,/\.acct-filter-track \.acct-filter-btn\.is-multiline\s*\{[^}]*height:44px;[^}]*min-height:44px;/);
assert.match(css,/\.acct-filter-track \.acct-filter-type\s*\{[^}]*line-height:1\.05;/);
assert.match(css,/#viewSwitcher\{margin-bottom:16px\}/);
for (const rule of [
  /\.acct-filter-controls\{[^}]*margin-bottom:16px/,
  /\.acct-filter-group,[\s\S]*?\.acct-type-filter-group\{[^}]*gap:8px/,
  /\.acct-type-filter-group\{[^}]*margin-top:14px/,
  /\.acct-filter-track \.acct-filter-btn,[\s\S]*?font-weight:500/,
  /\.acct-filter-track \.acct-filter-btn:is\(\.active,\[aria-pressed="true"\]\),[\s\S]*?font-weight:600/,
  /\.acct-type-filter-options \.f-btn\{[^}]*font-weight:500/,
]) assert.match(css,rule,'account spacing/weight contract failed: '+rule);
for(const cmd of ['acct-order-toggle','acct-order-up','acct-order-down','acct-order-reset'])
  assert.ok(handlers.includes("action === '"+cmd+"'"),'missing event '+cmd);

run('toggleAcctFilterOrderEditor()');
run('renderAcctView(area)');
assert.match(area.innerHTML,/data-portfolio-action="acct-order-up"/);
assert.match(area.innerHTML,/data-portfolio-action="acct-order-down"/);
run("moveAcctFilterOrder('미래에셋 (IRP)',-1)");
assert.equal(store.get('pf_ui_acct_filter_order_v1')[3],'미래에셋 (IRP)');
assert.deepEqual(first.master,original,'display preference must not mutate account master');
assert.equal(renders.at(-1),true,'change must bypass view data-cache');
const second=createContext();
assert.equal(vm.runInContext('_orderedAcctFilters()[3]',second.ctx),'미래에셋 (IRP)',
  'saved order must survive reload');
run("moveAcctFilterOrder('미래에셋 (IRP)',-1)");
run('resetAcctFilterOrder()');
assert.ok(!store.has('pf_ui_acct_filter_order_v1'));
assert.deepEqual(toArray(run('_orderedAcctFilters()')),original.slice(1));
first.master.push('새계좌');
assert.equal(toArray(run('_orderedAcctFilters()')).at(-1),'새계좌',
  'newly added master account must still be visible');
console.log('ACCOUNT_FILTER_UX_OK: 11 single-row accounts, broker line breaks, ordering, restore, no financial master write');
