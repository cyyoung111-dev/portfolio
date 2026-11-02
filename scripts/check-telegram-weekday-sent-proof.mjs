import assert from 'node:assert/strict';
import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import YAML from 'yaml';
import {deliverPrepared} from './telegram-morning-workflow.mjs';
import {deliverClose} from './telegram-close-workflow.mjs';
import {persistWeekdaySentProof,deliverAndRecordWeekday} from './telegram-weekday-sent-proof.mjs';

const fixtures=[
 {kind:'morning',time:'2026-11-02T07:50:00+09:00',deliver:deliverPrepared,
  workflow:'.github/workflows/telegram-morning-briefing.yml',
  runtime:'.telegram-runtime',command:'node scripts/telegram-morning-workflow.mjs send',
  payload:{date:'2026-11-02',artifactName:'telegram-morning-claim-2026-11-02',
    message:'Synthetic morning test'}},
 {kind:'close',time:'2026-11-02T17:30:00+09:00',deliver:deliverClose,
  workflow:'.github/workflows/telegram-close-briefing.yml',
  runtime:'.telegram-close-runtime',command:'node scripts/telegram-close-workflow.mjs send',
  payload:{date:'2026-11-02',artifactName:'telegram-close-claim-2026-11-02',
    message:'Synthetic close test',nhConfirmed:1,domesticConfirmed:0}}
];
const dir=fs.mkdtempSync(join(tmpdir(),'weekday-telegram-sent-'));
try{
 for(const f of fixtures){
  const path=join(dir,f.kind+'-sent.json');
  const now=()=>new Date(f.time);
  let calls=0;
  const accepted=await deliverAndRecordWeekday(f.payload,{
    kind:f.kind,deliver:f.deliver,now,path,runId:'41200012345',
    send:async()=>{calls++;return true;}
  });
  assert.equal(accepted.status,'SENT');
  assert.equal(calls,1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path,'utf8')),{status:'SENT',
    date:'2026-11-02',kind:f.kind,deliveryMode:'regular',claim:f.payload.artifactName,
    workflowRunId:'41200012345'});
  assert.throws(()=>persistWeekdaySentProof(accepted,f.payload,{
    kind:f.kind,path,runId:'41200012345'}),/EEXIST/);
  const missing=join(dir,f.kind+'-failed.json');
  await assert.rejects(deliverAndRecordWeekday(f.payload,{
    kind:f.kind,deliver:f.deliver,now,path:missing,runId:'41200012345',
    send:async()=>{throw Error('TELEGRAM_SEND_UNCONFIRMED_DO_NOT_RETRY');}
  }),/TELEGRAM_SEND_UNCONFIRMED_DO_NOT_RETRY/);
  assert.equal(fs.existsSync(missing),false,'failure may not write proof');
  await assert.rejects(deliverAndRecordWeekday(f.payload,{
    kind:f.kind,deliver:f.deliver,path:missing,runId:'41200012345',
    now:()=>new Date('2026-11-03T22:00:00+09:00'),
    send:async()=>assert.fail('late/cross-date must not send')
  }),/PREPARED_INVALID|PAYLOAD_INVALID/);
  assert.equal(fs.existsSync(missing),false);
  for(const bad of [
    [{status:'PREPARED',date:'2026-11-02'},f.payload,f.kind,'41200012345'],
    [{status:'SENT',date:'2026-11-01'},f.payload,f.kind,'41200012345'],
    [{status:'SENT',date:'2026-11-31'},f.payload,f.kind,'41200012345'],
    [accepted,{...f.payload,artifactName:'wrong-claim'},f.kind,'41200012345'],
    [accepted,f.payload,'other','41200012345'],
    [accepted,f.payload,f.kind,'not-a-run-id']
  ]){
    assert.throws(()=>persistWeekdaySentProof(bad[0],bad[1],{
      kind:bad[2],path:missing,runId:bad[3]}),/PROOF_INVALID/);
    assert.equal(fs.existsSync(missing),false);
  }
  const wf=YAML.parse(fs.readFileSync(f.workflow,'utf8'));
  const steps=wf.jobs.briefing.steps;
  const claim=steps.findIndex(x=>String(x.name||'').startsWith('Claim delivery'));
  const send=steps.findIndex(x=>x.run===f.command);
  const proof=steps.findIndex(x=>x.name==='Archive Telegram API-confirmed SENT proof');
  assert.ok(claim>=0&&send>claim&&proof>send,'proof must follow send');
  assert.equal(steps[proof].uses,'actions/upload-artifact@v4');
  assert.equal(steps[proof].with.name,'$'+'{{ steps.prepare.outputs.artifact_name }}-sent');
  assert.equal(steps[proof].with.path,f.runtime+'/sent.json');
  assert.equal(steps[proof].with['if-no-files-found'],'error');
  assert.equal(steps[proof].if,"steps.prepare.outputs.ready == 'true'");
  assert.equal(steps[proof].env,undefined);
  assert.ok(steps[send].env.TELEGRAM_BOT_TOKEN);
  assert.equal(steps[send].env.GAS_ACCESS_TOKEN,undefined);
 }
 // A real-format late test must never be reported as a regular delivery.
 const lateDate='2026-11-02';
 const latePayload={date:lateDate,artifactName:'telegram-morning-claim-'+lateDate,
   mode:'late_test',
   message:'[수동 지연 발송 테스트 · 2026-11-02 · 정규 장전 발송 아님]\n[한국장 장전 종합 브리핑 | 2026-11-02]'};
 const latePath=join(dir,'morning-late-test-sent.json');
 let lateCalls=0;
 const lateSent=await deliverAndRecordWeekday(latePayload,{
   kind:'morning',deliver:(payload,options)=>deliverPrepared(payload,{...options,mode:'late_test'}),
   now:()=>new Date('2026-11-02T10:20:00+09:00'),
   path:latePath,runId:'41200012346',
   send:async()=>{lateCalls++;return true;}
 });
 assert.equal(lateSent.status,'SENT');
 assert.equal(lateCalls,1);
 assert.deepEqual(JSON.parse(fs.readFileSync(latePath,'utf8')),{
   status:'SENT',date:lateDate,kind:'morning',deliveryMode:'late_test',
   claim:latePayload.artifactName,workflowRunId:'41200012346'
 });
 const invalidPath=join(dir,'invalid-test-proof.json');
 for(const invalid of [
   {...latePayload,message:'[한국장 장전 종합 브리핑 | 2026-11-02]'},
   {...latePayload,mode:'connection_test'},
   {...latePayload,mode:'rescue'},
   {...latePayload,artifactName:'telegram-morning-claim-2026-11-01'}
 ]){
   assert.throws(()=>persistWeekdaySentProof(lateSent,invalid,{
     kind:'morning',path:invalidPath,runId:'41200012346'}),/PROOF_INVALID/);
   assert.equal(fs.existsSync(invalidPath),false);
 }
 const source=fs.readFileSync('scripts/telegram-weekday-sent-proof.mjs','utf8');
 assert.match(source,/const sent=await deliver\(payload,/);
 assert.match(source,/persistWeekdaySentProof\(sent,payload,/);
 assert.match(source,/\{flag:'wx'\}/);
 const morning=fs.readFileSync('scripts/telegram-morning-workflow.mjs','utf8');
 const close=fs.readFileSync('scripts/telegram-close-workflow.mjs','utf8');
 assert.match(morning,/const sent=await deliverAndRecordWeekday\(payload,/);
 assert.match(close,/const sent=await deliverAndRecordWeekday\(payload,/);
} finally {
 fs.rmSync(dir,{recursive:true,force:true});
}
console.log('WEEKDAY_TELEGRAM_SENT_PROOF_PASS morning=1 close=1 late_test=1 no-duplicate no-proof-on-failure');
