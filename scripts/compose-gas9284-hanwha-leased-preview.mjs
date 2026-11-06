// Read-only v9.284 candidate builder. Produces a complete in-memory GAS source
// from the pinned reviewed v9.283 source. NO deployment or finance writes.
import fs from 'node:fs';
import {createHash} from 'node:crypto';

const BASE_BLOB='327f48785550a012eaf1ed533c24bf6289c01a71';
const sha=s=>{
  const b=Buffer.from(s,'utf8');
  return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
};
function replaceOne(s,needle,replacement,label){
  if(s.split(needle).length!==2)throw Error('GAS9284_ANCHOR_DRIFT:'+label);
  return s.replace(needle,replacement);
}

export function composeGas9284HanwhaLeasedPreview(){
  const base=fs.readFileSync('src/gas/apps_script.gs','utf8');
  if(sha(base)!==BASE_BLOB)throw Error('GAS9284_BASE_SOURCE_UNREVIEWED');
  let src=base;
  // Existing KB lease code is deliberately reused, NOT duplicated. This
  // preserves bidirectional exclusion with deferred FUND / KRX backfill.
  src=replaceOne(src,
    "function handleCollectKbFundNav(mode, dataJson, date) {",
    "function handleCollectKbFundNav(mode, dataJson, date, fundCode) {",
    'LEASE_FUNCTION_SIGNATURE');
  const before=`    if (mode !== 'import' && mode !== 'refresh') throw new Error('request');
    if (mode === 'import') {
      var input = JSON.parse(dataJson);
      if (input.code !== 'F00002' || input.provider !== 'KB_VALUE_ST'
          || input.classCode !== 'AQ018' || input.appendOnly !== true
          || !Array.isArray(input.rows) || !input.rows.length || input.rows.length > 32) throw new Error('request');
    } else {`;
  const after=`    var code = String(fundCode || 'F00002').trim().toUpperCase();
    if (code !== 'F00001' && code !== 'F00002') throw new Error('request');
    if (mode !== 'import' && mode !== 'refresh') throw new Error('request');
    if (mode === 'import') {
      var input = JSON.parse(dataJson);
      var kbOk = code === 'F00002' && input.code === 'F00002'
          && input.provider === 'KB_VALUE_ST' && input.classCode === 'AQ018';
      var hanwhaOk = code === 'F00001' && input.code === 'F00001'
          && input.provider === 'HANWHA_2045_CRPE' && input.classCode === 'C-RPe'
          && input.ackWarnings === false;
      if ((!kbOk && !hanwhaOk) || input.appendOnly !== true
          || !Array.isArray(input.rows) || !input.rows.length
          || input.rows.length > (hanwhaOk ? 8 : 32)) throw new Error('request');
      if (hanwhaOk) {
        var seenNavDates = {};
        input.rows.forEach(function(row) {
          var d = _fundDate(row && row.date);
          if (d >= today() || d < _fundDateOffset(today(), -31)
              || seenNavDates[d] || !isFinite(Number(row.nav)) || Number(row.nav) <= 0)
            throw new Error('request');
          seenNavDates[d] = true;
        });
      }
    } else {`;
  src=replaceOne(src,before,after,'FUND_CLASS_VALIDATION');
  src=replaceOne(src,"origin:'KB_NAV_COLLECTOR',until:now+420000",
    "origin:code === 'F00001' ? 'HANWHA_NAV_COLLECTOR' : 'KB_NAV_COLLECTOR',until:now+420000",
    'LEASE_OWNER_PROVENANCE');
  src=replaceOne(src,
    "handleRefreshFundValuations(date,date,'F00002','',true)",
    "handleRefreshFundValuations(date,date,code,'',true)",
    'REFRESH_EXACT_FUND');
  const route="  if (params.action === 'collectKbFundNav') return handleCollectKbFundNav(params.mode || '', params.data || '{}', params.date || '');";
  const added=route+"\n  if (params.action === 'collectHanwhaFundNav') return handleCollectKbFundNav(params.mode || '', params.data || '{}', params.date || '', 'F00001');";
  src=replaceOne(src,route,added,'POST_ROUTE');
  src=replaceOne(src,"//  v9.283 변경사항 (2026.11.02):",
    "//  v9.284 변경사항 (2026.11.06):\n//  • F00001 C-RPe import/derived refresh를 기존 공유 FUND/backfill lease 경유로 제한\n//  • 클래스/appendOnly/공시일/경고 fail-closed 유지, 외부 수집과 배포는 별도 승인\n//\n//  v9.283 변경사항 (2026.11.02):",
    'VERSION_CHANGELOG');
  if(src.split("gasVersion: '9.283'").length!==10)throw Error('GAS9284_VERSION_FIELDS_CHANGED');
  src=src.replaceAll("gasVersion: '9.283'","gasVersion: '9.284'");
  src=replaceOne(src,"var ISSUE507_GATE_API_VERSION='9.283'",
    "var ISSUE507_GATE_API_VERSION='9.284'",'GATE_METADATA_VERSION');
  return {candidate:src,base,manifest:{
    status:'SOURCE_PREVIEW_NOT_DEPLOYABLE',
    proposedVersion:'9.284',parentVersion:'9.283',
    baseSourceGitBlob:BASE_BLOB,candidateSourceGitBlob:sha(src),
    existingKbLeaseReused:true,hanwhaImportRequiresSharedLease:true,
    exactClasses:['F00001/HANWHA_2045_CRPE/C-RPe','F00002/KB_VALUE_ST/AQ018'],
    requiresSeparateFullReleaseReview:true,
    productionDeploymentApproved:false,gasProjectWrites:0,financeWrites:0}};
}
