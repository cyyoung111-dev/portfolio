// A deterministic in-memory release preview. NO disk writes or deployment.
import {createHash} from 'node:crypto';
import {prepareIssue507Runtime} from './prepare-issue507-runtime-integration.mjs';
import {extractExpectedGasVersion,gasSourceBlobSha} from './deploy-gas.mjs';

const FROM_VERSION='9.281';
const TO_VERSION='9.282';
const sha256=x=>createHash('sha256').update(x).digest('hex');

export function prepareIssue507ProposedRelease(options={}) {
  const {candidate:staged,manifest:original}=prepareIssue507Runtime(options);
  if(extractExpectedGasVersion(staged)!==FROM_VERSION) throw Error('ISSUE507_BASE_VERSION_CHANGED');
  if(!staged.includes('var ISSUE507_GATE_RELEASE_ID=\''+original.releaseId+'\';'))
    throw Error('ISSUE507_RELEASE_ID_MISSING');

  // Exactly the production header and every explicit GAS response contract
  // must move together. Never replace historical comments indiscriminately.
  const header=/(Google Apps Script\s+v)9\.281\b/;
  if(!header.test(staged)) throw Error('ISSUE507_GAS_HEADER_MISSING');
  const versionPattern=/(gasVersion\s*:\s*['"])9\.281(?=['"])/g;
  const previousVersionRefs=[...staged.matchAll(versionPattern)].length;
  if(previousVersionRefs<1) throw Error('ISSUE507_GAS_RESPONSE_VERSION_MISSING');
  const updated=staged
    .replace(header,(_match,prefix)=>prefix+TO_VERSION)
    .replace(versionPattern,(_match,prefix)=>prefix+TO_VERSION);
  if(extractExpectedGasVersion(updated)!==TO_VERSION)throw Error('ISSUE507_GAS_VERSION_INCONSISTENT');
  if(/gasVersion\s*:\s*['"]9\.281['"]/.test(updated))
    throw Error('ISSUE507_OLD_RESPONSE_VERSION_LEFT');

  // Bind each proposed release to the precise original candidate, and a
  // distinct new version, not to a stale 9.281 rollout attestation.
  const releaseId=sha256(['issue507-integrated-v1',TO_VERSION,original.candidateSha256,original.releaseId].join('\n'));
  const oldDeclaration="var ISSUE507_GATE_RELEASE_ID='"+original.releaseId+"';";
  if(updated.split(oldDeclaration).length!==2)throw Error('ISSUE507_RELEASE_DECLARATION_SCOPE');
  const candidate=updated.replace(oldDeclaration,"var ISSUE507_GATE_RELEASE_ID='"+releaseId+"';");
  return {
    candidate,
    manifest:{
      status:'REVIEW_ONLY',
      baseVersion:FROM_VERSION,
      proposedVersion:TO_VERSION,
      gasResponseFieldCount:previousVersionRefs,
      entrypointCount:original.entrypointCount,
      releaseId,
      candidateSha256:sha256(candidate),
      candidateGitBlob:gasSourceBlobSha(candidate),
      deployable:false,
      productionSourceChanged:false,
      webVersionChanged:false,
      deploymentApprovalAdded:false,
      financeWriteAuthorized:false,
      operatorEvidenceVerified:false,
    },
  };
}
