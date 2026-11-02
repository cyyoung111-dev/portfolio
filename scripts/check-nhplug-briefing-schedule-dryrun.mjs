import assert from 'node:assert/strict';
import {BRIEFING_WINDOWS,kstWeekdayCron,proposedBriefingCrons,deliveryClaimKey,
  planBriefingAttempt,simulateBriefingAttempt} from './nhplug-briefing-schedule-dryrun.mjs';
import {krxSessionStatus} from './krx-session-calendar.mjs';

const date='2026-10-29';
const time=(hhmmss)=>date+'T'+hhmmss+'+09:00';
assert.equal(krxSessionStatus(date),'OPEN','do not assume a weekday alone is open');
assert.deepEqual(proposedBriefingCrons(),{
 MORNING:{target:'40 22 * * 0-4',fallback:'49 22 * * 0-4'},
 CLOSE:{target:'0 8 * * 1-5',fallback:'8 8 * * 1-5'}
});
assert.equal(kstWeekdayCron('07:40'),'40 22 * * 0-4');
assert.equal(kstWeekdayCron('07:49'),'49 22 * * 0-4');
assert.equal(kstWeekdayCron('17:00'),'0 8 * * 1-5');
assert.equal(kstWeekdayCron('17:08'),'8 8 * * 1-5');
assert.throws(()=>kstWeekdayCron('24:00'),/BRIEFING_CLOCK_INVALID/);
assert.throws(()=>kstWeekdayCron('7:30'),/BRIEFING_CLOCK_INVALID/);
assert.equal(BRIEFING_WINDOWS.MORNING.target,'07:40');
assert.equal(BRIEFING_WINDOWS.CLOSE.target,'17:00');
assert.equal(deliveryClaimKey('MORNING',date),'telegram-morning-claim-2026-10-29');
assert.equal(deliveryClaimKey('CLOSE',date),'telegram-close-claim-2026-10-29');
assert.notEqual(deliveryClaimKey('MORNING',date),deliveryClaimKey('CLOSE',date));
assert.throws(()=>deliveryClaimKey('CLOSE','2026-02-30'),/BRIEFING_CLAIM_INPUT_INVALID/);

const opts=(kind,asOf,extra={})=>({
 kind,now:new Date(time(asOf)),claimState:'ABSENT',payloadState:'VALID',
 lockHeld:true,attempt:1,...extra
});
const plan=(kind,at,extra)=>planBriefingAttempt(opts(kind,at,extra)).status;
for (const [kind,clock,status] of [
 ['MORNING','07:39:59','TOO_EARLY'],
 ['MORNING','07:40:00','READY_TO_CLAIM'],
 ['MORNING','07:50:00','READY_TO_CLAIM'],
 ['MORNING','08:00:00','READY_TO_CLAIM'],
 ['MORNING','08:09:59','READY_TO_CLAIM'],
 ['MORNING','08:10:00','TOO_LATE'],
 ['CLOSE','16:45:00','TOO_EARLY'],
 ['CLOSE','16:59:59','TOO_EARLY'],
 ['CLOSE','17:00:00','READY_TO_CLAIM'],
 ['CLOSE','17:08:00','READY_TO_CLAIM'],
 ['CLOSE','19:59:59','READY_TO_CLAIM'],
 ['CLOSE','20:00:00','TOO_LATE']
])assert.equal(plan(kind,clock),status,kind+' '+clock);
assert.equal(plan('MORNING','07:40:00',{attempt:2}),'ACTION_RERUN_BLOCKED');
assert.equal(plan('MORNING','07:40:00',{claimState:'CLAIMED'}),'ALREADY_CLAIMED');
assert.equal(plan('MORNING','07:40:00',{claimState:'UNKNOWN'}),'CLAIM_STATUS_UNVERIFIED');
assert.equal(plan('MORNING','07:40:00',{claimState:'ABSENT',lockHeld:false}),'NO_EXCLUSIVE_DELIVERY_OWNER');
assert.equal(plan('MORNING','07:40:00',{payloadState:'UNKNOWN'}),'PAYLOAD_NOT_READY');
assert.equal(plan('CLOSE','17:00:00',{payloadState:'INVALID'}),'PAYLOAD_NOT_READY');
assert.equal(planBriefingAttempt(opts('MORNING','07:40:00')).date,date);
assert.equal(planBriefingAttempt({...opts('MORNING','07:40:00'),now:new Date('2026-10-28T22:40:00.000Z')}).status,'READY_TO_CLAIM');

