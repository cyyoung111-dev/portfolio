import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {armedKstClock,ARMED_DELIVERY,authorizeArmedDelivery,
 waitUntilPunctualWindow} from './telegram-punctual-arm.mjs';
import {scheduledWindow} from './telegram-morning-briefing.mjs';
import {closeWindow} from './telegram-close-workflow.mjs';

const repo='cyyoung111-dev/portfolio',date='2026-11-02';
const env={GITHUB_EVENT_NAME:'schedule',GITHUB_REPOSITORY:repo,
 GITHUB_REF:'refs/heads/main',GITHUB_RUN_ATTEMPT:'1'};
const event=kind=>({schedule:ARMED_DELIVERY[kind].cron,
 repository:{full_name:repo}});
const kst=(clock,d=date)=>new Date(d+'T'+clock+'+09:00');
assert.equal(armedKstClock(kst('07:40:00')).minutes,460);
assert.equal(armedKstClock(kst('17:00:00')).minutes,1020);
for(const [kind,before,arm,target,last,cutoff] of [
 ['morning','07:19:59','07:20:00','07:40:00','08:09:59','08:10:00'],
 ['close','16:19:59','16:20:00','17:00:00','17:59:59','18:00:00']
]){
 const valid=t=>authorizeArmedDelivery(kind,env,event(kind),kst(t));
 assert.equal(valid(before).allowed,false,kind+' too early');
 assert.equal(valid(arm).allowed,true,kind+' start');
 assert.equal(valid(target).allowed,true,kind+' target');
 assert.equal(valid(last).allowed,true,kind+' last permissible time');
 assert.equal(valid(cutoff).allowed,false,kind+' cutoff');
 // Independent scheduler dispatch is authorized only for the same main repo,
 // with no untrusted inputs or date override, inside the original KST window.
 const externalEnv={...env,GITHUB_EVENT_NAME:'workflow_dispatch'};
 const externalEvent={ref:'refs/heads/main',repository:{full_name:repo}};
 assert.equal(authorizeArmedDelivery(kind,externalEnv,externalEvent,kst(arm)).allowed,true);
 assert.equal(authorizeArmedDelivery(kind,externalEnv,externalEvent,kst(target)).allowed,true);
 assert.equal(authorizeArmedDelivery(kind,externalEnv,externalEvent,kst(cutoff)).allowed,false);
 assert.equal(authorizeArmedDelivery(kind,externalEnv,{...externalEvent,ref:'refs/heads/other'},kst(arm)).allowed,false);
 assert.equal(authorizeArmedDelivery(kind,externalEnv,{...externalEvent,inputs:{date}},kst(arm)).allowed,false);
 assert.equal(authorizeArmedDelivery(kind,{...externalEnv,GITHUB_RUN_ATTEMPT:'2'},externalEvent,kst(arm)).allowed,false);
 assert.equal(authorizeArmedDelivery(kind,externalEnv,{...externalEvent,repository:{full_name:'other/repo'}},kst(arm)).allowed,false);
 // A reviewed local-git-diff workflow step, not untrusted event arrays,
 // must set this one-step authorization output.
 if(kind==='close'){
   const pushEnv={...env,GITHUB_EVENT_NAME:'push',
     TELEGRAM_CLOSE_SENTINEL_VERIFIED:'true'};
   const pushEvent={ref:'refs/heads/main',repository:{full_name:repo}};
   assert.equal(authorizeArmedDelivery(kind,pushEnv,pushEvent,kst(arm)).allowed,true);
   assert.equal(authorizeArmedDelivery(kind,pushEnv,pushEvent,kst('16:19:59')).allowed,false);
   assert.equal(authorizeArmedDelivery(kind,pushEnv,pushEvent,kst('17:00:00')).allowed,true,
     'pre-armed push remains approved once 17:00 has arrived');
   assert.equal(authorizeArmedDelivery(kind,{...pushEnv,
     TELEGRAM_CLOSE_SENTINEL_VERIFIED:'false'},pushEvent,kst(arm)).allowed,false);
   assert.equal(authorizeArmedDelivery(kind,pushEnv,{...pushEvent,
     ref:'refs/heads/feature'},kst(arm)).allowed,false);
   assert.equal(authorizeArmedDelivery(kind,pushEnv,{...pushEvent,
     repository:{full_name:'other/repo'}},kst(arm)).allowed,false);
   assert.equal(authorizeArmedDelivery(kind,{...pushEnv,GITHUB_RUN_ATTEMPT:'2'},
     pushEvent,kst(arm)).allowed,false);
   // Exercise the REAL waitUntilPunctualWindow production function across
   // 17:00: the first version incorrectly revoked authorization at target.
   let pushNow=kst(arm).getTime(),pushTicks=0;
   const actual=await waitUntilPunctualWindow('close',{
     env:pushEnv,event:pushEvent,now:()=>new Date(pushNow),
     sleep:async ms=>{pushNow+=ms;pushTicks++;}
   });
   assert.equal(actual.ready,true,'verified push must reach 17:00');
   assert.equal(actual.reason,'ARM_TARGET_REACHED');
   assert.equal(pushNow,kst('17:00:00').getTime());
   assert.ok(pushTicks>0&&pushTicks<=270);
   const latePush=await waitUntilPunctualWindow('close',{
     env:pushEnv,event:pushEvent,now:()=>kst('17:00:00')
   });
   assert.equal(latePush.ready,false,'a NEW push cannot start after target');
   assert.equal(latePush.reason,'ARM_PUSH_TOO_LATE');
 }

 assert.equal(authorizeArmedDelivery(kind,env,event(kind),kst(arm,'2026-11-01')).allowed,false,
  'closed Korean session cannot arm');
 for(const override of [
  {GITHUB_EVENT_NAME:'push'},{GITHUB_REF:'refs/heads/feature'},
  {GITHUB_REPOSITORY:'attacker/fork'},{GITHUB_RUN_ATTEMPT:'2'}
 ])assert.equal(authorizeArmedDelivery(kind,{...env,...override},event(kind),kst(arm)).allowed,false,
  'wrong event/ref/repo/attempt cannot run');
 for(const ev of [
  {...event(kind),schedule:'0 * * * *'},
  {...event(kind),repository:{full_name:'fork/other'}},
  {}
 ])assert.equal(authorizeArmedDelivery(kind,env,ev,kst(arm)).allowed,false,
  'unrecognized cron or repo must be rejected');
 let ticks=0,clockNow=kst(arm).getTime();
 const r=await waitUntilPunctualWindow(kind,{env,event:event(kind),now:()=>new Date(clockNow),
  sleep:async ms=>{assert.ok(ms>0&&ms<=10000);clockNow+=ms;ticks++;}});
 assert.equal(r.ready,true);
 assert.equal(r.date,date);
 assert.equal(r.reason,'ARM_TARGET_REACHED');
 assert.equal(clockNow,kst(target).getTime(),'must not enter delivery pipeline before target');
 assert.ok(ticks>0&&ticks<=270);
 assert.equal(await waitUntilPunctualWindow(kind,{env,event:event(kind),now:()=>kst(cutoff)}).then(x=>x.ready),false);
 const late=await waitUntilPunctualWindow(kind,{env,event:event(kind),now:()=>kst(last),
  sleep:async()=>assert.fail('late runner should not sleep')});
 assert.equal(late.ready,true,'late runner within original window may make one recovery attempt');
}
assert.equal(scheduledWindow(kst('07:39:59')).allowed,false);
assert.equal(scheduledWindow(kst('07:40:00')).allowed,true);
assert.equal(scheduledWindow(kst('08:10:00')).allowed,false);
assert.equal(closeWindow(kst('16:59:59')).allowed,false);
assert.equal(closeWindow(kst('17:00:00')).allowed,true);
assert.equal(closeWindow(kst('17:30:00')).allowed,true);
assert.equal(closeWindow(kst('17:59:59')).allowed,true);
assert.equal(closeWindow(kst('18:00:00')).allowed,false);

