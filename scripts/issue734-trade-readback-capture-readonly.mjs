// One-shot sealed readback for local native-Sheet reconciliation. No raw logs.
import {randomBytes,createCipheriv,publicEncrypt,constants} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {validateWebAppUrl} from './diagnose-krx-operational.mjs';
import {inspectTradeV2RevisionResponse} from './issue734-trade-v2-hash-readonly.mjs';
export function sealTradeEvidence(payload,publicKey){
 const key=randomBytes(32),iv=randomBytes(12);
 const cipher=createCipheriv('aes-256-gcm',key,iv);
 cipher.setAAD(Buffer.from('ISSUE734_READBACK_V1'));
 const ciphertext=Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]);
 return {kind:'ISSUE734_SEALED_READBACK_V1',
  key:publicEncrypt({key:publicKey,oaepHash:'sha256',padding:constants.RSA_PKCS1_OAEP_PADDING},key).toString('base64'),
  iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),
  ciphertext:ciphertext.toString('base64')};
}
export async function captureTradeEvidence({url,token,fetchImpl=fetch}){
 const endpoint=validateWebAppUrl(url);
 if(typeof token!=='string'||token.length<12)throw Error('CAPTURE_AUTH_MISSING');
 const read=async action=>{
  const r=await fetchImpl(endpoint,{method:'POST',redirect:'follow',
   headers:{'content-type':'application/x-www-form-urlencoded;charset=UTF-8'},
   body:new URLSearchParams({action,accessToken:token}),signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('CAPTURE_HTTP_UNVERIFIED');return r.json();
 };
 const before=await read('previewTradeLedgerV2Migration');
 const api=await read('getTrades');
 inspectTradeV2RevisionResponse(api);
 const after=await read('previewTradeLedgerV2Migration');
 if(before?.status!=='ok'||after?.status!=='ok'
  ||after.migrationApplied!==false||after.financeWrites!==0
  ||!/^[a-f0-9]{64}$/.test(String(after.sourceDigest||''))
  ||before.sourceDigest!==after.sourceDigest
  ||before.proposedRevision!==after.proposedRevision
  ||after.proposedRevision!==api.ledgerRevision||after.sourceRows!==api.trades.length)
  throw Error('CAPTURE_SOURCE_UNVERIFIED');
 return {api,preview:after,capturedAt:new Date().toISOString()};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.env.GITHUB_REF!=='refs/heads/main'||process.env.GITHUB_RUN_ATTEMPT!=='1')
   throw Error('CAPTURE_MAIN_FIRST_ATTEMPT_REQUIRED');
  const payload=await captureTradeEvidence({url:process.env.GAS_WEB_APP_URL,
   token:process.env.GAS_ACCESS_TOKEN});
  const recipient=readFileSync(new URL('./issue734-trade-readback-recipient.pem',import.meta.url),'utf8');
  const sealed=sealTradeEvidence(payload,recipient);
  mkdirSync('artifacts',{recursive:true});
  writeFileSync('artifacts/issue734-sealed-readback.json',JSON.stringify(sealed));
  console.log(JSON.stringify({kind:'ISSUE734_SEALED_CAPTURE',status:'CAPTURED',
   rows:payload.api.trades.length,rootCauseVerified:false,financeWrites:0}));
 }catch(e){console.error(/^CAPTURE_[A-Z_]+$/.test(String(e?.message))?e.message:'CAPTURE_UNVERIFIED');
  process.exitCode=2;}
}
