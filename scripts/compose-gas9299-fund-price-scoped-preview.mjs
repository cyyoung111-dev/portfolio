// Source-only follow-up, not a deployment candidate authorized by this file.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {composeGas9298NhFinancialIncomePreview} from './compose-gas9298-nh-financial-income-preview.mjs';
const PIN='0674f15661314131e4bd16ea4c161d03227839bf';
const blob=s=>{const b=Buffer.from(s,'utf8');return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');};
function once(s,a,b,label){assert.equal(s.split(a).length,2,'GAS9299_FUND_PRICE_DRIFT_'+label);return s.replace(a,b);}
export function composeGas9299FundPriceScopedPreview(){
 const parent=composeGas9298NhFinancialIncomePreview().candidate;
 assert.equal(blob(parent),PIN,'GAS9299_PARENT_UNREVIEWED');
 const start=parent.indexOf('function _refreshFundValuations('),end=parent.indexOf('\n}',start)+2;
 assert(start>=0&&end>start);
 let fn=parent.slice(start,end);
 fn=once(fn,"  var append = [];\n  var pricesChanged = false;",[
  '  // Daily CLOSE only: rebase the price representative rows UNDER the existing lock.',
  '  // The earlier scan was for planning, not authority to overwrite a newer row.',
  '  var scopedPriceWrite = !!maxSnapshotWrites;',
  '  var priceUpdates = [];',
  '  if (scopedPriceWrite) {',
  '    ph = ss.getSheetByName(CONFIG.SHEET_PH);',
  '    prices = ph && ph.getLastRow() > 1 ? ph.getRange(2, 1, ph.getLastRow() - 1, 6).getValues() : [];',
  '    priceKeys = {};',
  '    prices.forEach(function(row) {',
  '      var code = _fundConfiguredCodeForPriceRow(row, configs);',
  '      if (!code) return;',
  "      var key = _normalizeDate(row[0]) + '|' + code;",
  '      if (_preferFundRepresentativeRow(priceKeys[key], row, 5, 3, null)) priceKeys[key] = row;',
  '    });',
  '  }',
  '  var append = [];',
  '  var pricesChanged = false;'
 ].join('\n'),'REBASE');
 fn=once(fn,'        existing[2] = value.name;',[
  '        if (scopedPriceWrite) {',
  '          var index = prices.indexOf(existing);',
  "          if (index < 0 || priceUpdates.some(function(item) { return item.index === index; })) throw new Error('FUND_PRICE_TARGET_UNVERIFIED');",
  '          priceUpdates.push({index:index,row:existing});',
  '        }',
  '        existing[2] = value.name;'
 ].join('\n'),'TRACK');
 fn=once(fn,"      _setCodeColumnText(ph, 2); prices = _normalizeCodeRows(prices, 1); ph.getRange(2, 1, prices.length, 6).setValues(prices);\n      _verifyWrittenRange(ph, 2, 1, prices, '펀드 가격이력 쓰기 후 검증 실패');",[
  '      if (scopedPriceWrite) {',
  '        // Keep the existing backup lifecycle. Only write/verify changed rows.',
  '        priceUpdates.sort(function(a,b) { return a.index-b.index; });',
  '        for (var pos=0; pos<priceUpdates.length;) {',
  '          var first=priceUpdates[pos].index, batch=[priceUpdates[pos].row]; pos++;',
  '          while (pos<priceUpdates.length && priceUpdates[pos].index===first+batch.length) {',
  '            batch.push(priceUpdates[pos].row); pos++;',
  '          }',
  '          batch=_normalizeCodeRows(batch,1);',
  "          ph.getRange(first+2,2,batch.length,1).setNumberFormat('@');",
  '          ph.getRange(first+2,1,batch.length,6).setValues(batch);',
  "          _verifyWrittenRange(ph,first+2,1,batch,'펀드 가격이력 쓰기 후 검증 실패');",
  '        }',
  '      } else {',
  '        _setCodeColumnText(ph, 2); prices = _normalizeCodeRows(prices, 1); ph.getRange(2, 1, prices.length, 6).setValues(prices);',
  "        _verifyWrittenRange(ph, 2, 1, prices, '펀드 가격이력 쓰기 후 검증 실패');",
  '      }'
 ].join('\n'),'SCOPED_UPDATE');
 fn=once(fn,'    ph.getRange(ph.getLastRow() + 1, 1, append.length, 6).setValues(_normalizeCodeRows(append, 1));',[
  '    var appendAt=ph.getLastRow()+1, normalizedAppend=_normalizeCodeRows(append,1);',
  '    ph.getRange(appendAt,1,append.length,6).setValues(normalizedAppend);',
  "    if (scopedPriceWrite) _verifyWrittenRange(ph,appendAt,1,normalizedAppend,'펀드 가격이력 추가 후 검증 실패');"
 ].join('\n'),'SCOPED_APPEND_PROOF');
 let candidate=parent.slice(0,start)+fn+parent.slice(end);
 candidate=once(candidate,'//  📊 포트폴리오 대시보드 — Google Apps Script  v9.298','//  📊 포트폴리오 대시보드 — Google Apps Script  v9.299','BANNER');
 assert(candidate.split("gasVersion: '9.298'").length>=6);
 candidate=candidate.replaceAll("gasVersion: '9.298'","gasVersion: '9.299'");
 candidate=once(candidate,"var ISSUE507_GATE_API_VERSION='9.298'","var ISSUE507_GATE_API_VERSION='9.299'",'GATE_VERSION');
 return {parent,candidate,manifest:{version:'9.299',parentVersion:'9.298',parentGitBlob:PIN,candidateGitBlob:blob(candidate),
  mode:'SOURCE_PREVIEW_ONLY',productionDeploymentApproved:false,gasProjectWrites:0,financialWrites:0,
  changedBusinessFunctions:['_refreshFundValuations'],manualFullWritePreserved:true,existingBackupPreserved:true}};
}