const checks=[
 {file:'telegram-morning-punctual-arm.yml',kind:'morning',cron:'20 22 * * 0-4',
  group:'telegram-morning-briefing',script:'telegram-morning-workflow.mjs',root:'.telegram-runtime'},
 {file:'telegram-close-punctual-arm.yml',kind:'close',cron:'35 7 * * 1-5',
  group:'telegram-close-briefing',script:'telegram-close-workflow.mjs',root:'.telegram-close-runtime'}
];
for(const c of checks){
 const src=fs.readFileSync('.github/workflows/'+c.file,'utf8');
 const y=YAML.parse(src),j=y.jobs.armed,steps=j.steps;
 if(c.kind==='close'){
   assert.deepEqual(Object.keys(y.on),['schedule','workflow_dispatch','push']);
   assert.deepEqual(y.on.push,{branches:['main'],paths:['ops/telegram-close-arm-trigger.txt']});
   assert.match(j.if,/github\.event_name == 'push'/);
   const verify=steps.find(step=>step.id==='verify_sentinel');
   const waiting=steps.find(step=>step.id==='arm');
   assert.ok(verify&&steps.indexOf(verify)<steps.indexOf(waiting),
     'verify the exact single-file push before arming');
   assert.equal(verify.if,"github.event_name == 'push'");
   assert.match(String(verify.env.PUSH_BEFORE||''),/github[.]event[.]before/);
   assert.match(verify.run,/git diff --name-only HEAD\^ HEAD/);
   assert.match(verify.run,/CLOSE_SENTINEL_MULTI_COMMIT_REJECTED/);
   assert.match(verify.run,/CLOSE_SENTINEL_FILE_MODE_UNVERIFIED/);
   assert.ok(String(waiting.env.TELEGRAM_CLOSE_SENTINEL_VERIFIED||'')
     .includes('steps.verify_sentinel.outputs.verified'));
   assert.equal(steps.find(step=>step.uses==='actions/checkout@v7').with['fetch-depth'],2);
 }else assert.deepEqual(Object.keys(y.on),['schedule','workflow_dispatch'],
  'morning schedule/dispatch only; never push');
 assert.deepEqual(y.on.schedule,[{cron:c.cron}]);
 assert.equal(y.concurrency.group,c.group,'share original dated claim concurrency group');
 assert.equal(y.concurrency['cancel-in-progress'],false);
 assert.equal(y.concurrency.queue,'max','all fallback workflows must retain pending runs instead of replacing them');
 assert.equal(j.environment,'portfolio-production-gas');
 assert.equal(j['runs-on'],'ubuntu-latest');
 assert.ok(j['timeout-minutes']>=30&&j['timeout-minutes']<=50);
 assert.match(j.if,/github\.run_attempt == 1/);
 if(c.kind==='morning'){
   const warm=steps.find(s=>s.name?.startsWith('Prefetch verified 06:00 NH night'));
   const warmIndex=steps.indexOf(warm),armedIndex=steps.findIndex(s=>s.id==='arm');
   assert.ok(warmIndex>1&&warmIndex<armedIndex);
   assert.equal(warm.run,'node scripts/telegram-morning-prefetch.mjs');
   assert.ok(String(warm.env.GAS_ACCESS_TOKEN||'').includes('secrets.GAS_ACCESS_TOKEN'));
   assert.ok(String(warm.env.GAS_WEB_APP_URL||'').includes('vars.GAS_WEB_APP_URL'));
   assert.equal(warm.env.TELEGRAM_BOT_TOKEN,undefined);
   const source=fs.readFileSync('scripts/telegram-morning-prefetch.mjs','utf8');
   assert.ok(source.includes('PREFETCH_NOT_VERIFIED'));
   assert.ok(!source.includes('GITHUB_OUTPUT'));
 }
 assert.equal(steps.find(s=>s.id==='arm').run,'node scripts/telegram-punctual-arm.mjs '+c.kind);
 assert.equal(steps.find(s=>s.id==='prepare').run,'node scripts/'+c.script+' prepare');
 assert.equal(steps.find(s=>s.id==='prepare').env.GAS_ACCESS_TOKEN,'$'+'{{ secrets.GAS_ACCESS_TOKEN }}');
 assert.equal(steps.find(s=>s.id==='prepare').env.TELEGRAM_BOT_TOKEN,undefined);
 const send=steps.find(s=>s.name?.includes('Send exactly one claimed'));
 assert.equal(send.run,'node scripts/'+c.script+' send');
 assert.equal(send.env.TELEGRAM_BOT_TOKEN,'$'+'{{ secrets.TELEGRAM_BOT_TOKEN }}');
 assert.equal(send.env.GAS_ACCESS_TOKEN,undefined);
 if(c.kind==='morning'){
   const dispatchMode="${{ github.event_name == 'workflow_dispatch' && 'rescue' || '' }}";
   assert.equal(steps.find(s=>s.id==='prepare').env.TELEGRAM_DISPATCH_MODE,dispatchMode,
     'dispatched morning prepare needs explicit guarded rescue mode');
   assert.equal(send.env.TELEGRAM_DISPATCH_MODE,dispatchMode,
     'dispatched morning send must match the prepared rescue mode');
 }else{
   assert.equal(send.env.TELEGRAM_DISPATCH_MODE,undefined,
     'closing needs no morning dispatch mode');
 }
 assert.equal(send.if,"steps.prepare.outputs.ready == 'true'");
 assert.equal(steps.find(s=>s.name?.includes('Claim original dated')).with.path,c.root+'/claim.json');
 assert.equal(steps.find(s=>s.name?.includes('SENT proof')).with.path,c.root+'/sent.json');
 assert.equal(steps.filter(s=>s.uses?.startsWith('actions/upload-artifact@')).length,2);
 assert.equal(src.includes('sendMessage'),false,'never bypass production Telegram API guard');
}

