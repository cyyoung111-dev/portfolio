// Read-only KOFIA FreeSIS public statistical display feed (not a stable public API).
// Source units: KRW millions. Publication is delayed; NEVER relabel as today's data.
// This module never writes to Sheets, GAS, portfolio records or Telegram.
const ENDPOINT='https://freesis.kofia.or.kr/meta/getMetaDataList.do';
const DAY=/^\d{4}-\d{2}-\d{2}$/;
const isDay=d=>typeof d==='string'&&DAY.test(d)
 &&!Number.isNaN(Date.parse(d+'T00:00:00Z'))
 &&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
const toDate=d=>d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8);
const numeric=n=>{
 const str=typeof n==='number'?String(n):typeof n==='string'?n.replace(/,/g,'').trim():'';
 if(!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(str))return null;
 const v=Number(str);
 return Number.isFinite(v)&&v>=0&&v<1000000000?v:null;
};
const latest=(json,date,kind)=>{
 if(!json||!Array.isArray(json.ds1)||json.ds1.length>150)return null;
 const accepted=[];
 for(const item of json.ds1){
  const raw=item?.TMPV1;
  if(typeof raw!=='string'||!/^\d{8}$/.test(raw))continue;
  const d=toDate(raw);
  if(!isDay(d)||d>date||Date.parse(date+'T00:00:00Z')-Date.parse(d+'T00:00:00Z')>10*864e5)continue;
  const total=numeric(item.TMPV2);
  if(total===null||total<=0)continue;
  if(kind==='margin'){
   const kospi=numeric(item.TMPV3),kosdaq=numeric(item.TMPV4);
   if(kospi===null||kosdaq===null||Math.abs(total-kospi-kosdaq)>2)continue;
   accepted.push({date:d,balanceMillion:total,kospiMillion:kospi,kosdaqMillion:kosdaq});
  }else{
   const derivatives=numeric(item.TMPV3);
   if(derivatives===null)continue;
   accepted.push({date:d,balanceMillion:total,derivativesMillion:derivatives});
  }
 }
 accepted.sort((a,b)=>b.date.localeCompare(a.date));
 if(!accepted.length||accepted.filter(x=>x.date===accepted[0].date).length!==1)return null;
 return accepted[0];
};
export function verifyKofiaLiquidity(date,funds,credit){
 if(!isDay(date))return null;
 const deposits=latest(funds,date,'deposits'),margin=latest(credit,date,'margin');
 return deposits||margin?{source:'KOFIA_FREESIS_PUBLIC',
  asOfKst:date,deposits,margin}:null;
}
async function readObject(date,objectId,fetchImpl){
 const end=date.replaceAll('-','');
 const from=new Date(Date.parse(date+'T00:00:00Z')-13*864e5).toISOString().slice(0,10).replaceAll('-','');
 const request={dmSearch:{
  tmpV40:'1000000',tmpV41:'1',tmpV6:'2',tmpV7:'1',
  tmpV4:'',tmpV11:'',tmpV1:'RD',tmpV45:from,tmpV46:end,OBJ_NM:objectId
 }};
 try{
  const response=await fetchImpl(ENDPOINT,{
   method:'POST',redirect:'error',
   headers:{accept:'application/json','content-type':'application/json; charset=UTF-8',
    referer:'https://freesis.kofia.or.kr/stat/main.do'},
   body:JSON.stringify(request),signal:AbortSignal.timeout(7500)
  });
  if(!response?.ok)return null;
  const length=Number(response.headers?.get?.('content-length'));
  if(Number.isFinite(length)&&length>1000000)return null;
  const data=await response.json();
  return data&&typeof data==='object'?data:null;
 }catch{return null;}
}
export async function readKofiaLiquidity(date,{fetchImpl=fetch}={}){
 if(!isDay(date)||typeof fetchImpl!=='function')return null;
 const [funds,credit]=await Promise.all([
  readObject(date,'STATSCU0100000060BO',fetchImpl),
  readObject(date,'STATSCU0100000070BO',fetchImpl)]);
 return verifyKofiaLiquidity(date,funds,credit);
}
export function formatKofiaLiquidity(result,{maxLength=140}={}){
 if(result?.source!=='KOFIA_FREESIS_PUBLIC'||!isDay(result?.asOfKst)
  ||!Number.isInteger(maxLength)||maxLength<70||maxLength>300)return '';
 const parts=[];
 if(result.deposits&&isDay(result.deposits.date)
  &&Number.isFinite(result.deposits.balanceMillion)&&result.deposits.balanceMillion>0)
   parts.push('예탁금 '+(result.deposits.balanceMillion/1e6).toFixed(2)
     +'조('+result.deposits.date.slice(5)+')');
 if(result.margin&&isDay(result.margin.date)
  &&Number.isFinite(result.margin.balanceMillion)&&result.margin.balanceMillion>0
  &&Math.abs(result.margin.balanceMillion-result.margin.kospiMillion
    -result.margin.kosdaqMillion)<=2)
   parts.push('신용융자 '+(result.margin.balanceMillion/1e6).toFixed(2)
     +'조('+result.margin.date.slice(5)+')');
 const text=parts.length?'시장자금: '+parts.join(' · ')+' [금투협 FreeSIS · 기준일별]':'';
 return text.length<=maxLength?text:'';
}
