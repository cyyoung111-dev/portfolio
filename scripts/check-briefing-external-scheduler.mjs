import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CONFIG,authorizeScheduledDispatch,dispatchProtectedWorkflow}
 from '../ops/briefing-external-scheduler/worker.mjs';

const morning='20 22 * * SUN-THU';
const closing='35 7 * * MON-FRI';
const ctrl=(cron,iso)=>({cron,scheduledTime:Date.parse(iso)});
const at=iso=>new Date(iso);
const mr=ctrl(morning,'2026-11-02T22:20:00.000Z'); // 11/03 Tue 07:20 KST
const cl=ctrl(closing,'2026-11-03T07:35:00.000Z'); // 11/03 Tue 16:35 KST

assert.deepEqual(Object.keys(CONFIG),[morning,closing]);
assert.deepEqual(authorizeScheduledDispatch(mr,at('2026-11-02T22:20:01Z')),
 {allowed:true,workflow:'telegram-morning-punctual-arm.yml',kstDate:'2026-11-03'});
assert.deepEqual(authorizeScheduledDispatch(cl,at('2026-11-03T07:35:01Z')),
 {allowed:true,workflow:'telegram-close-punctual-arm.yml',kstDate:'2026-11-03'});
// Entire weekday mapping: Sunday UTC is Monday morning KST, not Sunday.
const monday=ctrl(morning,'2026-11-01T22:20:00Z');
assert.equal(authorizeScheduledDispatch(monday,at('2026-11-01T22:20:00Z')).allowed,true);
const weekend=ctrl(morning,'2026-10-31T22:20:00Z');
assert.equal(authorizeScheduledDispatch(weekend,at('2026-10-31T22:20:01Z')).allowed,false);
// No arbitrary cron, wrong UTC hour, nonintegral/non-time scheduler payload.
for(const invalid of [
 {cron:'* * * * *',scheduledTime:mr.scheduledTime},
 {cron:morning,scheduledTime:Date.parse('2026-11-03T22:20:00Z')}, // incorrect date relative to now
 {cron:morning,scheduledTime:Date.parse('2026-11-02T22:21:00Z')},
 {cron:morning,scheduledTime:mr.scheduledTime+1000},
 {cron:morning,scheduledTime:'2026-11-02T22:20:00Z'},
 {cron:morning,scheduledTime:Infinity},
 {}
])assert.equal(authorizeScheduledDispatch(invalid,at('2026-11-02T22:20:01Z')).allowed,false);
for(const invalidNow of [
 '2026-11-02T22:19:59.999Z',
 '2026-11-02T22:30:00.000Z',
 '2026-11-03T22:20:02Z',
 'not-a-date'
])assert.equal(authorizeScheduledDispatch(mr,at(invalidNow)).allowed,false,
 'expired/future/cross-day must fail closed: '+invalidNow);
assert.equal(authorizeScheduledDispatch(mr,at('2026-11-02T22:29:59.999Z')).allowed,true);

let calls=0;
const token='SYNTHETIC_NOT_A_REAL_GITHUB_TOKEN_VALUE_012345678901';
const env={DISPATCH_ENABLED:'true',GITHUB_DISPATCH_TOKEN:token};
const makeFetch=status=>async(url,opts)=>{
 calls++;
 assert.equal(url,
   'https://api.github.com/repos/cyyoung111-dev/portfolio/actions/workflows/'+
   'telegram-morning-punctual-arm.yml/dispatches');
 assert.equal(opts.method,'POST');
 assert.equal(opts.redirect,'manual',
   'Workers only supports manual/follow; redirects must not forward auth');
 assert.equal(opts.headers.Authorization,'Bearer '+token);
 assert.equal(opts.headers.Accept,'application/vnd.github+json');
 assert.equal(opts.headers['User-Agent'],'cyyoung111-portfolio-briefing-dispatcher');
 assert.equal(opts.headers['Content-Type'],'application/json');
 assert.deepEqual(JSON.parse(opts.body),{ref:'main'});
 assert.ok(opts.signal);
 return {status};
};
const run=(ctl,settings,fetchImpl,now=at('2026-11-02T22:20:02Z'))=>
 dispatchProtectedWorkflow(ctl,settings,{now:()=>now,fetchImpl});
assert.deepEqual(await run(mr,env,makeFetch(204)),{
 status:'DISPATCH_ACCEPTED',workflow:'telegram-morning-punctual-arm.yml',date:'2026-11-03'
});
assert.deepEqual(await run(mr,env,makeFetch(200)),{
 status:'DISPATCH_ACCEPTED',workflow:'telegram-morning-punctual-arm.yml',date:'2026-11-03'
});
assert.equal(calls,2);
assert.deepEqual(await run(mr,{...env,DISPATCH_ENABLED:'false'},makeFetch(204)),{status:'DISABLED'});
assert.deepEqual(await run(mr,{...env,GITHUB_DISPATCH_TOKEN:'bad'},makeFetch(204)),{status:'CONFIG_UNVERIFIED'});
assert.deepEqual(await run({cron:'unknown',scheduledTime:mr.scheduledTime},env,makeFetch(204)),{
 status:'SKIPPED',reason:'UNTRUSTED_EVENT'
});
assert.equal(calls,2,'inert, invalid and disabled runs must not fetch');
assert.deepEqual(await run(mr,env,makeFetch(403)),{status:'GITHUB_DISPATCH_REJECTED'});
assert.deepEqual(await run(mr,env,makeFetch(301)),{status:'GITHUB_DISPATCH_REJECTED'},
 'GitHub API redirect must not be followed with Bearer token');
assert.deepEqual(await run(mr,env,makeFetch(302)),{status:'GITHUB_DISPATCH_REJECTED'});
assert.deepEqual(await run(mr,env,makeFetch(307)),{status:'GITHUB_DISPATCH_REJECTED'});
assert.deepEqual(await run(mr,env,makeFetch(308)),{status:'GITHUB_DISPATCH_REJECTED'});
assert.equal((await run(mr,env,async()=>{throw Error('TOKEN_SHOULD_NOT_LEAK');})).status,
 'GITHUB_NETWORK_UNVERIFIED');

const worker=(await import('../ops/briefing-external-scheduler/worker.mjs')).default;
const rejection=worker.fetch(new Request('https://example.com/public-dispatch'));
assert.equal(rejection.status,404);
assert.equal(rejection.headers.has('location'),false);

const config=fs.readFileSync('ops/briefing-external-scheduler/wrangler.toml','utf8');
assert.match(config,/workers_dev = false/);
assert.match(config,/preview_urls = false/);
assert.ok(config.includes('"20 22 * * SUN-THU"'));
assert.ok(config.includes('"35 7 * * MON-FRI"'));
assert.ok(!config.includes('GITHUB_DISPATCH_TOKEN')&&
 !config.includes('DISPATCH_ENABLED = true'),
 'credentials and production activation cannot live in committed configuration');

const source=fs.readFileSync('ops/briefing-external-scheduler/worker.mjs','utf8');
assert.doesNotMatch(source,/sendTelegram|NHPLUG_APP_KEY|GAS_ACCESS_TOKEN|saveSnapshot|savePriceHistory/);
assert.doesNotMatch(source,/console[.]log\([^\n]*(?:Authorization|token)/);
console.log('EXTERNAL_SCHEDULER_CONTRACT_PASS: UTC->KST weekdays, fail closed, readonly dispatch, no public HTTP');
