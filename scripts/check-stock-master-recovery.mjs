import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const sync=fs.readFileSync('src/web/features/settings/settings_sync.js','utf8');
const history=fs.readFileSync('src/web/views/views_history.js','utf8');
const html=fs.readFileSync('src/web/index.html','utf8');
const sw=fs.readFileSync('src/web/sw.js','utf8');
const program=sync.slice(0,sync.indexOf('// ── 종목코드 GSheet 자동 등록'));
assert.match(program,/async function recoverMissingStockMasterReadOnly/);
const samples=[
 {code:'005930',name:'삼성전자',type:'주식',sector:'반도체/IT',market:'KR'},
 {code:'F00001',name:'한화 LIFEPLUS TDF 2045',type:'TDF',sector:'인덱스',market:'OTHER'},
 {code:'0046Y0',name:'ACE 미국배당퀄리티',type:'ETF',sector:'배당',market:'KR'},
];
let pending=null,requestCount=0,writeCount=0,storageCount=0,generation=3;
const editable=[],stockCodes={};
const ctx={
  GSHEET_API_URL:'https://script.google.com/macros/s/test/exec',
  _gsPortfolioRestoreRequired:false,
  _gsBootPromise:null,
  EDITABLE_PRICES:editable,STOCK_CODE:stockCodes,EDITABLES_KEY:'editables',
  getGsheetConnectionGeneration:()=>generation,
  isGsheetConnectionCurrent:(url,g)=>g===generation&&url===ctx.GSHEET_API_URL,
  normalizeStockCode:code=>String(code||'').trim().toUpperCase(),
  _invalidateEPIndex:()=>{},
  lsSave:(k,value)=>{storageCount++;assert.equal(k,'editables');assert.equal(value,editable);},
  requestGsheetActionJson:async(action)=>{
    assert.equal(action,'getCodeList');
    requestCount++;
    if(pending) return pending;
    return {status:'ok',codes:samples};
  },
  requestGsheetFormJson:()=>{writeCount++;throw Error('READ ONLY MUST NEVER POST');},
  console
};
vm.createContext(ctx);
vm.runInContext(program,ctx);
const recover=()=>vm.runInContext('recoverMissingStockMasterReadOnly()',ctx);
let count=await recover();
assert.equal(count,3);
assert.equal(editable.length,3);
assert.equal(editable[0].sector,'반도체/IT');
assert.equal(editable[1].assetType,'TDF');
assert.equal(editable[2].market,'KR');
assert.equal(writeCount,0,'zero ledger writes');
assert.equal(storageCount,1,'one local cache repair');
assert.equal(requestCount,1);
assert.equal(await recover(),3,'idempotent recovery');
assert.equal(requestCount,1,'no second read once restored');

editable.length=0;
ctx._gsPortfolioRestoreRequired=true;
assert.equal(await recover(),0,'cross-connection authoritative restore blocks partial master');
assert.equal(editable.length,0);
assert.equal(requestCount,1);
ctx._gsPortfolioRestoreRequired=false;

let resolver;
pending=new Promise(resolve=>resolver=resolve);
const inFlight=recover();
generation=4;
resolver({status:'ok',codes:samples});
assert.equal(await inFlight,0,'stale connection responses must not change master');
assert.equal(editable.length,0);
assert.equal(requestCount,2);
pending=null;
count=await recover();
assert.equal(count,3,'retry can recover after stale response');
assert.equal(writeCount,0);

assert.match(history,/recoverMissingStockMasterReadOnly\(\)/);
assert.match(history,/buildStockMgmt\(\);\s*buildSectorMgmt\(\);/);
assert.match(history,/if \(typeof _mgmtRefresh === 'function'\) _mgmtRefresh\(\)/,
 'stock master recovery must recalculate derived portfolio rows');
assert.match(history,/fullRestoreDone = typeof _gsBootRestored !== 'undefined'/,
 'master read-only success must not imply full bootstrap success');
assert.match(history,/전체 설정 복원 미완료: 변경·저장하지 말고/,
 'read-only partial restore must warn that editing and saving are unsafe');

assert.match(html,/settings_sync\.js\?v=20261012-4/);

// A partial master preview must not allow any mutation via the management
// entry points. Both UI disable and handler-level guards are required.
const stock=fs.readFileSync('src/web/features/master/stock/mgmt_stock.js','utf8');
const sector=fs.readFileSync('src/web/features/master/sector/mgmt_sector.js','utf8');
for(const [source,names] of [
  [stock,['smDelete','smCsvImport','smMgmtAddNew','smMgmtConfirm','smSave']],
  [sector,['secSave','secDelete','secMgmtAddNew','secMgmtConfirm','secCsvImport']],
]) {
  for(const name of names){
    assert.match(source,new RegExp('(?:async )?function '+name+
      '\\([^\\n]*\\) \\{\\s*if \\(typeof preventUnsafeStockMasterEdit'),
      name+' must gate edits prior to changing state');
  }
  assert.match(source,/container\.querySelectorAll\('input,button'\)/,
    'management controls must be disabled while bootstrap pending');
}
assert.match(html,/mgmt_stock\.js\?v=20261012-3/);
assert.match(html,/mgmt_sector\.js\?v=20261012-2/);
assert.match(html,/sw\.js\?v=20261012-10/);
assert.match(sw,/portfolio-cache-20261012-11/);

assert.match(html,/views_history\.js\?v=20261012-2/);
assert.match(sw,/settings_sync\.js\?v=20261012-4/);
assert.match(sw,/views_history\.js\?v=20261012-2/);

const settings=fs.readFileSync('src/web/features/settings/settings.js','utf8');
assert.match(settings,/if \(_gsBootRestored && isGsheetConnectionCurrent\(bootTarget, bootGeneration\)/,
 'successful bootstrap must re-render disabled controls');
assert.match(html,/mgmt_stock\.js\?v=20261012-3/);
assert.match(html,/mgmt_sector\.js\?v=20261012-2/);
assert.match(html,/settings\.js\?v=20261012-2/);
assert.match(sw,/settings\.js\?v=20261012-2/);
const stockSource=fs.readFileSync('src/web/features/master/stock/mgmt_stock.js','utf8');
const sectorSource=fs.readFileSync('src/web/features/master/sector/mgmt_sector.js','utf8');
assert.ok(stockSource.includes('captureStockMasterEditSession()'));
assert.ok(stockSource.includes('isStockMasterEditSessionCurrent(editSession)'));
assert.ok(sectorSource.includes('isStockMasterEditSessionCurrent(editSession)'));
// Async cancellation must not claim the stock was saved.
assert.match(stockSource,/const saved = await smSave\(editIdx\)/);
assert.match(stockSource,/saved !== true/);
assert.match(stockSource,/async function smSave\(idx\)[\s\S]*return true;/);
const importStart=stockSource.indexOf('function smCsvImport(');
const importEnd=stockSource.indexOf('function smMgmtAddNew(',importStart);
const importCode=stockSource.slice(importStart,importEnd);
assert.ok(importCode.indexOf('await _smValidateListedCode') <
  importCode.indexOf('for (const item of validatedRows)'));
assert.ok(importCode.indexOf('validatedRows.push(') <
  importCode.indexOf('for (const item of validatedRows)'));
assert.ok(importCode.indexOf('EDITABLE_PRICES[existing].code = code') >
  importCode.indexOf('for (const item of validatedRows)'));
console.log('Read-only empty stock master rescue and safe stale generation test passed');
