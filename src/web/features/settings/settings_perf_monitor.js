// Opt-in pftelemetry_device timing observer; no financial data, credentials or identifiers.
(function(){
'use strict';
const CONSENT='pf_perf_remote_consent_v1',ENDPOINT='pf_perf_remote_endpoint_v1',QUEUE='pf_perf_remote_queue_v1';
const STAGES=new Set(['load.initial-restore','load.initial-prices','load.full-update','price.poll-network','price.poll-render','price.poll-total','network.getBootstrap','network.getSettings','network.getPrices','network.getPriceHistory']);
let sending=false,timer=null;
const read=k=>{try{return localStorage.getItem(k)||''}catch(_){return ''}};
const write=(k,v)=>{try{localStorage.setItem(k,v)}catch(_){}};
const remove=k=>{try{localStorage.removeItem(k)}catch(_){}};
function pftelemetry_validEndpoint(value){
 try{const u=new URL(String(value||'').trim());if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/ingest'||!u.hostname||/^(localhost|127\.|10\.|192\.168\.|172\.16\.)/.test(u.hostname))return '';return u.href;}catch(_){return '';}
}
function pftelemetry_enabled(){return read(CONSENT)==='1'&&!!pftelemetry_validEndpoint(read(ENDPOINT))}
function pftelemetry_getQueue(){
 try{const arr=JSON.parse(read(QUEUE)||'[]');return Array.isArray(arr)?arr.filter(e=>STAGES.has(e?.stage)&&Number.isInteger(e.ms)&&e.ms>=0&&e.ms<=120000&&(e.result==='ok'||e.result==='error')).slice(-60):[]}catch(_){return []}
}
function pftelemetry_save(queue){write(QUEUE,JSON.stringify(queue.slice(-60)))}
function pftelemetry_device(){try{return window.matchMedia('(max-width: 768px)').matches?'mobile':'desktop'}catch(_){return 'unknown'}}
function pftelemetry_record(entry){
 if(!pftelemetry_enabled()||!entry||!STAGES.has(entry.stage)||!Number.isInteger(entry.ms)||entry.ms<0||entry.ms>120000)return;
 const items=pftelemetry_getQueue();items.push({stage:entry.stage,ms:entry.ms,result:entry.result==='ok'?'ok':'error'});pftelemetry_save(items);
 if(!timer)timer=setTimeout(()=>{timer=null;void pftelemetry_flush()},20000);
}
async function pftelemetry_flush(){
 if(sending||!pftelemetry_enabled()||typeof fetch!=='function')return false;
 const items=pftelemetry_getQueue();if(!items.length)return true;
 sending=true;const batch=items.slice(0,8);
 try{
  const res=await fetch(pftelemetry_validEndpoint(read(ENDPOINT)),{method:'POST',mode:'cors',credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:1,pftelemetry_device:pftelemetry_device(),samples:batch}),keepalive:true});
  if(!res.ok)return false;
  pftelemetry_save(pftelemetry_getQueue().slice(batch.length));return true;
 }catch(_){return false}finally{sending=false}
}
function pftelemetry_renderSettingsHtml(){
 const safe=pftelemetry_validEndpoint(read(ENDPOINT)).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
 return '<div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:12px 16px;margin-bottom:12px">'
 + '<div style="font-size:.74rem;font-weight:700">PC·모바일 조회시간 자동 진단</div>'
 + '<p style="font-size:.66rem;color:var(--muted);margin:7px 0">조회 단계·밀리초·성공 여부·화면 크기 기준 기기 종류만 별도 수집기로 보냅니다. 금융 원장·종목·가격·계좌·URL·토큰은 전송하지 않습니다. 기본 비활성화, 기기별 동의입니다.</p>'
 + '<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center">'
 + '<input id="perfCollectorEndpoint" aria-label="성능 수집기 HTTPS 주소" type="url" placeholder="https://.../ingest" value="'+safe+'" style="flex:1;min-width:170px;background:var(--s1);color:var(--text);padding:8px;border:1px solid var(--border);border-radius:6px"/>'
 + '<label style="font-size:.68rem"><input id="perfCollectorConsent" type="checkbox" '+(pftelemetry_enabled()?'checked':'')+'/> 최소 성능 로그 전송 동의</label>'
 + '<button type="button" id="perfCollectorSave" class="btn-purple-sm">설정 저장</button>'
 + '<button type="button" id="perfCollectorStop" class="btn-ghost-sm">전송 중지·대기 삭제</button></div>'
 + '<p id="perfCollectorStatus" role="status" style="font-size:.65rem;color:var(--muted);margin-top:8px">'+(pftelemetry_enabled()?'사용 중 · 전송 대기 '+pftelemetry_getQueue().length+'건':'현재 비활성화')+'</p></div>';
}
function pftelemetry_notify(msg){const e=document.getElementById('perfCollectorStatus');if(e)e.textContent=msg}
function pftelemetry_stop(){write(CONSENT,'0');remove(QUEUE);if(timer){clearTimeout(timer);timer=null}}
document.addEventListener('click',event=>{
 const btn=event.target.closest?.('button');if(!btn)return;
 if(btn.id==='perfCollectorStop'){pftelemetry_stop();const e=document.getElementById('perfCollectorConsent');if(e)e.checked=false;pftelemetry_notify('전송 중지 · 대기 로그 삭제')}
 else if(btn.id==='perfCollectorSave'){
  const value=document.getElementById('perfCollectorEndpoint')?.value||'';
  const consent=document.getElementById('perfCollectorConsent')?.checked===true;
  const normalized=pftelemetry_validEndpoint(value);
  if(consent&&!normalized){pftelemetry_notify('유효한 HTTPS 수집기 /ingest 주소를 입력하세요');return}
  if(!consent){pftelemetry_stop();if(normalized)write(ENDPOINT,normalized);pftelemetry_notify('비활성화 · 원격 전송 없음');return}
  if(normalized!==read(ENDPOINT))remove(QUEUE);
  write(ENDPOINT,normalized);write(CONSENT,'1');
  pftelemetry_notify('수집 활성 · 이후 조회부터 자동 기록');
 }
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)void pftelemetry_flush()});
window.addEventListener('online',()=>{void pftelemetry_flush()});
window.PortfolioPerfTelemetry=Object.freeze({record:pftelemetry_record,flush:pftelemetry_flush,renderSettingsHtml:pftelemetry_renderSettingsHtml,enabled:pftelemetry_enabled});
if(pftelemetry_enabled())timer=setTimeout(()=>{timer=null;void pftelemetry_flush()},2500);
})();