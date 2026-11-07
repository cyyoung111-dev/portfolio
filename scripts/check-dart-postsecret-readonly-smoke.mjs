import assert from 'node:assert/strict';
import {readTwoDomesticDartBps,extractDartDomesticBps,
 DART_SEMICONDUCTORS} from './briefing-dart-semiconductor-sources.mjs';
import {auditDartDomesticBps} from './audit-dart-semiconductor-readonly.mjs';

const at=()=>new Date('2026-11-07T10:00:00+09:00');
const key='A'.repeat(40),receipt='20260814000001';
const fin=(corp,year,code,period)=>({
 status:'000',list:[{rcept_no:receipt,corp_code:corp,bsns_year:String(year),
 reprt_code:code,sj_div:'BS',account_id:'ifrs-full_EquityAttributableToOwnersOfParent',
 currency:'KRW',thstrm_amount:'1,000,000,000,000'}]
});
const shares=(corp,period)=>({status:'000',list:[
 {corp_code:corp,rcept_no:receipt,stlm_dt:period,se:'보통주',
  istc_totqy:'100,000,000',tesstk_co:'10,000,000',distb_stock_co:'90,000,000'},
 {corp_code:corp,rcept_no:receipt,stlm_dt:period,se:'우선주',
  istc_totqy:'20,000,000',tesstk_co:'0',distb_stock_co:'20,000,000'},
 {corp_code:corp,rcept_no:receipt,stlm_dt:period,se:'합계',
  istc_totqy:'120,000,000',tesstk_co:'10,000,000',distb_stock_co:'110,000,000'}
]});
const seen=[];
const fetchImpl=async url=>{
 const u=new URL(String(url));
 assert.equal(u.hostname,'opendart.fss.or.kr');
 assert.equal(u.searchParams.get('crtfc_key'),key);
 const corp=u.searchParams.get('corp_code');
 const year=u.searchParams.get('bsns_year'),code=u.searchParams.get('reprt_code');
 const q3=year==='2026'&&code==='11014';
 const q2=year==='2026'&&code==='11012';
 assert.ok(q2||q3,'do not unexpectedly fetch stale years for known filings');
 const path=u.pathname.split('/').at(-1);
 assert.ok(['fnlttSinglAcntAll.json','stockTotqySttus.json'].includes(path));
 seen.push({corp,code,path});
 const body=q3?{status:'013',message:'NO_DATA'}:
  path==='fnlttSinglAcntAll.json'
   ?fin(corp,Number(year),code,'2026-06-30')
   :shares(corp,'2026-06-30');
 return {ok:true,json:async()=>body};
};
const direct=await readTwoDomesticDartBps({now:at,apiKey:key,fetchImpl});
assert.deepEqual(direct.statuses.map(x=>x.status),
 ['INDICATIVE_MULTICLASS_BPS','INDICATIVE_MULTICLASS_BPS']);
assert.equal(direct.rows.length,2);
assert.deepEqual(direct.rows.map(x=>x.period),['2026-06-30','2026-06-30']);
assert.ok(direct.rows.every(x=>x.receiptNo===receipt));
assert.ok(direct.rows.every(x=>Math.abs(x.referenceBpsKrw-1e12/110e6)<1e-8));
assert.deepEqual(seen.map(x=>x.code),['11014','11012','11012','11014','11012','11012']);
assert.equal(JSON.stringify(seen).includes(key),false,'never include token in diagnostics');

const audited=await auditDartDomesticBps({reader:async()=>direct});
assert.equal(audited.total,2);
assert.equal(audited.indicative,2);
assert.equal(audited.verified,0);
assert.equal(audited.portfolioWrites,0);
assert.equal(audited.telegramSends,0);
assert.equal(audited.gasDeployments,0);
assert.equal(audited.statuses[0].filedPeriod,'2026-06-30');
const auditText=JSON.stringify(audited);
for(const leaked of [key,receipt,'1,000,000,000,000','110,000,000','referenceBpsKrw',
 'parentEquityKrw','istc_totqy'])assert.ok(!auditText.includes(leaked));
assert.equal(audited.statuses.length,2);

const rejectKey=await readTwoDomesticDartBps({
 now:at,apiKey:null,fetchImpl:async()=>{throw Error('invalid key must not call API');}
});
assert.equal(rejectKey.rows.length,0);
assert.deepEqual(rejectKey.statuses.map(x=>x.status),
 ['DART_KEY_NOT_CONFIGURED','DART_KEY_NOT_CONFIGURED']);

const rejected=await readTwoDomesticDartBps({now:at,apiKey:key,
 fetchImpl:async()=>({ok:true,json:async()=>({status:'010',message:'INVALID_KEY'})})});
assert.deepEqual(rejected.statuses.map(x=>x.status),
 ['DART_KEY_REJECTED','DART_KEY_REJECTED']);
assert.equal(rejected.rows.length,0);

const item=DART_SEMICONDUCTORS[0],period={year:2026,code:'11012',period:'2026-06-30'};
const corrupted=shares(item.corpCode,'2026-06-30');
corrupted.list[2].distb_stock_co='110,000,001';
assert.equal(extractDartDomesticBps(fin(item.corpCode,2026,'11012'),
 corrupted,item,period,{now:at()}).status,'DART_SHARE_TOTAL_MISMATCH');
assert.equal(extractDartDomesticBps(fin(item.corpCode,2026,'11012'),
 shares(item.corpCode,'2026-06-30'),item,
 {...period,period:'2026-09-30'},{now:at()}).status,
 'DART_SHARES_PERIOD_UNVERIFIED');
console.log('DART_POSTSECRET_READONLY_SMOKE_PASS Q3_unfiled Q2_report 2_company authkey_redacted invalid_key no_writes');