// GitHub default pending queue is 'single', which cancels the previous
// pending workflow. All recurring workflows in these shared delivery groups
// must opt in to queue:max, including regular workflows and early-arm backups.
// Different-day queued work still fails the original clock/claim gates.
for(const [file,group] of [
 ['telegram-morning-briefing.yml','telegram-morning-briefing'],
 ['telegram-close-briefing.yml','telegram-close-briefing']
]){
 const raw=fs.readFileSync('.github/workflows/'+file,'utf8');
 const y=YAML.parse(raw);
 assert.equal(y.concurrency.group,group);
 assert.equal(y.concurrency['cancel-in-progress'],false);
 assert.equal(y.concurrency.queue,'max','regular scheduled briefing must not cancel queued failover');
 assert.ok(y.on.schedule?.length>=4,'retain existing fallback slots');
 assert.ok(y.jobs,'retain protected delivery job');
}

const sandbox=fs.mkdtempSync(join(tmpdir(),'telegram-arm-event-'));
try{
 const eventPath=join(sandbox,'event.json');
 fs.writeFileSync(eventPath,JSON.stringify(event('morning')));
 const e={...process.env,...env,GITHUB_EVENT_PATH:eventPath};
 for(const kind of ['morning','close']){
  const out=spawnSync(process.execPath,['scripts/telegram-punctual-arm.mjs',kind],
   {cwd:process.cwd(),env:{...e,GITHUB_EVENT_NAME:'push'},encoding:'utf8',timeout:5000});
  assert.equal(out.status,0);
  assert.match(out.stdout,/ARM_AUTH_OR_SESSION_REJECTED/);
 }
}finally{fs.rmSync(sandbox,{recursive:true,force:true});}
console.log('TELEGRAM_EARLY_ARM_PASS scheduled/external dispatch same KST gates, cancel/claim/SENT protection');
+'{{ github.event.before }}');
   assert.match(verify.run,/git diff --name-only HEAD\^ HEAD/);
   assert.match(verify.run,/CLOSE_SENTINEL_MULTI_COMMIT_REJECTED/);
   assert.match(verify.run,/CLOSE_SENTINEL_FILE_MODE_UNVERIFIED/);
   assert.ok(String(waiting.env.TELEGRAM_CLOSE_SENTINEL_VERIFIED||'')
     .includes('steps.verify_sentinel.outputs.verified'));
   assert.equal(steps.find(step=>step.uses==='actions/checkout@v7').with['fetch-depth'],2);
 }else assert.deepEqual(Object.keys(y.on),['schedule','workflow_dispatch'],
  'morning schedule/dispatch only; never push');
 assert.deepEqual(y.on.schedule,[{cron:c.cron}]);
 assert.equal(y.concurrency.group,c.group,'share original dated claim concurrency group');
 assert.equal(y.concurrency['cancel-in-progress'],false);
 assert.equal(y.concurrency.queue,'max','all fallback workflows must retain pending runs instead of replacing them');
 assert.equal(j.environment,'portfolio-production-gas');
 assert.equal(j['runs-on'],'ubuntu-latest');
 assert.ok(j['timeout-minutes']>=30&&j['timeout-minutes']<=50);
 assert.match(j.if,/github\.run_attempt == 1/);
 if(c.kind==='morning'){
   const warm=steps.find(s=>s.name?.startsWith('Prefetch verified 06:00 NH night'));
   const warmIndex=steps.indexOf(warm),armedIndex=steps.findIndex(s=>s.id==='arm');
   assert.ok(warmIndex>1&&warmIndex<armedIndex);
   assert.equal(warm.run,'node scripts/telegram-morning-prefetch.mjs');
   assert.ok(String(warm.env.GAS_ACCESS_TOKEN||'').includes('secrets.GAS_ACCESS_TOKEN'));
   assert.ok(String(warm.env.GAS_WEB_APP_URL||'').includes('vars.GAS_WEB_APP_URL'));
   assert.equal(warm.env.TELEGRAM_BOT_TOKEN,undefined);
   const source=fs.readFileSync('scripts/telegram-morning-prefetch.mjs','utf8');
   assert.ok(source.includes('PREFETCH_NOT_VERIFIED'));
   assert.ok(!source.includes('GITHUB_OUTPUT'));
 }
 assert.equal(steps.find(s=>s.id==='arm').run,'node scripts/telegram-punctual-arm.mjs '+c.kind);
 assert.equal(steps.find(s=>s.id==='prepare').run,'node scripts/'+c.script+' prepare');
 assert.equal(steps.find(s=>s.id==='prepare').env.GAS_ACCESS_TOKEN,'$'+'{{ secrets.GAS_ACCESS_TOKEN }}');
 assert.equal(steps.find(s=>s.id==='prepare').env.TELEGRAM_BOT_TOKEN,undefined);
 const send=steps.find(s=>s.name?.includes('Send exactly one claimed'));
 assert.equal(send.run,'node scripts/'+c.script+' send');
 assert.equal(send.env.TELEGRAM_BOT_TOKEN,'$'+'{{ secrets.TELEGRAM_BOT_TOKEN }}');
 assert.equal(send.env.GAS_ACCESS_TOKEN,undefined);
 if(c.kind==='morning'){
   const dispatchMode="${{ github.event_name == 'workflow_dispatch' && 'rescue' || '' }}";
   assert.equal(steps.find(s=>s.id==='prepare').env.TELEGRAM_DISPATCH_MODE,dispatchMode,
     'dispatched morning prepare needs explicit guarded rescue mode');
   assert.equal(send.env.TELEGRAM_DISPATCH_MODE,dispatchMode,
     'dispatched morning send must match the prepared rescue mode');
 }else{
   assert.equal(send.env.TELEGRAM_DISPATCH_MODE,undefined,
     'closing needs no morning dispatch mode');
 }
 assert.equal(send.if,"steps.prepare.outputs.ready == 'true'");
 assert.equal(steps.find(s=>s.name?.includes('Claim original dated')).with.path,c.root+'/claim.json');
 assert.equal(steps.find(s=>s.name?.includes('SENT proof')).with.path,c.root+'/sent.json');
 assert.equal(steps.filter(s=>s.uses?.startsWith('actions/upload-artifact@')).length,2);
 assert.equal(src.includes('sendMessage'),false,'never bypass production Telegram API guard');
}

