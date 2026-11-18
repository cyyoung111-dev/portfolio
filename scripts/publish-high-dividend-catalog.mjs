import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const CODE=/^(?:\d{6}|\d{4}[A-Z]\d)$/;
const source='https://kind.krx.co.kr/valueup/dividend.do?method=valueupHighDividendMain';
export function verifyCatalog(data) {
 assert.equal(data?.schemaVersion,1);
 assert.equal(data.classification,'CANDIDATE_ONLY');
 assert.equal(data.source,source);
 assert.ok(Number.isInteger(data.businessYear)&&data.businessYear>=2025&&data.businessYear<=2028);
 assert.ok(Number.isFinite(Date.parse(data.retrievedAt)));
 assert.ok(/^[a-f0-9]{64}$/.test(data.sourceSha256)&&/^[a-f0-9]{64}$/.test(data.masterSha256));
 assert.ok(Array.isArray(data.rows)&&data.rows.length>0&&Array.isArray(data.unresolved)&&Array.isArray(data.reviewChanges));
 assert.equal(data.total,data.rows.length+data.unresolved.length);
 const codes=new Set();
 for(const r of data.rows){
   assert.ok(CODE.test(r.listedCode)&&!codes.has(r.listedCode));
   assert.equal(r.businessYear,data.businessYear);
   assert.equal(r.taxEligibility,'UNVERIFIED');
   assert.equal(r.identityState,'EXACT_LISTED_ISSUER');
   assert.ok(['KOSPI','KOSDAQ'].includes(r.market)&&typeof r.issuerName==='string'&&r.issuerName);
   codes.add(r.listedCode);
 }
 return data;
}
export function makePublicCatalog(data,previous=null){
 verifyCatalog(data);
 if(previous){verifyCatalog(previous);assert.equal(previous.businessYear,data.businessYear);if(Date.parse(previous.retrievedAt)>=Date.parse(data.retrievedAt))return null;}
 const fields=r=>[r.issuerName,r.market,r.disclosureTitle,r.fiscalMonth,r.payoutRatio,r.growthRatio];
 const old=new Map((previous?.rows||[]).map(r=>[r.listedCode,r]));
 const next=new Map(data.rows.map(r=>[r.listedCode,r]));
 const changes={added:[],removed:[],changed:[]};
 for(const [code,r] of next){if(!old.has(code))changes.added.push(code);else if(JSON.stringify(fields(r))!==JSON.stringify(fields(old.get(code))))changes.changed.push(code);}
 for(const code of old.keys())if(!next.has(code))changes.removed.push(code);
 // Persistent recheck set: unchanged after a correction does NOT mean reviewed.
 const recheck=[...new Set([...(previous?.recheckCodes||[]),...changes.changed,...changes.removed])].sort();
 return {...data,rows:[...data.rows].sort((a,b)=>a.listedCode.localeCompare(b.listedCode)),changes,recheckCodes:recheck};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const input=verifyCatalog(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));
 const dir=path.join(process.argv[3]||'.','companies');
 const dest=path.join(dir,input.businessYear+'.json');
 const previous=fs.existsSync(dest)?JSON.parse(fs.readFileSync(dest,'utf8')):null;
 const out=makePublicCatalog(input,previous);
 if(out){fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(dest,JSON.stringify(out,null,2)+'\n');
 console.log(JSON.stringify({businessYear:out.businessYear,total:out.total,added:out.changes.added.length,removed:out.changes.removed.length,changed:out.changes.changed.length,correctionReview:out.recheckCodes.length}));}
}
