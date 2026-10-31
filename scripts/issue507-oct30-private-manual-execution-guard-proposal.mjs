// #507 source-only Apps Script PRIVATE MANUAL EXECUTION GATE PROPOSAL.
// This is intentionally NOT injected into src/gas/apps_script.gs, doPost,
// doGet, an Actions workflow, or any scheduled trigger.
// No production deployment, credential provisioning, or sheet writes.
export const PRIVATE_RUN_GAS_FUNCTION=String.raw`
function _issue507Oct30GuardedPrivateReadOnlyRun_(opts) {
  // Fail CLOSED even when the legacy common _isAuthorizedRequest() returns
  // true if the configured access_token is missing. Do not add a web route.
  function deny() { throw new Error('ISSUE507_OCT30_PRIVATE_EXECUTION_DENIED'); }
  if (!opts || typeof opts !== 'object' || Array.isArray(opts)) deny();
  var keys=Object.keys(opts).sort();
  if(keys.join(',')!=='proofKey,purpose,targetDate')deny();
  if(opts.purpose!=='ISSUE507_OCT30_PRIVATE_SOURCE_ONLY'
      ||opts.targetDate!=='2026-10-30')deny();
  var props=PropertiesService.getScriptProperties();
  if(!props || typeof props.getProperty!=='function')deny();
  // Distinct from the existing legacy access_token. Never accept an
  // unspecified/empty legacy token, even if _isAuthorizedRequest() would.
  var legacy=String(props.getProperty('access_token')||'').trim();
  var enabled=String(props.getProperty('issue507_oct30_private_probe_enabled')||'');
  var secret=String(props.getProperty('issue507_oct30_private_probe_secret')||'');
  var expiryText=String(props.getProperty('issue507_oct30_private_probe_expires_at_ms')||'');
  var now=Date.now();
  var deadline=Number(expiryText);
  if(!legacy ||enabled!=='true'||secret.length<32||secret.length>256
      ||!/^\d{13}$/.test(expiryText)||!isFinite(deadline)
      ||!isFinite(now)||deadline<=now||deadline-now>600000)deny();
  var provided=typeof opts.proofKey==='string'?opts.proofKey:'';
  if(provided.length!==secret.length)deny();
  var mismatch=0;
  for(var i=0;i<secret.length;i++)
    mismatch|=secret.charCodeAt(i)^provided.charCodeAt(i);
  if(mismatch!==0)deny();
  // No access to arbitrary data, no apply flag, no code argument,
  // and no write mode. Return the inner function's counts-only proof.
  var result=_issue507Oct30PrivateLiveReadOnlyProof_();
  if(!result||result.status!=='SOURCE_ONLY_PRIVATE_PROOF'
      ||result.date!=='2026-10-30'
      ||result.officialExactDatePerCodeVerified!==37
      ||result.noIndividualQuoteOrCodeDisclosed!==true
      ||result.writeAuthorized!==false||result.financialWrites!==0)
    deny();
  return {
    mode:'ISSUE507_OCT30_PRIVATE_MANUAL_ATTESTATION',
    date:'2026-10-30',verifiedHeldCodes:37,
    officialExactDateProof:true,
    authenticatedPrivateInvocation:true,
    userApprovedLiveDeployment:false,
    privateExecutionPathOnly:true,
    physicalBackupVerified:false,
    originalFinancialWrites:0,writeAuthorized:false,
    releaseAuthorized:false,gasDeployedByThisCall:false
  };
}
`;
