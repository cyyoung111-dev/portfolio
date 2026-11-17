import fs from 'node:fs';

const CLAIM_PREFIX={morning:'telegram-morning-claim-',close:'telegram-close-claim-'};
function dateIsValid(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||'')))return false;
  const parsed=new Date(value+'T00:00:00Z');
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
}
// A dated claim means delivery was attempted, not that Telegram accepted the
// message. A separate "sent" receipt is written only after sendTelegram's
// API ok:true confirmation (the caller's deliver function must enforce it).
export function persistWeekdaySentProof(sent,payload,{
  kind,path,runId='',writeFile=fs.writeFileSync
}={}){
  const prefix=CLAIM_PREFIX[kind],date=sent?.date;
  if(!prefix||!dateIsValid(date)||sent.status!=='SENT'
    ||payload?.date!==date||payload?.artifactName!==prefix+date
    ||typeof path!=='string'||!path.length
    ||(typeof runId!=='string'&&typeof runId!=='number')
    ||!/^\d+$/.test(String(runId))
    ||typeof writeFile!=='function')
    throw Error('TELEGRAM_SENT_PROOF_INVALID');
  // Distinguish a one-off real-format test from a regular delivery in durable proof.
  // Keep the same dated claim so neither path can bypass duplicate protection.
  if(payload?.mode && (kind!=='morning'||payload.mode!=='late_test'))
    throw Error('TELEGRAM_SENT_PROOF_INVALID');
  const deliveryMode=payload?.mode==='late_test'?'late_test':'regular';
  if(deliveryMode==='late_test' &&
    (typeof payload.message!=='string' ||
     !payload.message.startsWith(`[수동 지연 발송 테스트 · ${date} · 정규 장전 발송 아님]\n`)))
    throw Error('TELEGRAM_SENT_PROOF_INVALID');
  // No market values, Telegram recipient, API tokens, GAS properties, or
  // message contents can enter the artifact.
  const receipt={status:'SENT',date,kind,deliveryMode,claim:prefix+date,workflowRunId:String(runId)};
  writeFile(path,JSON.stringify(receipt),{flag:'wx'});
  return receipt;
}
// A claim blocks any second send, but an incomplete prior delivery must
// never turn a scheduled fallback into a successful delivery verdict.
// Only recheck GitHub SENT provenance when a claim already exists.
export async function confirmClaimedWeekdayDelivery(result,{
 kind,mode='rescue',verify
}={}){
 if(result?.status!=='ALREADY_CLAIMED')return result;
 const errorCode=kind==='close'?'TELEGRAM_CLOSE_CLAIM_SENT_UNVERIFIED':
  'TELEGRAM_MORNING_CLAIM_SENT_UNVERIFIED';
 if(!CLAIM_PREFIX[kind]||result.ready!==false||!dateIsValid(result.date))
  throw Error(errorCode);
 // A manually requested late test shares the production claim: it stays
 // blocked, and is explicitly not an official regular-window delivery.
 if(kind==='morning'&&mode==='late_test')
  return {...result,status:'LATE_TEST_ALREADY_CLAIMED'};
 if(typeof verify!=='function')throw Error(errorCode);
 let proof;
 try{proof=await verify(result.date);}catch{throw Error(errorCode);}
 if(proof?.date!==result.date||
    (kind==='close'?proof.verified!==true:proof.verifiedSent!==true))
  throw Error(errorCode);
 return {...result,status:'ALREADY_SENT_VERIFIED'};
}

export async function deliverAndRecordWeekday(payload,{
  kind,deliver,now=()=>new Date(),token,chatId,attempt=1,
  send,path,runId=''
}={}){
  if(typeof deliver!=='function')throw Error('TELEGRAM_SENT_PROOF_INVALID');
  // Deliverers enforce the original clock/date/claim/first-attempt gates.
  // Never create a receipt if the call throws or reports a non-SENT outcome.
  const sent=await deliver(payload,{now,token,chatId,attempt,...(send?{send}:{})});
  persistWeekdaySentProof(sent,payload,{kind,path,runId});
  return sent;
}
