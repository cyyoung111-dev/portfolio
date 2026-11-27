// Shared adapter for same-run public NAV evidence. Does not authorize a write.
import {readFileSync} from 'node:fs';
const SOURCE='https://dis.kofia.or.kr/proframeWeb/XMLSERVICES/';
const SPECS=Object.freeze({
 F00002:{standardCode:'KR5223AQ0185',provider:'KB_VALUE_ST',classCode:'AQ018',sourceText:'KR5223AQ0185 AQ018 S-T KOFIA DIS + Naver'},
 F00001:{standardCode:'K55213C50702',provider:'HANWHA_2045_CRPE',classCode:'C-RPe',sourceText:'K55213C50702 HANWHA C-RPe KOFIA DIS + Naver'}
});
const day=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
export function selectCrosscheckedCandidate(archive,code,today){
 const spec=SPECS[code];
 if(!spec||!day(today)||archive?.kind!=='PUBLIC_NAV_CANDIDATE_ARCHIVE'
   ||archive.asOfKst!==today||archive.importAuthorized!==false||archive.financialWrites!==0||archive.gasCalls!==0
   ||!Array.isArray(archive.funds)||!Array.isArray(archive.requestedDates))
  throw Error('NAV_CANDIDATE_ARCHIVE_UNVERIFIED');
 const requested=archive.requestedDates;
 const recent=[];const cursor=new Date(today+'T00:00:00Z');
 while(recent.length<5){cursor.setUTCDate(cursor.getUTCDate()-1);if(![0,6].includes(cursor.getUTCDay()))recent.unshift(cursor.toISOString().slice(0,10));}
 if(requested.length!==recent.length||requested.some((d,i)=>d!==recent[i]))throw Error('NAV_CANDIDATE_RANGE_UNVERIFIED');
 if(requested.length!==5||new Set(requested).size!==5||requested.some(d=>!day(d)||d>=today||[0,6].includes(new Date(d+'T00:00:00Z').getUTCDay())||(Date.parse(today)-Date.parse(d))/86400000>10)
   ||requested.some((d,i)=>i>0&&d<=requested[i-1]))throw Error('NAV_CANDIDATE_RANGE_UNVERIFIED');
 const items=archive.funds.filter(x=>x.fund===code);
 if(items.length!==1)throw Error('NAV_CANDIDATE_CLASS_UNVERIFIED');
 const f=items[0],check=f.crosscheck;
 if(f.standardCode!==spec.standardCode||f.source!==SOURCE||f.anchorState!=='MATCH'
   ||f.secondaryState!=='RETRIEVED'||check?.state!=='CROSSCHECK_MATCHED'
   ||!Array.isArray(check.conflictDates)||check.conflictDates.length
   ||!Array.isArray(check.matchedDates)||check.matchedDates.length<3
   ||new Set(check.matchedDates).size!==check.matchedDates.length||!Array.isArray(f.rows)||f.rows.length>5)
  throw Error('NAV_CANDIDATE_CROSSCHECK_UNVERIFIED');
 const seen=new Set();
 const all=f.rows.map(row=>{
   if(!requested.includes(row?.date)||seen.has(row.date)||typeof row.nav!=='string'||!/^\d+(?:\.\d+)?$/.test(row.nav)
     ||!Number.isFinite(Number(row.nav))||Number(row.nav)<=0)throw Error('NAV_CANDIDATE_ROW_UNVERIFIED');
   seen.add(row.date);return {date:row.date,nav:Number(row.nav)};
 });
 if(check.matchedDates.some(d=>!seen.has(d)))throw Error('NAV_CANDIDATE_MATCH_MISSING');
 const rows=all.filter(r=>check.matchedDates.includes(r.date)).sort((a,b)=>a.date.localeCompare(b.date));
 return {...spec,code,rows,requestedDates:[...requested],
   unverifiedDates:requested.filter(d=>!check.matchedDates.includes(d)),
   writerInvoked:false,importAuthorized:false};
}
export function loadCandidate(path,today,code){
 return selectCrosscheckedCandidate(JSON.parse(readFileSync(path,'utf8')),code,today);
}

export const NAV_CANDIDATE_CODES=Object.freeze(['F00002','F00001']);
export function safeCandidateFailure(error){
 const reason=typeof error?.message==='string'?error.message:'';
 return /^NAV_CANDIDATE_[A-Z_]{1,60}$/.test(reason)?reason:'NAV_CANDIDATE_PREVIEW_UNVERIFIED';
}
// Evaluate each class independently. A missing or conflicting fund cannot
// suppress eligible evidence for the other fund; neither authorizes writes.
export function assessCandidateEligibility(archive,today){
 const sources=[],failures=[];
 for(const code of NAV_CANDIDATE_CODES){
  try{sources.push(selectCrosscheckedCandidate(archive,code,today));}
  catch(error){failures.push({code,reason:safeCandidateFailure(error)});}
 }
 return {sources,failures};
}
