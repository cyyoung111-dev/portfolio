#!/usr/bin/env node
// Source-only design regression; zero GAS/Sheets network and production writes.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {composeGas9297NavCollectorTwoStagePreview}
 from './compose-gas9297-nav-collector-two-stage-preview.mjs';

const {parent,candidate,manifest}=composeGas9297NavCollectorTwoStagePreview();
assert.equal(manifest.mode,'SOURCE_PREVIEW_ONLY');
assert.equal(manifest.productionDeploymentApproved,false);
assert.equal(manifest.requiresExplicitVersionReleaseGate,true);
assert.equal(manifest.parentVersion,'9.296');
assert.equal(manifest.version,'9.297');
assert.equal(manifest.financialWrites,0);
assert.equal(manifest.gasProjectWrites,0);
// Historical GAS pin and manual import must not change for this staged release.
assert.equal(parent.includes("var ISSUE507_GATE_API_VERSION='9.296'"),true);
assert.equal(candidate.includes("var ISSUE507_GATE_API_VERSION='9.297'"),true);
assert.match(candidate,/return mode === 'import' \? handleImportFundNav\(dataJson, true\)/);
assert.ok(candidate.includes('collectorNavOnly === true ? {priceKeys: {}, snapshotKeys: {}}'));
const previous=parent.slice(parent.indexOf('function handleImportFundNav('),
 parent.indexOf('function _compactFundDailyResultForProperty('));
const current=candidate.slice(candidate.indexOf('function handleImportFundNav('),
 candidate.indexOf('function _compactFundDailyResultForProperty('));
assert.equal(current.replace('dataJson, collectorNavOnly','dataJson')
 .replace('_applyFundNavImport(ss, inspected, diagnostic, collectorNavOnly === true)',
 '_applyFundNavImport(ss, inspected, diagnostic)'),previous,
 'manual import path must be byte-for-byte identical after removing opt-in');
const kbCollector=readFileSync('scripts/collect-kb-fund-nav.mjs','utf8');
const hanwhaCollector=readFileSync('scripts/collect-hanwha-fund-nav.mjs','utf8');
for(const source of [kbCollector,hanwhaCollector]){
 assert.match(source,/previewFundNavImport/,'exact read-only NAV proof kept');
 assert.match(source,/getFundValuationStatus/,'derived valuation status kept');
 assert.match(source,/mode:'refresh'/,'dated repair preserved');
}
const start=candidate.indexOf('function _applyFundNavImport(');
const end=candidate.indexOf('function handleCollectKbFundNav(',start);
assert(start>0&&end>start);
const code=candidate.slice(start,end);
const rows=[['date','code','name','nav','sourceDate','units','eval','at','provider']];
const sheet={
 getLastRow(){return rows.length},
 getRange(){return {getValues:()=>rows.slice(1)}}
};
const ctx=vm.createContext({
 _issue507GateInside_:true, FUND_NAV_SHEET:'펀드기준가격',
 CONFIG:{SHEET_PH:'가격이력'},
 today:()=> '2026-11-17',
 _fundDateOffset:(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10),
 _normalizeDate:s=>String(s||'').slice(0,10),
 _fundSheetCapacity:()=>({totalCells:9000}),
 _readFundUnits:()=>[{code:'F00002',name:'KB',provider:'KB_VALUE_ST',units:1000,startDate:'2025-01-01'}],
 _fundDerivedState:()=>{throw Error('EXPENSIVE_DERIVED_READ_MUST_NOT_RUN');},
 _fundDailyValues:(cfg,code,nav,from,to)=>[{
  date:from,code,name:'KB',nav:nav.at(-1).nav,
  sourceDate:from,units:1000,evalAmt:2025,provider:'KB_VALUE_ST'
 }],
 _fundValueNeedsProcessing:()=>true,
 _runFundImportStage:(_d,_c,_s,_f,callback)=>callback(),
 _writeFundImportRows:(_ss,_sheet,updates,appends)=>{assert.equal(updates.length,0);
  for(const row of appends)rows.push(row);return {updatedRows:0,appendedRows:appends.length};},
 Date,Number,Object,Array,String
});
vm.runInContext(code,ctx);
const doc={getSheetByName:name=>name==='펀드기준가격'?sheet:null};
const inspected={code:'F00002',spec:{provider:'KB_VALUE_ST'},
 candidates:[{date:'2026-11-16',nav:2025.10,units:1000,name:'KB',evalAmt:2025}],
 updates:[],identical:[]};
const diagnostic={};
const saved=ctx._applyFundNavImport(doc,inspected,diagnostic,true);
assert.equal(saved.derivedDeferred,true);
assert.equal(saved.persisted.navWrite.appendedRows,1);
assert.equal(saved.persisted.priceHistoryWrite.appendedRows,0);
assert.equal(saved.persisted.snapshotWrite.appendedRows,0);
assert.equal(rows.length,2);
assert.equal(rows[1][4],'2026-11-16');
assert.equal(rows[1][8],'KB_VALUE_ST');
assert.equal(saved.processing.priceHistory.pending,1);
assert.equal(saved.processing.snapshots.pending,1);
// Without the guarded collector flag, the old synchronous path must still run.
assert.throws(()=>ctx._applyFundNavImport(doc,{...inspected,candidates:[],identical:[
 {date:'2026-11-16',existingNav:2025.10,uploadedNav:2025.10}]},{},false),
 /EXPENSIVE_DERIVED_READ_MUST_NOT_RUN/);
console.log('GAS9297_NAV_TWO_STAGE_SOURCE_ONLY_PASS exact NAV once, deferred repair, manual untouched; no GAS deployment or financial writes');
