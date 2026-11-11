#!/usr/bin/env node
// #860: independent READ-ONLY secondary-source probe for exact Hanwha C-RPe.
// This does not authorize NAV import or replace the primary provider.
// Never print NAV amounts, raw provider payloads or credentials.
import {pathToFileURL} from 'node:url';
import {parseNav,sourceUrl} from './collect-kb-fund-nav.mjs';

export const HANWHA_CRPE_CLASS_ID='K55213C50702';
export const HANWHA_CRPE_PRODUCT_PAGE='https://www.funetf.co.kr/product/fund/view/K55213C50702';

const dateRe=/^\d{4}-\d{2}-\d{2}$/;
function kstDay(now) {
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('HANWHA_FUNETF_CLOCK');
 return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',
  year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
function shift(day,n) {
 return new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
}
export async function readHanwhaFunetf({now=new Date(),fetchImpl=fetch}={}) {
 const today=kstDay(now),from=shift(today,-14);
 if(!dateRe.test(today)||!dateRe.test(from))throw Error('HANWHA_FUNETF_DATE');
 const endpoint=new URL(sourceUrl);
 endpoint.search=new URLSearchParams({
  fundCd:HANWHA_CRPE_CLASS_ID,
  gijunYmd:today.replaceAll('-',''),
  schNavMode:'',
  schNavStDt:from.replaceAll('-',''),
  schNavEdDt:today.replaceAll('-','')
 });
 let response;
 try{
  response=await fetchImpl(endpoint,{method:'GET',
   headers:{'User-Agent':'Mozilla/5.0',
     'Referer':HANWHA_CRPE_PRODUCT_PAGE,'Accept':'application/json'},
   signal:AbortSignal.timeout(30000)});
 }catch{throw Error('HANWHA_FUNETF_NETWORK_UNVERIFIED');}
 if(response?.ok!==true)throw Error('HANWHA_FUNETF_HTTP_UNVERIFIED');
 let payload;
 try{payload=await response.json();}
 catch{throw Error('HANWHA_FUNETF_JSON_UNVERIFIED');}
 let published;
 try{published=parseNav(payload,from,today);}
 catch{throw Error('HANWHA_FUNETF_SCHEMA_OR_RANGE_UNVERIFIED');}
 const eligible=published.filter(r=>r.date<today);
 if(!eligible.length)throw Error('HANWHA_FUNETF_PRIOR_PUBLICATION_MISSING');
 return {today,eligible,sameDayExcluded:published.length-eligible.length};
}
export async function probeHanwhaFunetf({now=new Date(),fetchImpl=fetch}={}) {
 const {today,eligible,sameDayExcluded}=await readHanwhaFunetf({now,fetchImpl});
 // For now, do not write and do not expose prices. The production primary
 // can be supplemented only after exact class+overlapping-date/value proof.
 return {kind:'HANWHA_FUNETF_SECONDARY_SOURCE_READ_ONLY',
  code:'F00001',fundClass:'C-RPe',fundId:HANWHA_CRPE_CLASS_ID,
  asOfKst:today,latestEligibleDate:eligible.at(-1).date,
  eligibleRows:eligible.length,sameDayExcluded,
  matchToPersistedOfficialNavVerified:false,importAuthorized:false,
  financialWrites:0,gasCalls:0,gasDeployments:0};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href) {
 try{console.log(JSON.stringify(await probeHanwhaFunetf()));}
 catch(e){console.error(/^HANWHA_FUNETF_[A-Z_]+$/.test(e?.message||'')
   ?e.message:'HANWHA_FUNETF_UNVERIFIED');process.exitCode=1;}
}
