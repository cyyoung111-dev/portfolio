// Trade-only UTF-8 digests. Legacy IDs and receipt signatures stay unchanged.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {composeGas9295CodeMasterReusePreview} from './compose-gas9295-code-master-reuse-preview.mjs';
const blob=s=>{const b=Buffer.from(s);return createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex')};
const once=(s,a,b)=>{assert.equal(s.split(a).length,2,'GAS9296_SOURCE_DRIFT');return s.replace(a,b)};
export function composeGas9296TradeUtf8Preview(){
 const parent=composeGas9295CodeMasterReusePreview().candidate;
 assert.equal(blob(parent),'a360a32a2d459d1f28dee94365a28d8c3ca24367');
 const helper=[
  'function _tradeV2Utf8Digest_(text) {',
  '  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8)',
  "    .map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');",
  '}'
 ].join('\n');
 let candidate=once(parent,
  'function _tradeV2RowHash_(r){return _portfolioSyncDigest_(JSON.stringify(_tradeV2CanonicalRow_(r)));}',
  helper+'\nfunction _tradeV2RowHash_(r){return _tradeV2Utf8Digest_(JSON.stringify(_tradeV2CanonicalRow_(r)));}');
 candidate=once(candidate,
  'function _tradeV2Revision_(rows){\n  return _portfolioSyncDigest_(JSON.stringify(rows.map(_tradeV2CanonicalRow_)));\n}',
  'function _tradeV2Revision_(rows){\n  return _tradeV2Utf8Digest_(JSON.stringify(rows.map(_tradeV2CanonicalRow_)));\n}');
 candidate=once(candidate,
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.295',
  '//  📊 포트폴리오 대시보드 — Google Apps Script  v9.296');
 candidate=candidate.replaceAll("gasVersion: '9.295'","gasVersion: '9.296'");
 candidate=once(candidate,"var ISSUE507_GATE_API_VERSION='9.295'","var ISSUE507_GATE_API_VERSION='9.296'");
 return {parent,candidate,manifest:{version:'9.296',parentVersion:'9.295',
  candidateGitBlob:blob(candidate),changedBusinessFunctions:['_tradeV2RowHash_','_tradeV2Revision_'],
  addedFunctions:['_tradeV2Utf8Digest_'],legacyReceiptDigestUnchanged:true,
  migrationIdDigestUnchanged:true,financialSourceWrites:0}};
}
