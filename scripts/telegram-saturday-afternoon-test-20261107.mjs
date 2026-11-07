// One extra user-requested Saturday test. No weekday claim, GAS writer or financial mutation.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {composeSaturday} from './telegram-saturday-test-20261107.mjs';
import {sendTelegram} from './telegram-morning-briefing.mjs';
import {krxSessionStatus} from './krx-session-calendar.mjs';

export const DATE='2026-11-07';
export const REPO='cyyoung111-dev/portfolio';
export const CLAIM='telegram-saturday-20261107-afternoon-extra-claim';
export const PREFIX='[토요일 추가 브리핑 시험발송 | 2026-11-07]';
const RUNTIME='.telegram-saturday-extra-runtime';
const WORKFLOW='.github/workflows/telegram-saturday-afternoon-test-20261107.yml';

function localClock(instant){
 if(!(instant instanceof Date)||!Number.isFinite(instant.getTime()))return null;
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{
   timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',
   hour:'2-digit',minute:'2-digit',hourCycle:'h23'
 }).formatToParts(instant).map(part=>[part.type,part.value]));
 return {date:p.year+'-'+p.month+'-'+p.day,minute:Number(p.hour)*60+Number(p.minute)};
}
export function testWindow(instant){
 const p=localClock(instant);
 return Boolean(p&&p.date===DATE&&p.minute>=720&&p.minute<1260);
}
export function authorize({eventName,event,instant,additionVerified,attempt}){
 return eventName==='push'&&event?.repository?.full_name===REPO
   &&event?.ref==='refs/heads/main'&&testWindow(instant)
   &&additionVerified===true&&Number(attempt)===1
   &&/^[0-9a-f]{40}$/.test(String(event?.before||''))
   &&/^[0-9a-f]{40}$/.test(String(event?.after||''))
   &&event.before!==event.after;
}
export async function prepare({now=()=>new Date(),githubToken,fetchImpl=fetch,
 compose=composeSaturday}={}){
 if(!testWindow(now()))return {ready:false,status:'OUTSIDE_TEST_WINDOW'};
 if(typeof githubToken!=='string'||!githubToken)throw Error('EXTRA_TEST_CONFIG');
 if(krxSessionStatus(DATE)!=='CLOSED'||krxSessionStatus('2026-11-06')!=='OPEN')
   throw Error('EXTRA_TEST_CALENDAR');
 let response,found;
 try{
   response=await fetchImpl('https://api.github.com/repos/'+REPO+
     '/actions/artifacts?name='+CLAIM+'&per_page=100',{
       headers:{authorization:'Bearer '+githubToken,accept:'application/vnd.github+json'},
       redirect:'error',signal:AbortSignal.timeout(12000)});
   if(!response?.ok)throw Error('LOOKUP_HTTP');
   found=await response.json();
 }catch{throw Error('EXTRA_TEST_CLAIM_LOOKUP_FAILED');}
 if(!Number.isSafeInteger(found?.total_count)||found.total_count<0
    ||!Array.isArray(found.artifacts))throw Error('EXTRA_TEST_CLAIM_INVALID');
 if(found.total_count>0){
   if(!found.artifacts.some(x=>x?.name===CLAIM))throw Error('EXTRA_TEST_CLAIM_INVALID');
   return {ready:false,status:'ALREADY_CLAIMED'};
 }
 if(found.artifacts.length!==0)throw Error('EXTRA_TEST_CLAIM_INVALID');
 const data=await compose({now,gasUrl:process.env.GAS_WEB_APP_URL,
   gasToken:process.env.GAS_ACCESS_TOKEN});
 if(typeof data?.text!=='string'||!Number.isInteger(data.sourceCount)
    ||data.sourceCount<0||data.sourceCount>21)throw Error('EXTRA_TEST_PAYLOAD_INVALID');
 const message=data.text.replace(/^\[[^\n]+\]/,PREFIX);
 if(!message.startsWith(PREFIX)||message.length>4000
   ||!message.includes('■ QC:')||!message.includes('TEST ONLY'))
   throw Error('EXTRA_TEST_PAYLOAD_INVALID');
 if(!testWindow(now()))throw Error('EXTRA_TEST_WINDOW_EXPIRED');
 return {ready:true,status:'PREPARED',date:DATE,claim:CLAIM,
   message,sourceCount:data.sourceCount};
}
export function validateSendPayload(data,instant){
 if(!testWindow(instant)||data?.ready!==true||data?.date!==DATE
    ||data?.claim!==CLAIM||typeof data?.message!=='string'
    ||!data.message.startsWith(PREFIX)||data.message.length>4000
    ||!data.message.includes('■ QC:')||!data.message.includes('TEST ONLY'))
    throw Error('EXTRA_TEST_SEND_DENIED');
}
async function main(){
 const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
 if(!authorize({eventName:process.env.GITHUB_EVENT_NAME,event,instant:new Date(),
   additionVerified:process.env.EXTRA_TEST_ADDITION_VERIFIED==='true',
   attempt:process.env.GITHUB_RUN_ATTEMPT}))
   throw Error('EXTRA_TEST_EVENT_DENIED');
 if(process.argv[2]==='prepare'){
   const result=await prepare({githubToken:process.env.GITHUB_TOKEN});
   if(result.ready){
     fs.mkdirSync(RUNTIME,{recursive:true});
     fs.writeFileSync(RUNTIME+'/payload.json',JSON.stringify(result),{flag:'wx'});
     fs.writeFileSync(RUNTIME+'/claim.json',JSON.stringify({
       date:DATE,claim:CLAIM,runId:process.env.GITHUB_RUN_ID}),{flag:'wx'});
   }
   fs.appendFileSync(process.env.GITHUB_OUTPUT,
     'ready='+result.ready+'\nclaim='+(result.claim||'')+'\n');
   console.log(JSON.stringify({status:result.status,date:DATE,
     sourceCount:result.sourceCount||0,financialWrites:0,gasDeployments:0}));
 }else if(process.argv[2]==='send'){
   const payload=JSON.parse(fs.readFileSync(RUNTIME+'/payload.json','utf8'));
   validateSendPayload(payload,new Date());
   await sendTelegram(process.env.TELEGRAM_BOT_TOKEN,
     process.env.TELEGRAM_CHAT_ID,payload.message);
   // Telegram sendMessage confirmed ok=true; a failed upload cannot trigger a
   // second send, because the claim artifact was published before this step.
   fs.writeFileSync(RUNTIME+'/sent.json',JSON.stringify({
     status:'SENT',date:DATE,claim:CLAIM,runId:process.env.GITHUB_RUN_ID}),{flag:'wx'});
   console.log(JSON.stringify({status:'SENT',date:DATE,
     sourceCount:payload.sourceCount,financialWrites:0,gasDeployments:0}));
 }else throw Error('EXTRA_TEST_MODE_INVALID');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 main().catch(error=>{
   console.error(/^EXTRA_TEST_[A-Z_]+$/.test(error?.message||'')
      ?error.message:'EXTRA_TEST_FAILED');
   process.exitCode=1;
 });
}
