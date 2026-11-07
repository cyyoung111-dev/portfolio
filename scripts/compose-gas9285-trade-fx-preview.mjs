// Read-only candidate for the next manually approved GAS release. The approved
// live 9.284 source remains byte-for-byte pinned. Do not publish on import.
// This preview is an alternative to the separate v9.285 fund-noop proposal.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
const PINNED_BASE_BLOB='b5b1c7fd5a27454419ddd6d12ecb20751c207c63';
const sha1=s=>{const b=Buffer.from(s,'utf8');return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex')};
const replaceOnce=(s,from,to)=>{
 if(s.split(from).length!==2)throw Error('GAS9285_TRADE_FX_PREVIEW_ANCHOR_DRIFT');
 return s.replace(from,to);
};
export function composeGas9285TradeFxPreview(){
 const base=fs.readFileSync('src/gas/apps_script.gs','utf8');
 if(sha1(base)!==PINNED_BASE_BLOB)throw Error('GAS9285_UNREVIEWED_BASE');
 let candidate=base;
 const replacements=[
 [
  "    return ('0' + ((b + 256) % 256).toString(16)).slice(-2);\n  }).join('');\n}\nfunction _portfolioSyncCanonical_(kind, rows) {",
  "    return ('0' + ((b + 256) % 256).toString(16)).slice(-2);\n  }).join('');\n}\n// Optional legacy trade columns L/M. Absent on 11-column ledgers, but when\n// supplied both inputs must be finite, positive and reconcile exactly to\n// the KRW unit price. No exchange-rate inference from a market quote.\nfunction _portfolioTradeFxMetadata_(trade) {\n  if (typeof _issue507GateInside_ !== 'undefined' && !_issue507GateInside_) return _issue507GateInvoke_('_portfolioTradeFxMetadata_', _portfolioTradeFxMetadata_, this, arguments);\n  var raw=trade && trade.priceRaw, rate=trade && trade.fxRateAtBuy;\n  var hasRaw=raw!==undefined && raw!==null && raw!=='';\n  var hasRate=rate!==undefined && rate!==null && rate!=='';\n  if (!hasRaw && !hasRate) return ['', ''];\n  if (!hasRaw || !hasRate) throw new Error('TRADE_FX_METADATA_INCOMPLETE');\n  var amount=Number(raw),fx=Number(rate),price=Number(trade.price);\n  if (!isFinite(amount) || !isFinite(fx) || amount<=0 || fx<=0\n      || !isFinite(price) || price<=0\n      || Math.round(amount*fx)!==price)\n    throw new Error('TRADE_FX_METADATA_PRICE_MISMATCH');\n  return [amount,fx];\n}\n\nfunction _portfolioSyncCanonical_(kind, rows) {"
 ],
 [
  "      parseFloat(r.qty)||0,parseFloat(r.price)||0,String(r.assetType||'주식'),String(r.memo||''),\n      parseFloat(r.ratio)||0,parseFloat(r.fractionalCash)||0];\n  });\n  // 거래는 같은 날짜의 원장 순서를 보존한다. 보유는 합산 종목의 순서와 무관하다.",
  "      parseFloat(r.qty)||0,parseFloat(r.price)||0,String(r.assetType||'주식'),String(r.memo||''),\n      parseFloat(r.ratio)||0,parseFloat(r.fractionalCash)||0].concat(_portfolioTradeFxMetadata_(r));\n  });\n  // 거래는 같은 날짜의 원장 순서를 보존한다. 보유는 합산 종목의 순서와 무관하다."
 ],
 [
  "    var createdTradeSheet = !sh;\n    var previousRows = sh && sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, Math.min(11, sh.getLastColumn())).getValues() : [];\n    if (!sh) {\n      sh = ss.insertSheet(CONFIG.SHEET_TRADES);",
  "    var createdTradeSheet = !sh;\n    var previousRows = sh && sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, Math.min(13, sh.getLastColumn())).getValues() : [];\n    if (!sh) {\n      sh = ss.insertSheet(CONFIG.SHEET_TRADES);"
 ],
 [
  "    trades.sort(function(a,b){ return (a.date||'').localeCompare(b.date||''); });\n    var intendedRows = trades.map(function(t) {\n      return [_normalizeDate(t.date), t.tradeType||'', t.acct||'', t.name||'',\n        t.code||'', t.qty||0, t.price||0, t.assetType||'주식', t.memo||'',\n        t.ratio || '', t.fractionalCash || ''];\n    });\n    var explicitEmptyReset = explicitEmpty === true && intendedRows.length === 0;",
  "    trades.sort(function(a,b){ return (a.date||'').localeCompare(b.date||''); });\n    var intendedRows;\n    try {\n      intendedRows = trades.map(function(t) {\n        return [_normalizeDate(t.date), t.tradeType||'', t.acct||'', t.name||'',\n          t.code||'', t.qty||0, t.price||0, t.assetType||'주식', t.memo||'',\n          t.ratio || '', t.fractionalCash || ''].concat(_portfolioTradeFxMetadata_(t));\n      });\n    } catch (fxError) {\n      return jsonError('외화거래 원단가/매입환율 불일치: '+fxError.message,\n        {errorCode:fxError.message,saveState:'failed'});\n    }\n    // Never let a stale 11-column client wipe existing FX evidence for an\n    // identical trade. An intentional correction sends paired FX fields.\n    for (var fxRowIndex=0;fxRowIndex<previousRows.length;fxRowIndex++) {\n      var previous=previousRows[fxRowIndex]||[];\n      if (previous[11]==='' || previous[11]==null) continue;\n      var previousKey=JSON.stringify(previous.slice(0,11).map(function(v,i) {\n        return i===0?_normalizeDate(v):v;\n      }));\n      var erased=intendedRows.some(function(row) {\n        return JSON.stringify(row.slice(0,11))===previousKey\n          && (row[11]==='' || row[12]==='');\n      });\n      if (erased) return jsonError('기존 외화단가·매입환율 누락 클라이언트 저장 차단',\n        {errorCode:'TRADE_FX_METADATA_LOSS_RISK',saveState:'failed'});\n    }\n    var explicitEmptyReset = explicitEmpty === true && intendedRows.length === 0;"
 ],
 [
  "    _setCodeColumnText(sh, 5);\n    sh.getRange(1,1,1,11).setValues([['날짜','매수/매도','계좌','종목명','종목코드','수량','단가','자산유형','메모','비율','단주정산']]);\n    sh.getRange(1,1,1,11).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');\n    if (intendedRows.length > 0)",
  "    _setCodeColumnText(sh, 5);\n    sh.getRange(1,1,1,13).setValues([['날짜','매수/매도','계좌','종목명','종목코드','수량','단가','자산유형','메모','비율','단주정산','외화단가','매입환율']]);\n    sh.getRange(1,1,1,13).setBackground('#0d1117').setFontColor('#94a3b8').setFontWeight('bold');\n    if (intendedRows.length > 0)"
 ],
 [
  "    if (intendedRows.length > 0)\n      sh.getRange(2, 1, intendedRows.length, 11).setValues(_normalizeCodeRows(intendedRows, 4));\n    SpreadsheetApp.flush();\n    var currentRows = intendedRows;",
  "    if (intendedRows.length > 0)\n      sh.getRange(2, 1, intendedRows.length, 13).setValues(_normalizeCodeRows(intendedRows, 4));\n    SpreadsheetApp.flush();\n    var currentRows = intendedRows;"
 ],
 [
  "    var tradeBackupCleanup = tradeBackup ? _cleanupCurrentSystemBackup(ss, tradeBackup) : null;\n    return jsonOk({ saveState: 'success', synced: trades.length, affectedFrom: affectedFrom, affectedTo: affectedTo, snapshotRebuild: snapshotRebuild, backupCleanup: tradeBackupCleanup });\n  } catch(err) {\n    if (typeof tradeBackup !== 'undefined' && tradeBackup) _markSnapshotBackupStatus(tradeBackup, 'WRITE_FAILED', err.message);",
  "    var tradeBackupCleanup = tradeBackup ? _cleanupCurrentSystemBackup(ss, tradeBackup) : null;\n    return jsonOk({ saveState: 'success', synced: trades.length, affectedFrom: affectedFrom, affectedTo: affectedTo, snapshotRebuild: snapshotRebuild, backupCleanup: tradeBackupCleanup, tradeFxMetadataVersion: 1 });\n  } catch(err) {\n    if (typeof tradeBackup !== 'undefined' && tradeBackup) _markSnapshotBackupStatus(tradeBackup, 'WRITE_FAILED', err.message);"
 ],
 [
  "        var assetType = (r[7] || '주식').toString();\n        return {\n          date:      (r[0] instanceof Date)",
  "        var assetType = (r[7] || '주식').toString();\n        var rawFx=r[11], rawRate=r[12], hasRaw=rawFx!=null && rawFx!=='';\n        var hasRate=rawRate!=null && rawRate!=='';\n        var fx=[];\n        if (hasRaw || hasRate) {\n          fx=_portfolioTradeFxMetadata_({\n            price:r[6], priceRaw:rawFx, fxRateAtBuy:rawRate\n          });\n        }\n        return {\n          date:      (r[0] instanceof Date)"
 ],
 [
  "          fund:      (assetType === '펀드' || assetType === 'TDF'),\n        };\n      });\n    return jsonOk({ trades: trades });\n  } catch(err) {\n    return jsonError('getTrades 실패: ' + err.message);",
  "          fund:      (assetType === '펀드' || assetType === 'TDF'),\n          ...(fx.length ? {priceRaw:fx[0],fxRateAtBuy:fx[1]} : {})\n        };\n      });\n    return jsonOk({ trades: trades, tradeFxMetadataVersion: 1 });\n  } catch(err) {\n    return jsonError('getTrades 실패: ' + err.message);"
 ],
 [
  "    var ss=getss();\n    _settlePendingCodeDeleteForRead_(ss);\n    var settings = _readSettingsMap(ss);\n    _removeSecretsFromSettings(settings);\n    settings.apiKeyStatus = _getApiKeyStatus();\n    return jsonOk({ settings: settings, portfolioSyncReceipts: true, gasVersion: '9.284' });\n  } catch(err) {\n    return jsonError('getSettings 실패: ' + err.message);",
  "    var ss=getss();\n    _settlePendingCodeDeleteForRead_(ss);\n    var settings = _readSettingsMap(ss);\n    _removeSecretsFromSettings(settings);\n    settings.apiKeyStatus = _getApiKeyStatus();\n    return jsonOk({ settings: settings, portfolioSyncReceipts: true, tradeFxMetadataVersion: 1, gasVersion: '9.284' });\n  } catch(err) {\n    return jsonError('getSettings 실패: ' + err.message);"
 ],
 [
  "      portfolioSyncReceipts: true,\n      codeMasterSourceId: _portfolioCodeMasterSourceIdentity_(ss),",
  "      portfolioSyncReceipts: true,\n      tradeFxMetadataVersion: 1,\n      codeMasterSourceId: _portfolioCodeMasterSourceIdentity_(ss),"
 ]
];
 for(const [from,to] of replacements)candidate=replaceOnce(candidate,from,to);
 candidate=replaceOnce(candidate,'//  📊 포트폴리오 대시보드 — Google Apps Script  v9.284',
   '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.285');
 candidate=replaceOnce(candidate,'//  v9.284 변경사항 (2026.11.06):',
   '//  v9.285 변경사항 (2026.11.07):\n//  • 거래이력 외화단가·매입환율 13열 원천 보존 및 과거 11열 조회 지원\n//  • 입력 FX x 환율과 원화단가 검산, 이전 보존값 downgrade 방지\n//  • 9.284 운영 배포 변경 없이 v9.285 후보만 read-only 검토\n//\n//  v9.284 변경사항 (2026.11.06):');
 if(candidate.split("gasVersion: '9.284'").length!==10)
   throw Error('GAS9285_FX_API_VERSION_COUNT_DRIFT');
 candidate=candidate.replaceAll("gasVersion: '9.284'","gasVersion: '9.285'");
 candidate=replaceOnce(candidate,"var ISSUE507_GATE_API_VERSION='9.284'",
   "var ISSUE507_GATE_API_VERSION='9.285'");
 const manifest={baseSourceGitBlob:sha1(base),candidateSourceGitBlob:sha1(candidate),
  parentVersion:'9.284',proposedVersion:'9.285',status:'SOURCE_PREVIEW_NOT_DEPLOYABLE',
  gasProjectWrites:0,financeWrites:0,productionDeploymentApproved:false};
 return {base,candidate,manifest};
}