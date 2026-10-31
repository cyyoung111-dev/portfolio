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
  // No market values, Telegram recipient, API tokens, GAS properties, or
  // message contents can enter the artifact.
  const receipt={status:'SENT',date,kind,claim:prefix+date,workflowRunId:String(runId)};
  writeFile(path,JSON.stringify(receipt),{flag:'wx'});
  return receipt;
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
