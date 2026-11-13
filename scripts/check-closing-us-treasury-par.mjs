import assert from 'node:assert/strict';
import {parseTreasuryParXml,readOfficialTreasuryPar} from './closing-us-treasury-par.mjs';
const date='2026-11-12',prior='2026-11-11',allowed=[date,prior];
const entry=(day,values=['4.10','4.20','4.50'])=>
 '<entry><content><m:properties><d:NEW_DATE>'+day+'T00:00:00</d:NEW_DATE>'+
 '<d:BC_2YEAR>'+values[0]+'</d:BC_2YEAR><d:BC_3YEAR>'+values[1]+
 '</d:BC_3YEAR><d:BC_10YEAR>'+values[2]+'</d:BC_10YEAR></m:properties></content></entry>';
const xml='<feed>'+entry(prior)+entry(date)+'</feed>';
const rows=parseTreasuryParXml(allowed,xml);
assert.equal(rows.length,3);
assert.deepEqual(rows.map(r=>r.id),['UST2Y','UST3Y','UST10Y_FRED']);
assert.deepEqual(rows.map(r=>r.value),[4.1,4.2,4.5]);
assert.ok(rows.every(r=>r.date===date&&r.source==='US_TREASURY_PAR_DAILY'));
assert.equal(parseTreasuryParXml(allowed,'<feed>'+entry(date)+entry(date)+'</feed>').length,0);
assert.equal(parseTreasuryParXml(allowed,'<feed>'+entry('2026-11-09')+'</feed>').length,0);
assert.equal(parseTreasuryParXml(allowed,'<feed>'+entry(date,['4.10','bad','4.50'])+'</feed>').length,2);
assert.equal(parseTreasuryParXml(allowed,'<feed>'+entry(date,['0','31','4.50'])+'</feed>').length,1);
assert.equal(parseTreasuryParXml(allowed,'<feed>'+entry(prior)+'</feed>').length,3);
const good=async(url,options)=>{
 const q=new URL(url);
 assert.equal(q.hostname,'home.treasury.gov');
 assert.equal(q.searchParams.get('data'),'daily_treasury_yield_curve');
 assert.equal(q.searchParams.get('field_tdr_date_value_month'),'202611');
 assert.equal(options.redirect,'follow');
 return {ok:true,url:q.href,headers:{get:k=>k==='content-type'?'application/atom+xml':null},text:async()=>xml};
};
const events=[];
assert.deepEqual(await readOfficialTreasuryPar(allowed,{fetchImpl:good,onDiagnostic:x=>events.push(x)}),rows);
assert.deepEqual(events,[{kind:'TREASURY_PAR_READ',status:'VERIFIED'}]);
for(const response of [
 {ok:false},
 {ok:true,url:'https://evil.example',headers:{get:()=> 'application/atom+xml'},text:async()=>xml},
 {ok:true,url:'https://home.treasury.gov/',headers:{get:()=> 'text/html'},text:async()=>xml}
]){
 const result=await readOfficialTreasuryPar(allowed,{fetchImpl:async()=>response});
 assert.deepEqual(result,[]);
}
console.log('TREASURY_PAR_OFFICIAL_READONLY_PASS exact date, provenance, duplicate and schema rejection');
