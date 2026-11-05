import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('ops/briefing-gas-scheduler/Code.gs','utf8');
assert.doesNotMatch(source,/SpreadsheetApp\.|DriveApp\.|GmailApp\.|MailApp\./);
assert.doesNotMatch(source,/\/exec['"`]|api\.telegram\.org/);
assert.match(source,/everyMinutes\(5\)/);

function environment(){
  const values=new Map([['BRIEFING_CLOCK_GH_TOKEN','github_pat_'+'x'.repeat(60)],
    ['BRIEFING_CLOCK_ENABLED','true']]);
  const available=new Set(),calls=[],logs=[],triggers=[];
  let getStatus=200,postStatus=204,networkError=false,lockState=false;
  const props={
    getProperty:k=>values.get(k)||null,
    setProperty:(k,v)=>{values.set(k,String(v));return props;}
  };
  const context={
    Date,JSON,Number,Object,Array,Error,encodeURIComponent,RegExp,
    Utilities:{formatDate:(date,zone,pattern)=>{
      assert.equal(zone,'Asia/Seoul');
      assert.equal(pattern,'yyyy-MM-dd HH:mm');
      const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:zone,
        year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',
        hourCycle:'h23'}).formatToParts(date).map(x=>[x.type,x.value]));
      return p.year+'-'+p.month+'-'+p.day+' '+p.hour+':'+p.minute;
    }},
    PropertiesService:{getScriptProperties:()=>props},
    LockService:{getScriptLock:()=>({tryLock:()=>{if(lockState)return false;lockState=true;return true;},
      releaseLock:()=>{lockState=false;}})},
    Logger:{log:x=>logs.push(x)},
    ScriptApp:{getProjectTriggers:()=>triggers,
      newTrigger:handler=>({timeBased:()=>({everyMinutes:n=>({create:()=>{
        assert.equal(n,5);const t={getHandlerFunction:()=>handler};triggers.push(t);return t;
      }})})}),
      deleteTrigger:t=>{const i=triggers.indexOf(t);if(i>=0)triggers.splice(i,1);}
    },
    UrlFetchApp:{fetch:(url,opt)=>{
      calls.push({url,opt});
      if(networkError)throw Error('simulated_network');
      if(opt.method==='get'){
        assert.match(url,/^https:\/\/api\.github\.com\/repos\/cyyoung111-dev\/portfolio\/actions\/artifacts\?/);
        const name=new URL(url).searchParams.get('name');
        const artifacts=available.has(name)?[{name,expired:false}]:[];
        return {getResponseCode:()=>getStatus,getContentText:()=>JSON.stringify({
          total_count:artifacts.length,artifacts
        })};
      }
      assert.equal(opt.method,'post');
      assert.match(url,/\/actions\/workflows\/telegram-(morning|close)-punctual-arm\.yml\/dispatches$/);
      assert.deepEqual(JSON.parse(opt.payload),{ref:'main'});
      assert.equal(opt.followRedirects,false);
      assert.ok(opt.headers.Authorization.startsWith('Bearer github_pat_'));
      return {getResponseCode:()=>postStatus,getContentText:()=>''};
    }}
  };
  vm.createContext(context);
  vm.runInContext(source,context,{filename:'Code.gs'});
  const at=(day,time)=>new Date(day+'T'+time+':00+09:00');
  const tick=(day,time)=>context.bcTick_(at(day,time));
  return {values,available,calls,logs,context,triggers,tick,
    failGet:(v)=>{getStatus=v;},failPost:(v)=>{postStatus=v;},
    failNetwork:v=>{networkError=v;},
    dispatched:()=>calls.filter(x=>x.opt.method==='post').length};
}
{
  const x=environment();
  assert.equal(x.tick('2026-11-05','06:00'),'OUTSIDE_WINDOW');
  assert.equal(x.tick('2026-11-07','07:25'),'WEEKEND');
  assert.equal(x.calls.length,0,'outside window must never make HTTP calls');
  assert.equal(x.tick('2026-11-05','07:25'),'DISPATCH_ACCEPTED');
  assert.equal(x.dispatched(),1);
  assert.equal(x.tick('2026-11-05','07:30'),'ALREADY_DISPATCHED');
  assert.equal(x.dispatched(),1,'deduplicate primary slot');
  assert.equal(x.tick('2026-11-05','07:46'),'DISPATCH_ACCEPTED');
  assert.equal(x.dispatched(),2,'missing SENT should permit one guarded recovery');
  assert.equal(x.tick('2026-11-05','07:51'),'ALREADY_DISPATCHED');
  assert.equal(x.tick('2026-11-05','08:03'),'DISPATCH_ACCEPTED');
  assert.equal(x.dispatched(),3);
  assert.equal(x.tick('2026-11-05','08:09'),'OUTSIDE_WINDOW',
    'cutoff beyond last recovery prevents late dispatch');
  assert.equal(x.tick('2026-11-05','16:40'),'DISPATCH_ACCEPTED');
  assert.equal(x.dispatched(),4);
}
{
  const x=environment();
  x.available.add('telegram-morning-claim-2026-11-05-sent');
  assert.equal(x.tick('2026-11-05','07:24'),'ALREADY_SENT');
  assert.equal(x.dispatched(),0);
  assert.equal(x.tick('2026-11-05','08:16'),'SENT_CONFIRMED');
  assert.equal(x.tick('2026-11-05','08:19'),'MONITORED');
}
{
  const x=environment();
  x.available.add('telegram-morning-claim-2026-11-05');
  assert.equal(x.tick('2026-11-05','07:25'),'CLAIM_WITHOUT_SENT');
  assert.equal(x.tick('2026-11-05','07:45'),'CLAIM_WITHOUT_SENT');
  assert.equal(x.dispatched(),0,'ambiguous prior claim cannot be resent');
}
{
  const x=environment();
  x.failGet(503);
  assert.throws(()=>x.tick('2026-11-05','07:25'),/BC_ARTIFACT_QUERY_FAILED/);
  assert.equal(x.dispatched(),0,'no dispatch when artifact lookup fails');
  x.failGet(200);
  assert.equal(x.tick('2026-11-05','07:30'),'DISPATCH_ACCEPTED');
}
{
  const x=environment();
  x.failPost(403);
  assert.throws(()=>x.tick('2026-11-05','07:25'),/BC_GITHUB_DISPATCH_REJECTED/);
  assert.equal(x.dispatched(),1);
  x.failPost(204);
  assert.equal(x.tick('2026-11-05','07:30'),'DISPATCH_ACCEPTED');
  assert.equal(x.dispatched(),2,'failed attempt can be retried; GitHub claim controls send');
}
{
  const x=environment();
  assert.throws(()=>x.tick('2026-11-05','08:16'),/BC_MORNING_SENT_NOT_CONFIRMED/);
  assert.equal(x.tick('2026-11-05','08:19'),'MONITORED');
  assert.throws(()=>x.tick('2026-11-05','18:08'),/BC_CLOSE_SENT_NOT_CONFIRMED/);
  assert.equal(x.tick('2026-11-05','18:11'),'MONITORED');
}
{
  const x=environment();
  x.values.set('BRIEFING_CLOCK_ENABLED','false');
  assert.equal(x.tick('2026-11-05','07:25'),'DISABLED');
  assert.equal(x.calls.length,0,'disabled clock must never contact GitHub');
  assert.throws(()=>x.context.briefingClockInstall(),/BC_ENABLE_REQUIRED/);
  x.values.set('BRIEFING_CLOCK_ENABLED','true');
  assert.equal(x.context.briefingClockInstall().triggerCount,1);
  assert.equal(x.context.briefingClockInstall().triggerCount,1);
  assert.equal(x.triggers.length,1,'install is idempotent');
  assert.equal(x.context.briefingClockStatus().hasToken,true);
  assert.equal(x.context.briefingClockDisable().enabled,false);
  assert.equal(x.triggers.length,0);
  assert.equal(x.tick('2026-11-05','07:25'),'DISABLED');
}
{
  const x=environment();
  x.values.delete('BRIEFING_CLOCK_GH_TOKEN');
  assert.throws(()=>x.context.briefingClockInstall(),/BC_TOKEN_NOT_CONFIGURED/);
  assert.equal(x.triggers.length,0);
}
{
  // Production GAS's KRX calendar is the source of truth, not generic public holidays.
  const gas=fs.readFileSync('src/gas/apps_script.gs','utf8');
  const actual={};
  for(const match of gas.matchAll(/var KRX_CONFIRMED_CLOSED_DATES_(\d{4})\s*=\s*\{([\s\S]*?)\};/g)){
    actual[match[1]]=[...match[2].matchAll(/'(\d{4}-\d{2}-\d{2})'\s*:\s*1/g)].map(x=>x[1]);
  }
  const e=environment();
  assert.deepEqual(Object.keys(e.context.BC_KRX_CLOSED_DATES_).sort(),Object.keys(actual).sort(),
    'GAS clock must be refreshed when production KRX calendar adds a year');
  for(const year of Object.keys(actual)){
    assert.deepEqual(Array.from(e.context.BC_KRX_CLOSED_DATES_[year]).sort(),actual[year].sort(),
      'holiday calendar drift for '+year);
  }
  assert.equal(e.tick('2026-12-25','07:25'),'MARKET_CLOSED');
  assert.equal(e.tick('2026-12-25','08:16'),'MARKET_CLOSED');
  assert.equal(e.tick('2026-12-25','17:08'),'MARKET_CLOSED');
  assert.equal(e.tick('2026-12-25','18:08'),'MARKET_CLOSED');
  assert.equal(e.tick('2027-01-01','07:25'),'MARKET_CLOSED');
  assert.equal(e.calls.length,0,'holidays must never dispatch or raise missing-SENT alert');
  assert.throws(()=>e.tick('2028-01-03','07:25'),/BC_MARKET_CALENDAR_UNVERIFIED/);
  assert.equal(e.calls.length,0,'unknown calendar years must fail closed');
}
console.log('GAS independent 5-minute briefing clock: authorization, KST, weekends, retries, claims, SENT, alerts, install/disable PASS');
