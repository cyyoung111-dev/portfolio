// Source-only future GAS candidate. Never publish this file as the running GAS.
import {createHash} from 'node:crypto';
import {proposeNhDomesticCloseBatching} from './nh-domestic-close-batching-proposal.mjs';

const ORIGINAL = `if (options && options.requireAllKrx === true && (!closeVerification.required
            || closeVerification.date !== requestedCloseDate
            || closeVerification.confirmed !== closeVerification.expected))`;
const STRICT = `if (((_krxCalendarStatus_(requestedCloseDate) !== 'CLOSED' && closeVerification.required)
            || (options && options.requireAllKrx === true)) && (!closeVerification.required
            || closeVerification.date !== requestedCloseDate
            || closeVerification.confirmed !== closeVerification.expected))`;

function blobSha(source) {
  return createHash('sha1').update('blob '+Buffer.byteLength(source,'utf8')+'\0')
    .update(source,'utf8').digest('hex');
}

// The existing #956 candidate remains read-only. This second candidate changes
// only the acceptance policy for a genuinely OPEN Korean exchange session.
// Missing symbols go to ordinary deferred/watchdog recovery, never to a
// stale-price success receipt. Holidays retain their verified carry policy.
export function proposeNhDomesticCloseFullCoverage(source) {
  const batching=proposeNhDomesticCloseBatching(source); // exact frozen base SHA
  if (batching.candidate.split(ORIGINAL).length!==2)
    throw Error('NH_COMPLETE_TARGET_NOT_EXACT');
  const candidate=batching.candidate.replace(ORIGINAL,STRICT);
  return {
    candidate,baseSha:batching.baseSha,candidateSha:blobSha(candidate),
    modifiedFunctions:['fetchDomesticRegularCloses','saveDailyPriceHistory'],
    sourceOnly:true,gasDeployed:false,financialWritesAdded:false,
    regularSessionRequiresFullCloseCoverage:true,
    krxHolidayCarryPolicyUnchanged:true
  };
}