// GitHub default pending queue is 'single', which cancels the previous
// pending workflow. All recurring workflows in these shared delivery groups
// must opt in to queue:max, including regular workflows and early-arm backups.
// Different-day queued work still fails the original clock/claim gates.
for(const [file,group] of [
 ['telegram-morning-briefing.yml','telegram-morning-briefing'],
 ['telegram-close-briefing.yml','telegram-close-briefing']
]){
 const raw=fs.readFileSync('.github/workflows/'+file,'utf8');
 const y=YAML.parse(raw);
 assert.equal(y.concurrency.group,group);
 assert.equal(y.concurrency['cancel-in-progress'],false);
 assert.equal(y.concurrency.queue,'max','regular scheduled briefing must not cancel queued failover');
 assert.ok(y.on.schedule?.length>=4,'retain existing fallback slots');
 assert.ok(y.jobs,'retain protected delivery job');
}

const sandbox=fs.mkdtempSync(join(tmpdir(),'telegram-arm-event-'));
try{
 const eventPath=join(sandbox,'event.json');
 fs.writeFileSync(eventPath,JSON.stringify(event('morning')));
 const e={...process.env,...env,GITHUB_EVENT_PATH:eventPath};
 for(const kind of ['morning','close']){
  const out=spawnSync(process.execPath,['scripts/telegram-punctual-arm.mjs',kind],
   {cwd:process.cwd(),env:{...e,GITHUB_EVENT_NAME:'push'},encoding:'utf8',timeout:5000});
  assert.equal(out.status,0);
  assert.match(out.stdout,/ARM_AUTH_OR_SESSION_REJECTED/);
 }
}finally{fs.rmSync(sandbox,{recursive:true,force:true});}
console.log('TELEGRAM_EARLY_ARM_PASS scheduled/external dispatch same KST gates, cancel/claim/SENT protection');
