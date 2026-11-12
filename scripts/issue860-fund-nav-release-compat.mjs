// #860: explicit release-reviewed GAS web-app NAV collector compatibility.
// Never infer safety by numeric comparison or automatically approve future
// versions; each new GAS release must verify the fund import/preview contract.
const KB_PUBLISHED_GAS_VERSIONS=Object.freeze([
 '9.281','9.282','9.283','9.284','9.285','9.289','9.291','9.292'
]);
const HANWHA_PUBLISHED_GAS_VERSIONS=Object.freeze([
 '9.282','9.283','9.284','9.285','9.289','9.291','9.292'
]);
export function supportsPublishedFundNavGasVersion(kind,version){
 if(typeof version!=='string')return false;
 if(kind==='KB')return KB_PUBLISHED_GAS_VERSIONS.includes(version);
 if(kind==='HANWHA')return HANWHA_PUBLISHED_GAS_VERSIONS.includes(version);
 return false;
}
export function assertPublishedReleaseFundNavSupport(version){
 if(!supportsPublishedFundNavGasVersion('KB',version)||
    !supportsPublishedFundNavGasVersion('HANWHA',version))
  throw Error('GAS_RELEASE_NAV_COLLECTOR_VERSION_UNREVIEWED');
 return {version,kb:true,hanwha:true,financialWrites:0};
}