assert.equal(planBriefingAttempt({...opts('MORNING','07:40:00'),now:new Date('2026-10-09T07:30:00+09:00')}).status,'MARKET_CLOSED');
assert.equal(planBriefingAttempt({...opts('CLOSE','17:00:00'),now:new Date('2026-10-31T16:00:00+09:00')}).status,'MARKET_CLOSED');
assert.equal(planBriefingAttempt({...opts('CLOSE','17:00:00'),now:new Date('2028-10-30T16:00:00+09:00')}).status,'CALENDAR_UNVERIFIED');
assert.equal(planBriefingAttempt({...opts('MORNING','07:40:00'),now:'not a date'}).status,'TIME_INVALID');
assert.equal(planBriefingAttempt(opts('FUTURE','07:30:00')).status,'KIND_INVALID');

const morning=simulateBriefingAttempt({kind:'MORNING',now:time('07:40:00')});
assert.equal(morning.status,'SENT');assert.equal(morning.sendCalls,1);
assert.equal(morning.state.claims[deliveryClaimKey('MORNING',date)],'CONFIRMED');
const duplicated=simulateBriefingAttempt({kind:'MORNING',now:time('08:00:00'),state:morning.state});
assert.equal(duplicated.status,'ALREADY_CLAIMED');assert.equal(duplicated.sendCalls,0);
assert.deepEqual(duplicated.state,morning.state,'duplicate must not delete claimed date');

const close=simulateBriefingAttempt({kind:'CLOSE',now:time('17:00:00'),state:morning.state});
assert.equal(close.status,'SENT');assert.equal(close.sendCalls,1);
assert.equal(Object.keys(close.state.claims).length,2,'morning and close use independent claims');
const closeFallback=simulateBriefingAttempt({kind:'CLOSE',now:time('17:08:00'),state:close.state});
assert.equal(closeFallback.status,'ALREADY_CLAIMED');
assert.equal(closeFallback.sendCalls,0);

const waiting=simulateBriefingAttempt({kind:'MORNING',now:time('07:40:00'),payloadState:'INVALID'});
assert.equal(waiting.status,'PAYLOAD_NOT_READY');assert.equal(waiting.sendCalls,0);
assert.deepEqual(waiting.state.claims,{},'no claim if payload is unready');
const recovered=simulateBriefingAttempt({kind:'MORNING',now:time('08:00:00'),state:waiting.state,payloadState:'VALID'});
assert.equal(recovered.status,'SENT');
const sendTimeout=simulateBriefingAttempt({kind:'MORNING',now:time('07:40:00'),sendResult:'TIMEOUT'});
assert.equal(sendTimeout.status,'SEND_UNCONFIRMED_NO_AUTO_RETRY');
assert.equal(sendTimeout.sendCalls,1);
assert.equal(simulateBriefingAttempt({kind:'MORNING',now:time('08:00:00'),state:sendTimeout.state}).status,'ALREADY_CLAIMED');

const ackLost=simulateBriefingAttempt({kind:'MORNING',now:time('07:40:00'),claimResult:'ACK_LOST'});
assert.equal(ackLost.status,'CLAIM_UNCONFIRMED_NO_SEND');
assert.equal(ackLost.sendCalls,0);
assert.equal(ackLost.state.claims[deliveryClaimKey('MORNING',date)],'UNKNOWN');
assert.equal(simulateBriefingAttempt({kind:'MORNING',now:time('08:00:00'),state:ackLost.state}).status,'CLAIM_STATUS_UNVERIFIED');
const delayed=simulateBriefingAttempt({kind:'MORNING',now:time('08:11:00')});
assert.equal(delayed.status,'TOO_LATE');
assert.equal(delayed.sendCalls,0);
const unsafelyParallel=simulateBriefingAttempt({kind:'CLOSE',now:time('17:00:00'),lockHeld:false});
assert.equal(unsafelyParallel.status,'NO_EXCLUSIVE_DELIVERY_OWNER');
assert.equal(unsafelyParallel.sendCalls,0);
assert.equal(simulateBriefingAttempt({kind:'CLOSE',now:time('17:00:00'),attempt:2}).status,'ACTION_RERUN_BLOCKED');

console.log('NH morning 07:40 / close 17:00 schedule and durable-claim dry-run checks passed');
