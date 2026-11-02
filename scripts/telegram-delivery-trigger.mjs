const REPO='cyyoung111-dev/portfolio';
const UPSTREAM={
 morning:{'NH night reference capture':['.github/workflows/nh-night-capture.yml',['schedule']]},
 close:{
  'market-briefing-headless':['.github/workflows/market-briefing-headless.yml',['schedule','workflow_dispatch']],
  'gas-deploy':['.github/workflows/gas-deploy.yml',['workflow_run','workflow_dispatch']]
 }
};
// Completed workflows provide an extra opportunity, never a new delivery owner.
// All routes retain the original concurrency group and dated artifact claim.
export function deliveryTrigger(kind,env,event,withinWindow=false){
 if(!UPSTREAM[kind]||env.GITHUB_REPOSITORY!==REPO
  ||env.GITHUB_REF!=='refs/heads/main'||Number(env.GITHUB_RUN_ATTEMPT)!==1)
  throw Error('TELEGRAM_TRIGGER_INVALID');
 if(['schedule','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME))return true;
 if(kind==='close'&&env.GITHUB_EVENT_NAME==='push'
  &&event?.ref==='refs/heads/main'&&event?.repository?.full_name===REPO)
  // A workflow-file push outside the 17:00–17:30 KST window is a no-op.
  // The actual scheduled/dispatch delivery gates remain unchanged.
  return withinWindow===true;
 const run=event?.workflow_run,expected=UPSTREAM[kind][run?.name];
 if(env.GITHUB_EVENT_NAME!=='workflow_run'||event?.action!=='completed'||!expected
  ||run.path!==expected[0]||!expected[1].includes(run.event)
  ||run.head_branch!=='main'||run.head_repository?.full_name!==REPO
  ||run.status!=='completed'||run.conclusion!=='success'||run.run_attempt!==1)
  throw Error('TELEGRAM_TRIGGER_INVALID');
 // Ignore unrelated completions outside the delivery window without querying
 // providers, issuing NH tokens, uploading claims or contacting Telegram.
 return withinWindow===true;
}
