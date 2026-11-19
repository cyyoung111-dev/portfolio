// ════════════════════════════════════════════════════════════════
//  views_div_asset.js — 배당 뷰 (calcDividends, renderDivView)
//  의존: data.js, settings.js, mgmt_div.js
// ════════════════════════════════════════════════════════════════
// ★ [버그수정] new Date().getMonth() 파일 로드 시 1회 고정 → 함수 호출로 교체
//   calcDividends() / renderDivView() 호출 시점의 KST 월을 정확히 반영
function _getNowMonth() { return _kstNow().getUTCMonth() + 1; }

// ════════════════════════════════════════════════════════════════
//  calcDividends — DIVDATA + rawHoldings 기반 배당 계산
//  반환: [{ name, totalQty, accts, dd, annualDiv }]
// ════════════════════════════════════════════════════════════════
// 수량 0 종목 숨김 상태
let _divHideZeroQty = typeof lsGet === 'function' ? lsGet(DIV_HIDE_ZERO_KEY, false) : false;
let _divSelectedMonth = 0; // 0=연간 전체, 1~12=선택 월
const DIV_TAX_LABELS=Object.freeze({all:'전체',normal:'일반계좌',isa:'ISA',pension:'연금저축',irp:'IRP',unclassified:'미분류'});
let _divTaxFilter='all';
// Annual tax assumptions are private settings, never a ledger write.
// Device-local fallback remains for older GAS. Private 9.300 sync is opt-in by exact server capability.
const DIV_TAX_SCENARIO_KEY='pf_financial_tax_scenarios_v1';
const DIV_TAX_DETAILS_FIELDS=Object.freeze(['capitalExempt','etfTaxDifference','certificateSpecial','otherTaxBase','grossUpOrdinary','grossUpSpecial']);
const _divTaxSession=Object.create(null);
let _divTaxStorageState='unknown';
function _validDivTaxYear(value){const y=Number(value);return Number.isInteger(y)&&y>=2000&&y<=2100;}
function _cleanDivTaxAmount(value){return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null;}
function _cleanDivTaxRecord(record){
  if(!record||typeof record!=='object'||Array.isArray(record))return null;
  const details=Object.fromEntries(DIV_TAX_DETAILS_FIELDS.map(k=>[k,_cleanDivTaxAmount(record.details?.[k])]));
  const interest=_cleanDivTaxAmount(record.interest);
  if(interest===null&&Object.values(details).every(v=>v===null))return null;
  return {interest,details,updatedAt:typeof record.updatedAt==='string'&&Number.isFinite(Date.parse(record.updatedAt))?record.updatedAt:null};
}
function _readDivTaxStore(){
  try{
    if(typeof localStorage==='undefined'){_divTaxStorageState='unavailable';return null;}
    const raw=localStorage.getItem(DIV_TAX_SCENARIO_KEY);
    const data=raw?JSON.parse(raw):{};
    if(!data||typeof data!=='object'||Array.isArray(data))throw Error('invalid store');
    _divTaxStorageState='available';
    return data;
  }catch{_divTaxStorageState='unavailable';return null;}
}
function _getDivTaxLocalRecord(year){
  if(!_validDivTaxYear(year))return null;
  // Read the current device value on each render; other tabs may have updated it.
  const stored=_readDivTaxStore();
  if(Object.prototype.hasOwnProperty.call(_divTaxSession,year))return _divTaxSession[year];
  return _cleanDivTaxRecord(stored?.[year]);
}
function _saveDivTaxRecord(year,interest,details){
  if(!_validDivTaxYear(year))return false;
  const record=_cleanDivTaxRecord({interest,details,updatedAt:new Date().toISOString()});
  const stored=_readDivTaxStore();
  if(stored){
    const next=Object.create(null);
    for(const [key,value] of Object.entries(stored)){
      if(!_validDivTaxYear(key)||Number(key)===Number(year))continue;
      const valid=_cleanDivTaxRecord(value);if(valid)next[key]=valid;
    }
    if(record)next[year]=record;
    try{
      localStorage.setItem(DIV_TAX_SCENARIO_KEY,JSON.stringify(next));
      const verified=JSON.parse(localStorage.getItem(DIV_TAX_SCENARIO_KEY)||'{}');
      if(JSON.stringify(_cleanDivTaxRecord(verified[year]))!==JSON.stringify(record))throw Error('save verification');
      delete _divTaxSession[year];
      _divTaxStorageState='available';
      return true;
    }catch{_divTaxStorageState='unavailable';}
  }
  // A failed browser save stays session-only and is explicitly reported.
  _divTaxSession[year]=record;
  return false;
}
// Keep the connection generation and each year's revision together. No server
// amounts are written to localStorage, the portfolio backup, or public data.
let _divTaxRemoteScope=null;
const _divTaxRemoteYears=new Map();
function _divTaxSyncConnection(){
  if(typeof window==='undefined'||!['9.300','9.301','9.302','9.303','9.304'].includes(window._lastGasVersion)
    ||typeof GSHEET_API_URL==='undefined'||!String(GSHEET_API_URL||'').trim()
    ||typeof getGsheetAccessToken!=='function'||!getGsheetAccessToken()
    ||typeof getGsheetConnectionGeneration!=='function'
    ||typeof requestGsheetFormJson!=='function')return null;
  const url=String(GSHEET_API_URL).trim(),generation=getGsheetConnectionGeneration();
  if(!_divTaxRemoteScope||_divTaxRemoteScope.url!==url||_divTaxRemoteScope.generation!==generation){
    _divTaxRemoteYears.clear();_divTaxRemoteScope={url,generation};
  }
  return _divTaxRemoteScope;
}
function _divTaxRevisionValid(value){
  return typeof value==='string'&&(value==='0'||/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value));
}
function _divTaxSyncPayload(record){
  return {interest:record?.interest??null,details:Object.fromEntries(DIV_TAX_DETAILS_FIELDS.map(k=>[k,record?.details?.[k]??null]))};
}
function _divTaxSyncCanonical(record){
  const value=_divTaxSyncPayload(record);
  return value.interest===null&&Object.values(value.details).every(v=>v===null)?null:value;
}
function _divTaxDecodeRemote(reply,year){
  if(reply?.status!=='ok'||reply.protocol!==1||!['9.300','9.301','9.302','9.303','9.304'].includes(reply.gasVersion)||reply.year!==Number(year)
    ||!_divTaxRevisionValid(reply.revision)||!Object.prototype.hasOwnProperty.call(reply,'record'))return null;
  if(reply.record!==null){
    if(reply.revision==='0'||!reply.record||typeof reply.record!=='object'||!reply.record.details
      ||[reply.record.interest,...DIV_TAX_DETAILS_FIELDS.map(k=>reply.record.details[k])]
        .some(v=>v!==null&&(typeof v!=='number'||!Number.isSafeInteger(v)||v<0)))return null;
    if(!_divTaxSyncCanonical(reply.record))return null;
  }
  return {revision:reply.revision,record:_divTaxSyncCanonical(reply.record),at:Date.now(),failed:false};
}
function _getDivTaxRecord(year){
  if(!_validDivTaxYear(year))return null;
  const scope=_divTaxSyncConnection(),state=scope?_divTaxRemoteYears.get(Number(year)):null;
  return state&&state.revision!=='0'&&_divTaxRevisionValid(state.revision)?state.record:_getDivTaxLocalRecord(year);
}
function _divTaxRemoteStatus(year){
  const scope=_divTaxSyncConnection();if(!scope)return null;
  return _divTaxRemoteYears.get(Number(year))||{revision:null,record:null,at:0,failed:false};
}
function _divTaxFormSignature(year){
  if(typeof $el!=='function')return null;
  const interest=$el('div-other-income-scenario');
  if(!interest||Number(interest.dataset?.taxYear)!==Number(year))return null;
  return JSON.stringify([interest,...DIV_TAX_DETAILS_FIELDS.map(k=>$el('div-tax-'+k))]
    .map(f=>String(f?.value??'').trim().replace(/,/g,'')));
}
function _divTaxRecordSignature(record){
  const value=_divTaxSyncPayload(record);
  return JSON.stringify([value.interest,...DIV_TAX_DETAILS_FIELDS.map(k=>value.details[k])].map(v=>v===null?'':String(v)));
}
function _rerenderDivTaxView(){
  if(typeof currentView!=='undefined'&&['div','plan'].includes(currentView)&&typeof renderView==='function')renderView(true);
}
async function _readDivTaxRemote(year,force=false){
  if(!_validDivTaxYear(year))return false;
  year=Number(year);
  const scope=_divTaxSyncConnection();if(!scope)return false;
  const prior=_divTaxRemoteYears.get(year);
  if(prior?.loading||prior?.saving)return false;
  // Refresh when the panel renders, never on a recurring timer.
  if(!force&&prior&&Date.now()-prior.at<60000)return !prior.failed;
  const signature=force?_divTaxFormSignature(year):_divTaxRecordSignature(_getDivTaxRecord(year));
  const state={...(prior||{revision:null,record:null}),loading:true,at:Date.now(),failed:false};
  _divTaxRemoteYears.set(year,state);
  let decoded=null;
  try{
    const reply=await requestGsheetFormJson('getFinancialTaxScenario',{year},{targetUrl:scope.url,timeoutMs:15000,retry:0,preserveError:true});
    decoded=_divTaxDecodeRemote(reply,year);
  }catch{}
  if(_divTaxSyncConnection()!==scope||_divTaxRemoteYears.get(year)!==state)return false;
  if(decoded)_divTaxRemoteYears.set(year,decoded);
  else _divTaxRemoteYears.set(year,{...state,loading:false,failed:true});
  const currentSignature=_divTaxFormSignature(year);
  // Do not clear text typed during the request or silently switch its revision.
  // A failed server read must never replace unsaved inputs with cached values.
  if(decoded&&(currentSignature===null||currentSignature===signature))_rerenderDivTaxView();
  if(force&&typeof showToast==='function')showToast(decoded?'서버 세제 가정 조회 완료':'서버 세제 가정 조회 실패',decoded?'success':'error');
  return !!decoded;
}
async function _saveDivTaxRemote(year,interest,details,expectedRevision){
  year=Number(year);
  const scope=_divTaxSyncConnection(),state=scope?_divTaxRemoteYears.get(year):null;
  if(!scope||!state||state.loading||state.saving||state.failed||!_divTaxRevisionValid(expectedRevision)||expectedRevision!==state.revision)
    return {ok:false,reason:'RELOAD_REQUIRED'};
  const requested=_divTaxSyncCanonical({interest,details});
  state.saving=true;
  let decoded=null,reply=null;
  try{
    reply=await requestGsheetFormJson('saveFinancialTaxScenario',{year,expectedRevision,data:JSON.stringify(requested)},
      {targetUrl:scope.url,timeoutMs:20000,retry:0,preserveError:true});
    decoded=_divTaxDecodeRemote(reply,year);
  }catch{}
  if(_divTaxSyncConnection()!==scope||_divTaxRemoteYears.get(year)!==state)return {ok:false,reason:'CONNECTION_CHANGED'};
  state.saving=false;
  if(!decoded||decoded.revision==='0'||JSON.stringify(decoded.record)!==JSON.stringify(requested)){
    // A missing ACK may already be committed: require reading, never retry a write.
    state.failed=true;state.at=Date.now();
    return {ok:false,reason:reply?.errorCode==='TAX_SCENARIO_CONFLICT'?'CONFLICT':'RELOAD_REQUIRED'};
  }
  _divTaxRemoteYears.set(year,decoded);
  return {ok:true};
}
function _reloadDivTaxRemoteFromUI(){
  const field=typeof $el==='function'?$el('div-other-income-scenario'):null;
  if(field)_readDivTaxRemote(Number(field.dataset?.taxYear||_kstYear()),true);
}
function _getDivTaxDetails(year){return _getDivTaxRecord(year)?.details||null;}
// One public GET per session/year, shared by both tabs. No portfolio data is sent.
// Failed refreshes can be retried after ten minutes without blocking rendering.
const _divCompanyLoad = new Map();
function _refreshDividendCompanyCatalog(year=_kstYear()) {
  if(typeof window==='undefined'||!window.location||typeof fetch!=='function'||typeof AbortSignal==='undefined')return;
  if(year<2026||year>2029)return;
  const last=_divCompanyLoad.get(year);
  if(last&&Date.now()-last.at<(last.ok?3600000:600000))return;
  const attempt={at:Date.now(),ok:false};
  _divCompanyLoad.set(year,attempt);
  const url='https://raw.githubusercontent.com/cyyoung111-dev/portfolio/high-dividend-companies/companies/'+(year-1)+'.json';
  fetch(url,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(10000)})
    .then(r=>{if(!r.ok)throw Error('catalog unavailable');return r.json();})
    .then(data=>{
      if(!PlanCalculations.setDividendCompanyCatalog(data,year))throw Error('catalog invalid');
      attempt.ok=true;
      if(typeof currentView!=='undefined'&&['div','plan'].includes(currentView)&&typeof renderView==='function')renderView(true);
    }).catch(()=>{});
}
function _getDivOtherIncome(year) {
  return _getDivTaxRecord(year)?.interest??null;
}
function _applyDivOtherIncome() {
  const field=$el('div-other-income-scenario');
  if(!field)return;
  const read=f=>{
    const raw=String(f?.value??'').trim().replace(/,/g,'');
    return raw===''?null:/^\d+$/.test(raw)&&Number.isSafeInteger(Number(raw))?Number(raw):NaN;
  };
  const year=Number(field.dataset?.taxYear||_kstYear()),interest=read(field);
  if(!_validDivTaxYear(year))return;
  const details=Object.fromEntries(DIV_TAX_DETAILS_FIELDS.map(key=>[key,read($el('div-tax-'+key))]));
  if(Object.values(details).some(Number.isNaN)||Number.isNaN(interest)){
    if(typeof showToast==='function')showToast('세금 가정은 0 이상의 원 단위 정수를 입력해 주세요.','error');
    return;
  }
  const summary=_divTaxSummary(calcDividends(year));
  const scenario=PlanCalculations.calculateDividendTaxScenario({normalGross:summary.normal.annual,reviewedGross:summary.normal.specialReviewed,pendingGross:summary.normal.specialPending,candidateGross:summary.normal.specialCandidate,interest,year,taxDetails:details});
  if(!scenario.adjustmentValid||!scenario.grossUpValid){
    if(typeof showToast==='function')showToast('비과세·특례배당·배당가산 금액이 과세 대상 금액을 초과합니다. 중복 여부를 확인하세요.','error');
    return;
  }
  if(_divTaxSyncConnection()){
    const signature=_divTaxFormSignature(year);
    _saveDivTaxRemote(year,interest,details,field.dataset?.taxRevision).then(result=>{
      if(typeof showToast==='function')showToast(result.ok?'귀속연도별 서버 저장 확인 · PC/모바일 공유':
        result.reason==='CONFLICT'?'다른 기기에서 변경됨 · 입력 보존, 서버값 불러온 뒤 다시 저장':
        '서버 저장 미확인 · 자동 재저장 없음, 서버값 다시 조회 필요',result.ok?'success':'error');
      if(result.ok&&_divTaxFormSignature(year)===signature)_rerenderDivTaxView();
    });
    return;
  }
  const saved=_saveDivTaxRecord(year,interest,details);
  if(typeof showToast==='function')showToast(saved?'귀속연도별 세제 가정 저장 완료 (현재 기기)':'기기 저장 실패 · 현재 세션에만 반영',saved?'success':'error');
  const area=$el('view-area');
  if(area){if(typeof currentView!=='undefined'&&currentView==='plan'&&typeof renderView==='function')renderView(true);else renderDivView(area,true);}
}
function _divScenarioForSummary(summary,year){
  return PlanCalculations.calculateDividendTaxScenario({normalGross:summary.normal.annual,reviewedGross:summary.normal.specialReviewed,pendingGross:summary.normal.specialPending,candidateGross:summary.normal.specialCandidate,year,interest:_getDivOtherIncome(year),taxDetails:_getDivTaxDetails(year)});
}
function _divTaxComparisonPanel(summary,year,scenario=_divScenarioForSummary(summary,year)){
  const money=v=>Math.round(v).toLocaleString('ko-KR'),d=_getDivTaxDetails(year)||{},c=scenario.comparison;
  const saved=_getDivTaxRecord(year),rules=PlanCalculations.financialIncomeRuleStatus(year);
  const remote=_divTaxRemoteStatus(year);
  const saveLabel=remote?(remote.failed?'서버 조회/저장 미확인 · 재조회 필요':remote.loading?'서버 조회 중':
    remote.revision==='0'?'서버 입력 없음 · 기존 기기값은 저장 시에만 공유':
    remote.revision?'서버 확인 · PC/모바일 공유':'서버 조회 전'):
    Object.prototype.hasOwnProperty.call(_divTaxSession,year)?'기기 저장 실패 · 현재 세션만':saved?'이 기기에 저장됨'+(saved.updatedAt?' · '+saved.updatedAt.slice(0,10):''):'저장된 입력 없음';
  if(remote)_readDivTaxRemote(year);
  const input=(id,label,value)=>'<label class="ui-status-meta" style="display:flex;flex-direction:column;gap:3px">'+label+'<input id="'+id+'" data-tax-year="'+year+'" data-tax-revision="'+(remote&&!remote.failed&&!remote.loading&&_divTaxRevisionValid(remote.revision)?remote.revision:'unverified')+'" type="text" inputmode="numeric" style="width:180px;max-width:100%" value="'+(value??'')+'" placeholder="미입력"></label>';
  const row=(label,v)=>'<tr><td>'+label+'</td><td>'+money(v)+'원</td></tr>';
  return '<section class="div-tax-panel" aria-label="금융소득 과세 비교"><h3 class="h3-card">금융소득 세액 비교 ('+year+'년)</h3>'+
    '<div class="ui-status-meta">연간 배당 기준 · 일반계좌 · 원 단위 · 과세자료 또는 시나리오 입력. 금융 원본 미변경. 계좌 귀속 미확인 '+money(summary.unclassified.annual)+'원은 비교 제외.</div>'+
    '<div class="ui-status-meta">세법: '+rules.label+' · '+saveLabel+(remote?'':' · 다른 기기와 자동 동기화하지 않음.')+'</div>'+
    '<div class="ui-status-meta">기업 명단·배당·계좌 분류는 자동 계산. NH 거래내역의 실제 과세 구분과 타 금융기관 소득은 아직 미연동.</div>'+
    '<details><summary>연간 세제 입력 (기본 2개 · 필요한 경우만)</summary>'+
    '<div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0">'+
    input('div-other-income-scenario','이자·기타 합산 금융소득 (배당 집계 외)',_getDivOtherIncome(year))+
    input('div-tax-otherTaxBase','다른 종합소득 과세표준 (총급여 아님)',d.otherTaxBase)+
    '</div><details><summary>상세 조정 (증권사 과세자료가 있는 경우만)</summary><div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0">'+
    input('div-tax-capitalExempt','과세 제외 감액배당 금액',d.capitalExempt)+input('div-tax-etfTaxDifference','ETF 분배금 중 과표 제외 차액',d.etfTaxDifference)+
    input('div-tax-certificateSpecial','과세자료상 특례배당 총액 (선택)',d.certificateSpecial)+
    input('div-tax-grossUpOrdinary','배당가산 대상 일반배당 (특례 제외)',d.grossUpOrdinary)+input('div-tax-grossUpSpecial','미신청 시 배당가산 대상 특례배당',d.grossUpSpecial)+
    '</div><div class="ui-status-meta">감액배당은 증권사 확인 과세제외액만 입력 (취득가액 제한 등 유의). 과표 차액과 중복 금지. 특례 총액 입력 시 공시 추정 대신 입력 총액 사용.</div></details>'+
    '<button type="button" class="btn-ghost-sm" data-div-action="apply-other-income">귀속연도별 저장</button>'+(remote?'<button type="button" class="btn-ghost-sm" data-div-action="reload-tax-scenario">서버값 다시 불러오기</button><div class="ui-status-meta">다시 불러오면 현재 입력칸은 서버 확인값으로 교체됩니다. 저장되지 않은 수정값은 먼저 확인하세요.</div>':'')+
    '<div class="ui-status-meta">빈칸은 미확인 (0과 구분). 기존 값을 지우고 저장하면 해당 금액 해제. 금융 원본 미변경.</div></details>'+
    (!scenario.adjustmentValid||!scenario.grossUpValid?'<div class="ui-status-text">입력 금액 재확인 필요 · 세액 비교 보류</div>':'')+
    '<div class="div-tax-table-scroll"><table class="div-tax-table"><tbody>'+row('현금 배당 총액',scenario.normalGross)+row('과세 제외 감액배당',scenario.capitalExempt)+row('ETF 과표 제외 차액',scenario.etfTaxDifference)+row('과세대상 배당 참고액',scenario.taxableGross)+row(scenario.certificateSpecialUsed?'입력 특례배당 총액':'공시 일치 특례배당',scenario.selectedSpecialGross)+row('특례 미신청 합산 금융소득',scenario.ordinaryWithoutApplication)+row('특례 신청 가정 합산 금융소득',scenario.ordinaryWithApplication)+
    (c?row('미신청 금융소득 추가 부담 (지방세 포함)',c.withoutApplication)+row('신청 금융소득 추가 부담 (지방세 포함)',c.withApplication)+row(c.savings>=0?'신청 가정 절감액':'신청 가정 추가 부담',Math.abs(c.savings)):'')+
    '</tbody></table></div><div class="ui-status-meta">'+(!rules.comparisonReviewed?'해당 귀속연도의 비교과세 세법은 아직 검증되지 않았습니다.':!c?'이자·기타 금융소득과 다른 종합소득 과세표준 입력 시 세액 비교 표시.':(c.grossUpKnown?'입력 배당가산 반영. ':'배당가산 미입력 항목 0 가정. ')+'제62조 비교과세·배당가산 10%·배당세액공제 한도 반영. 일반 14% 적용 금융소득 가정.')+
    ' 외국납부세액공제·당연종합과세·특수세율·기납부세액·기타 공제 및 건강보험료 미포함. 실제 신고세액 아님.</div></section>';
}

function _setDivTaxFilter(type) {
  _divTaxFilter=Object.prototype.hasOwnProperty.call(DIV_TAX_LABELS,type)?type:'all';
  const area=$el('view-area');
  if(area)renderDivView(area,true);
}

function _divAccountTaxType(acct) {
  const types=typeof ACCT_TAX_TYPES==='undefined'?{}:ACCT_TAX_TYPES||{};
  return PlanCalculations.classifyTaxType(Object.prototype.hasOwnProperty.call(types,acct)?types[acct]:'');
}

function _newDividendBucket() {return {annual:0,actual:0,received:0,monthly:{},specialReviewed:0,specialPending:0,specialCandidate:0}}
function _addDividendBucket(target,month,gross,declared,received) {
  target.annual+=gross;
  if(declared)target.actual+=gross;
  if(received)target.received+=gross;
  target.monthly[month]=(target.monthly[month]||0)+gross;
}
function _mergeDividendBucket(target,source) {
  if(!source)return target;
  for(const key of ['annual','actual','received','specialReviewed','specialPending','specialCandidate'])target[key]+=Number(source[key]||0);
  for(const [m,v] of Object.entries(source.monthly||{}))target.monthly[m]=(target.monthly[m]||0)+Number(v||0);
  return target;
}

function _divTaxSummary(dividendRows) {
  const result=Object.fromEntries(Object.keys(DIV_TAX_LABELS).map(k=>[k,_newDividendBucket()]));
  for(const row of dividendRows){
    for(const [acct,bucket] of Object.entries(row.accountDividendBreakdown||{}))
      _mergeDividendBucket(result[_divAccountTaxType(acct)],bucket);
    _mergeDividendBucket(result.unclassified,row.unallocatedDividendBreakdown);
    // Full total remains independent of hide-zero and view filters.
    _mergeDividendBucket(result.all,{annual:row.annualDiv,actual:row.actualDiv,received:row.receivedDiv,monthly:row.monthlyDiv});
  }
  return result;
}

function _divTaxFilteredRows(dividendRows,type) {
  if(type==='all')return dividendRows;
  return dividendRows.map(row=>{
    const selected=Object.entries(row.accountDividendBreakdown||{}).filter(([acct])=>_divAccountTaxType(acct)===type);
    const amount=_newDividendBucket();
    for(const [,b] of selected)_mergeDividendBucket(amount,b);
    if(type==='unclassified')_mergeDividendBucket(amount,row.unallocatedDividendBreakdown);
    const holdings=Object.entries(row.currentAccountQty||{}).filter(([acct])=>_divAccountTaxType(acct)===type);
    const accts=[...new Set([...selected.map(([acct])=>acct),...holdings.map(([acct])=>acct)])];
    return {...row,accts,totalQty:holdings.reduce((sum,[,qty])=>sum+Number(qty||0),0),
      annualDiv:amount.annual,actualDiv:amount.actual,receivedDiv:amount.received,monthlyDiv:amount.monthly};
  }).filter(row=>row.annualDiv>0||row.totalQty>0);
}

function _divTaxPanel(summary,selected,dividendRows=[]) {
  const types=['normal','isa','pension','irp','unclassified'];
  const money=v=>Math.round(v).toLocaleString('ko-KR');
  const year=_kstYear();
  const scenario=_divScenarioForSummary(summary,year);
  const catalog=PlanCalculations.dividendCompanyCatalogStatus(year);
  const delta=scenario.ordinaryWithApplication-scenario.threshold;
  const outside=scenario.appliedRule==='outside';
  return `<section class="div-tax-panel" aria-label="세제 유형별 연간 배당">
    <h3 class="h3-card">세제 유형별 연간 배당</h3>
    <div class="ui-status-meta">전체 보유·매도 종목의 지급연도 기준 · 세전 · 공시·등록 + 예상</div>
    <div class="div-tax-table-scroll"><table class="div-tax-table"><thead><tr><th>계좌 유형</th><th>연간 합계</th><th>공시·등록</th><th>예상분</th><th>입금확인(세전)</th></tr></thead><tbody>
    ${[...types,'all'].map(k=>`<tr class="${k==='all'?'div-tax-total':''}"><td>${k==='all'?'합계':DIV_TAX_LABELS[k]}</td><td>${money(summary[k].annual)}</td><td>${money(summary[k].actual)}</td><td>${money(summary[k].annual-summary[k].actual)}</td><td>${money(summary[k].received)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="ui-status-heading">고배당기업 분리과세 · 신청 가정</div>
    <div class="div-tax-table-scroll"><table class="div-tax-table"><tbody>
    <tr><td>미신청 시 금융소득 합산 참고</td><td>${money(scenario.ordinaryWithoutApplication)}원</td></tr>
    <tr><td>공시 근거 일치 특례배당 (참고)</td><td>${money(scenario.reviewedGross)}원</td></tr>
    <tr><td>특례 여부 미확인 (합산 유지)</td><td>${money(scenario.pendingGross)}원</td></tr>
    <tr><td>KIND 기업 일치 배당 (미확인에 포함)</td><td>${money(scenario.candidateGross)}원</td></tr>
    <tr><td>${scenario.certificateSpecialUsed?'과세자료 총액 적용 (후보 추가 차감 없음)':'기업 일치분까지 특례 가정 시 합산 참고'}</td><td>${money(scenario.ordinaryIfCandidatesQualify)}원</td></tr>
    <tr><td>신청 가정 적용 특례배당</td><td>${money(scenario.selectedSpecialGross)}원</td></tr>
    <tr><td>신청 가정 합산 대상</td><td>${money(scenario.ordinaryWithApplication)}원</td></tr>
    <tr><td>특례배당 예상세액 (지방세 포함)</td><td>${money(scenario.specialTax)}원</td></tr>
    </tbody></table></div>
    <div class="ui-status-text" style="color:${delta>0?'var(--amber)':'var(--muted)'}">금융소득종합과세 2,000만원 대비 · ${scenario.interestKnown?'입력 가정 포함':'배당만'} ${delta>0?'초과 '+money(delta)+'원':delta===0?'동일 (초과 아님)':'차이 '+money(-delta)+'원'} · ${scenario.interestKnown?'실제 금융소득은 별도 확인':'이자·기타 금융소득 미포함'}</div>
    <div class="ui-status-meta">KIND 기업 명단: ${catalog.state==='unavailable'?'미수신':(catalog.state==='stale'?'갱신 필요 · ':'')+catalog.total+'개 · '+catalog.retrievedAt.slice(0,10)} · 사업연도와 적용연도는 별도 확인</div>
    <div class="ui-status-meta">귀속 미분류 ${money(summary.unclassified.annual)}원은 합산액에 포함하지 않았습니다. 일반계좌라면 신청 가정 합산액이 최대 ${money(scenario.ordinaryWithApplication+summary.unclassified.annual)}원이 될 수 있습니다.</div>
    <div class="ui-status-meta">${outside?'이 지급연도는 현재 특례 적용기간 밖입니다.':'일부 지급건 공시 근거만 등록됨 ('+PlanCalculations.DIVIDEND_DISCLOSURE_AS_OF+' 점검) · KIND 기업 명단은 자동 갱신하며 일치분은 별도 시나리오로만 표시합니다. 미확인 및 추정분은 제외하지 않습니다.'} 실제 신청·정정공시·세무자료 확인 필요. 일반계좌 ETF는 세전 분배금으로 보수적 참고 (실제 과세표준은 증권사 확인). ISA·연금저축·IRP 내부 배당 제외. <a href="https://kind.krx.co.kr/valueup/dividend.do?method=valueupHighDividendMain" target="_blank" rel="noopener noreferrer">KIND 고배당기업</a> · <a href="https://www.nts.go.kr/nts/na/ntt/selectNttInfo.do?mi=2201&amp;nttSn=1349597" target="_blank" rel="noopener noreferrer">국세청 안내</a></div>
    ${_divTaxComparisonPanel(summary,year,scenario)}
    ${_divSpecialEvidenceTable(dividendRows,year)}
    <div class="div-month-filter div-tax-filter" role="group" aria-label="배당 계좌 유형 필터">${Object.keys(DIV_TAX_LABELS).map(k=>`<button type="button" data-div-action="filter-tax" data-div-tax="${k}" aria-pressed="${selected===k}" class="${selected===k?'active':''}">${DIV_TAX_LABELS[k]}</button>`).join('')}</div>
    <div class="ui-status-meta">아래 월별 예상 배당·종목별 상세에 선택 유형을 적용합니다. 상단 연간 합계 및 은행 실입금 검증은 전체 기준입니다.</div>
  </section>`;
}

function _divSpecialEvidenceTable(rows,year) {
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const result=[];
  for(const row of rows){
    const bucket=_newDividendBucket();
    for(const [acct,b] of Object.entries(row.accountDividendBreakdown||{}))if(_divAccountTaxType(acct)==='normal')_mergeDividendBucket(bucket,b);
    if(!bucket.specialPending&&!bucket.specialReviewed)continue;
    const company=PlanCalculations.dividendCompanyCandidate(row.taxCode,year);
    const evidenceRows=PlanCalculations.DIVIDEND_SPECIAL_REFERENCE.filter(e=>e.code===row.taxCode&&e.year===year);
    const eligibilityLinks=[...new Set(evidenceRows.map(e=>e.eligibilityUrl).filter(Boolean))];
    const paymentLinks=[...new Map(evidenceRows.filter(e=>e.paymentUrl).map(e=>[e.paymentUrl,e])).values()];
    const sourceLink=(url,label)=>'<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>';
    const evidenceLinks=[...eligibilityLinks.map(url=>sourceLink(url,'고배당 공시')), ...paymentLinks.map(e=>sourceLink(e.paymentUrl,e.recordDate?e.recordDate+' 배당':'배당 참고'))].join(' · ');
    result.push('<tr><td>'+esc(row.name)+'</td><td>'+Math.round(bucket.specialReviewed).toLocaleString('ko-KR')+'</td><td>'+Math.round(bucket.specialPending).toLocaleString('ko-KR')+'</td><td>'+((company.state==='reviewRequired'?'정정·재검토 · ':company.state==='candidate'?'KIND 해당 · ':company.state==='stale'?'갱신 필요 · ':'')+(evidenceLinks||'미확인'))+'</td></tr>');
  }
  return result.length?'<details><summary>종목별 특례 검토 금액 (일반계좌)</summary><div class="div-tax-table-scroll"><table class="div-tax-table"><thead><tr><th>종목</th><th>공시 일치</th><th>미확인</th><th>근거</th></tr></thead><tbody>'+result.join('')+'</tbody></table></div></details>':'';
}
function _setDivMonthFilter(month) {
  const next = Number(month);
  _divSelectedMonth = Number.isInteger(next) && next >= 1 && next <= 12 ? next : 0;
  const area = $el('view-area');
  if (area) renderDivView(area, true);
}

function _formatDividendChartManwon(value) {
  const amount = Number(value || 0);
  return amount > 0 ? `${Math.round(amount / 10000).toLocaleString()}만원` : '';
}

function _sortDividendMatrixRows(rows) {
  const annualDesc = (a, b) => Number(b.annualDiv || 0) - Number(a.annualDiv || 0)
    || String(a.name || '').localeCompare(String(b.name || ''), 'ko');
  return {
    stocks: rows.filter(row => row.assetType !== 'ETF').sort(annualDesc),
    etfs: rows.filter(row => row.assetType === 'ETF').sort(annualDesc),
  };
}

function calcDividends(year=_kstYear()) {
  // 보유 종목별 계좌 집계 (펀드 제외)
  const acctMap = {};
  const currentQtyMap = {};
  const currentAccountQty = {};
  rawHoldings.filter(h => !h.fund && h.name).forEach(h => {
    if (!acctMap[h.name]) acctMap[h.name] = [];
    if (h.acct && !acctMap[h.name].includes(h.acct)) acctMap[h.name].push(h.acct);
    currentQtyMap[h.name] = (currentQtyMap[h.name] || 0) + (Number(h.qty) || 0);
    if (h.acct) {
      currentAccountQty[h.name] ||= {};
      currentAccountQty[h.name][h.acct] = (currentAccountQty[h.name][h.acct] || 0) + (Number(h.qty) || 0);
    }
  });

  // ★ [버그수정] new Date() 로컬 타임존 → _kstYear() 으로 교체
  const thisYear = Number(year);

  const result = [];

  // DIVDATA에 있는 종목 기준으로 계산
  // ★ code 기반 키로 변경 — code → name 역매핑 필요
  const codeToNameMap = {};
  EDITABLE_PRICES.forEach(ep => {
    if (ep.code) codeToNameMap[ep.code] = ep.name;
  });

  Object.entries(DIVDATA).forEach(([key, dd]) => {
    if (!dd) return;
    const events = Array.isArray(dd.events) ? dd.events : [];
    const months = Array.isArray(dd.months) ? dd.months : [];
    const hasEstimate = Number(dd.perShare || 0) > 0 && months.length > 0;
    // 실제 배당 이벤트는 예상 주당 배당금/지급월이 없어도 집계할 수 있습니다.
    if (!hasEstimate && events.length === 0) return;

    // key가 코드이면 name으로 역매핑, 아니면 key 자체가 name
    const name = codeToNameMap[key] || key;
    const accts = acctMap[name] || [];
    const ep = typeof getEP === 'function' ? getEP(name) : null;
    const masterType = String(ep?.assetType || ep?.type || '').trim().toUpperCase();
    const assetType = masterType === 'ETF' ? 'ETF' : '주식';
    const taxSecurity=(ep&&['주식','STOCK'].includes(masterType))?(String(ep.currency||ep.cur||'').toUpperCase()==='USD'?'해외주식':'주식'):masterType;
    const taxCode=String(ep?.code||'').trim().toUpperCase();

    // ★ 실제 배당 이벤트가 있으면 해당 배당 기준일 보유수량 × 실제 주당배당금으로 우선 계산
    //   아직 이벤트가 없는 미래 지급월은 기존 perShare 평균값으로 예상치를 채워 연간 전망을 유지합니다.
    let annualDiv = 0;
    let actualDiv = 0; // declared/event-confirmed payout, NOT proven cash receipt
    let receivedDiv = 0; // gross amount with explicit payment confirmation
    let netReceivedDiv = 0; // ONLY bank net amounts explicitly typed by user
    let withheldTaxDiv = 0; // ONLY withholding amounts explicitly typed by user
    let netReceivedCount = 0, withheldTaxCount = 0;
    const monthlyDiv = {}; // month → declared + projected gross
    const monthlyDeclaredGross = {}, monthlyReceivedGross = {};
    const monthlyNetReceived = {}, monthlyWithheldTax = {};
    const monthlyNetCount = {}, monthlyTaxCount = {};
    const accountAnnualDiv = Object.create(null); // gross by entitlement-date account
    const accountDividendBreakdown = Object.create(null);
    const unallocatedDividendBreakdown = _newDividendBucket();
    let unallocatedAnnualDiv = 0;
    const accountNames = new Set(accts);
    const ledgerAvailable = typeof rawTrades !== 'undefined' && Array.isArray(rawTrades);
    if (ledgerAvailable) rawTrades.forEach(t => {
      if (t?.name === name && t.acct) accountNames.add(t.acct);
    });
    // Historical dividends belong to the account that owned the units on
    // entitlement date; current holdings must never reassign past income.
    const attributeGross = (date, month, gross, qty, declared, received, specialStatus) => {
      if (!(qty > 0) || !(gross > 0)) return;
      const splits = [];
      for (const acct of accountNames) {
        const units = ledgerAvailable && typeof getQtyAtDate === 'function'
          ? Number(getQtyAtDate(name, date, acct)) || 0
          : 0; // no historical ledger: do not guess account entitlement
        if (units > 0) splits.push({acct,units});
      }
      const sum = splits.reduce((total, part) => total + part.units, 0);
      // Neither tax category nor bank net payments may be inferred if the
      // historical account allocation disagrees with the total entitlement.
      if (!sum || Math.abs(sum - qty) > Math.max(0.000001, qty * 1e-8)) {
        unallocatedAnnualDiv += gross;
        _addDividendBucket(unallocatedDividendBreakdown,month,gross,declared,received);
        return;
      }
      splits.forEach(({acct,units}) => {
        const amount=gross*units/sum;
        accountAnnualDiv[acct]=(accountAnnualDiv[acct]||0)+amount;
        accountDividendBreakdown[acct] ||= _newDividendBucket();
        const bucket=accountDividendBreakdown[acct];
        _addDividendBucket(bucket,month,amount,declared,received);
        if(specialStatus==='reviewed')bucket.specialReviewed+=amount;
        else if(specialStatus==='pending'||specialStatus==='candidate'){bucket.specialPending+=amount;if(specialStatus==='candidate')bucket.specialCandidate+=amount;}
      });
    };
    const actualMonths = new Set();
    // Public provider results are company-level: common and preferred shares
    // may have the same record/payment date but different per-share amounts.
    // Without a matching share-class identifier, choosing the latest row
    // silently assigns a preferred dividend to common shares. Suppress only
    // those unresolved public events; never guess the lower amount.
    const publicAmountsByEvent = new Map();
    events.forEach(ev => {
      if (String(ev?.source || dd?.source || '') !== 'PUBLIC_DATA') return;
      const ref = String(ev?.date || '').slice(0, 10);
      const pay = String(ev?.payDate || '').slice(0, 10);
      const amount = Number(ev?.amount);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ref) || !(amount > 0)) return;
      const key = ref + '|' + pay;
      if (!publicAmountsByEvent.has(key)) publicAmountsByEvent.set(key, new Set());
      publicAmountsByEvent.get(key).add(amount);
    });
    const confirmedAmountsByEvent = new Map();
    events.forEach(ev => {
      if (ev?.receivedConfirmed !== true) return;
      const ref = String(ev?.date || '').slice(0, 10);
      const pay = String(ev?.payDate || '').slice(0, 10);
      const amount = Number(ev?.amount);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ref) || !(amount > 0)
          || !/^\d{4}-\d{2}-\d{2}$/.test(pay) || pay > _kstTodayStr()) return;
      const key = ref + '|' + pay;
      if (!confirmedAmountsByEvent.has(key)) confirmedAmountsByEvent.set(key, new Set());
      confirmedAmountsByEvent.get(key).add(amount);
    });
    const ambiguousPublicKeys = new Set(
      [...publicAmountsByEvent]
        .filter(([key, amounts]) => amounts.size > 1
          && confirmedAmountsByEvent.get(key)?.size !== 1)
        .map(([key]) => key)
    );
    for (const key of ambiguousPublicKeys) {
      const [ref, pay] = key.split('|');
      const cashDay = /^\d{4}-\d{2}-\d{2}$/.test(pay) ? pay : ref;
      if (Number(cashDay.slice(0, 4)) === thisYear)
        actualMonths.add(Number(cashDay.slice(5, 7)));
    }
    const ambiguousPublicEvents = ambiguousPublicKeys.size;
    // A corrected source amount for the same date/payment is a REPLACEMENT,
    // never an additional payment. Explicit user-confirmed records win.
    const uniqueEvents = new Map();
    events.forEach(ev => {
      const ref = String(ev?.date || '').slice(0,10);
      const pay = String(ev?.payDate || '').slice(0,10);
      const amount = Number(ev?.amount);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ref) || !(amount > 0)) return;
      const eventKey = ref + '|' + pay;
      if (ambiguousPublicKeys.has(eventKey)) return;
      const old = uniqueEvents.get(eventKey);
      // A duplicate provider update may omit verified bank evidence. Never
      // replace a richer manual receipt with a poorer confirmed flag alone.
      const rank = item => item?.receivedConfirmed !== true ? 0 :
        1 + (typeof item.netReceived === 'number' && Number.isFinite(item.netReceived) ? 2 : 0)
          + (typeof item.withheldTax === 'number' && Number.isFinite(item.withheldTax) ? 1 : 0);
      if (!old || rank(ev) >= rank(old)) uniqueEvents.set(eventKey, ev);
    });
    [...uniqueEvents.values()].forEach(ev => {
      const evDate = String(ev?.date || '').slice(0, 10);
      const amount = Number(ev?.amount || 0);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(evDate) || !amount || amount <= 0) return;
      const payDate = String(ev?.payDate || '').slice(0, 10);
      const cashflowDate = /^\d{4}-\d{2}-\d{2}$/.test(payDate) ? payDate : evDate;
      // 확정 배당의 귀속 연도는 배당기준일이 아니라 실제 지급일을 우선합니다.
      if (Number(cashflowDate.slice(0, 4)) !== thisYear) return;
      const month = Number(cashflowDate.slice(5, 7));
      const qty = (typeof getQtyAtDate === 'function')
        ? getQtyAtDate(name, evDate)
        : (currentQtyMap[name] || 0);
      if (qty <= 0) return;
      const div = amount * qty;
      actualMonths.add(month);
      actualDiv += div;
      monthlyDeclaredGross[month] = (monthlyDeclaredGross[month] || 0) + div;
      const receiptConfirmed=ev?.receivedConfirmed===true && /^\d{4}-\d{2}-\d{2}$/.test(payDate) && payDate<=_kstTodayStr();
      const special=typeof PlanCalculations==='undefined'?'pending':PlanCalculations.specialDividendEvidence({
        code:taxCode,assetType:taxSecurity,recordDate:evDate,payDate,amount,year:thisYear,declared:true}).status;
      attributeGross(evDate,month,div,qty,true,receiptConfirmed,special);
      if (receiptConfirmed) {
        receivedDiv += div;
        monthlyReceivedGross[month] = (monthlyReceivedGross[month] || 0) + div;
        // Manual gross receipt confirmation is not bank net deposit proof.
        // Imported historical events without these amounts remain unknown.
        if (typeof ev.netReceived === 'number'
            && Number.isFinite(ev.netReceived) && ev.netReceived >= 0) {
          netReceivedDiv += ev.netReceived; netReceivedCount++;
          monthlyNetReceived[month] = (monthlyNetReceived[month] || 0) + ev.netReceived;
          monthlyNetCount[month] = (monthlyNetCount[month] || 0) + 1;
        }
        if (typeof ev.withheldTax === 'number'
            && Number.isFinite(ev.withheldTax) && ev.withheldTax >= 0) {
          withheldTaxDiv += ev.withheldTax; withheldTaxCount++;
          monthlyWithheldTax[month] = (monthlyWithheldTax[month] || 0) + ev.withheldTax;
          monthlyTaxCount[month] = (monthlyTaxCount[month] || 0) + 1;
        }
      }
      annualDiv += div;
      monthlyDiv[month] = (monthlyDiv[month] || 0) + div;
    });

    if (hasEstimate && thisYear>=_kstYear()) months.forEach(month => {
      if (actualMonths.has(Number(month))) return;
      const refDate = getDivRefDate(thisYear, month);
      const qty = (typeof getQtyAtDate === 'function')
        ? getQtyAtDate(name, refDate)
        : (currentQtyMap[name] || 0);
      if (qty > 0) {
        const div = dd.perShare * qty;
        annualDiv += div;
        monthlyDiv[month] = (monthlyDiv[month] || 0) + div;
        const special=typeof PlanCalculations==='undefined'?'pending':PlanCalculations.specialDividendEvidence({
          code:taxCode,assetType:taxSecurity,year:thisYear,declared:false}).status;
        attributeGross(refDate,Number(month),div,qty,false,false,special);
      }
    });

    // 현재 보유수량 (표시용)
    const totalQty = currentQtyMap[name] || 0;

    if (annualDiv > 0 || totalQty > 0) {
      result.push({ name, assetType, taxCode, totalQty, accts, dd, annualDiv, monthlyDiv,
        actualDiv, receivedDiv, netReceivedDiv, withheldTaxDiv,
        netReceivedCount, withheldTaxCount, monthlyDeclaredGross,
        monthlyReceivedGross, monthlyNetReceived, monthlyWithheldTax,
        monthlyNetCount, monthlyTaxCount, accountAnnualDiv,
        unallocatedAnnualDiv, ambiguousPublicEvents, accountDividendBreakdown, unallocatedDividendBreakdown,
        currentAccountQty:currentAccountQty[name]||{} });
    }
  });

  return result;
}

function renderDivView(area, skipFetch) {
  _refreshDividendCompanyCatalog();
  // GS 연동 시 탭 진입마다 자동 fetch → 완료 후 재렌더 (skipFetch=true 시 생략 — 재귀 방지)
  if (GSHEET_API_URL && !skipFetch) _autoFetchDiv(area);

  // ★ [버그수정] NOW_MONTH(파일 로드 시 고정값) 대신 렌더링 시점의 KST 월/연도 사용
  const nowMonth  = _getNowMonth();
  const nowYear   = _kstYear();
  const dividendUpdatedTimes = Object.values(DIVDATA || {})
    .map(d => Date.parse(d?.updatedAt || ''))
    .filter(Number.isFinite);
  const dividendUpdatedAt = dividendUpdatedTimes.length ? new Date(Math.max(...dividendUpdatedTimes)) : null;
  const dividendUpdatedLabel = dividendUpdatedAt
    ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(dividendUpdatedAt)
    : '업데이트 기록 없음';

  // 수량 0 숨김 적용
  const allDivRows = calcDividends();
  const taxSummary=_divTaxSummary(allDivRows);
  const taxRows=_divTaxFilteredRows(allDivRows,_divTaxFilter);
  const divRows = _divHideZeroQty ? taxRows.filter(r => r.totalQty > 0) : taxRows;
  const ambiguousDividendNames = allDivRows.filter(r => r.ambiguousPublicEvents > 0).map(r => r.name);
  const totalAnnual   = divRows.reduce((s,r)=>s+r.annualDiv,0);
  const grandAnnual=taxSummary.all.annual;
  const totalActual=taxSummary.all.actual;
  const normalFlow=PlanCalculations.calculateDividendCashflow({dividends:[{taxType:'NORMAL',amount:taxSummary.normal.annual,specialReviewed:taxSummary.normal.specialReviewed,specialPending:taxSummary.normal.specialPending,specialCandidate:taxSummary.normal.specialCandidate}],year:nowYear,otherFinancialIncome:_getDivOtherIncome(nowYear),taxDetails:_getDivTaxDetails(nowYear)});
  const totalAfterTax=normalFlow.normalAfterTax;
  const monthlyAvg=Math.round(grandAnnual/12);
  const monthlyAfter=normalFlow.availableMonthly;

  // 투자원금 합산 (rows 기준, 배당 종목만)
  const divNames = new Set(allDivRows.map(r=>r.name));
  const totalCostForDiv = rows.filter(r=>divNames.has(r.name)).reduce((s,r)=>s+(r.costAmt||0),0);
  const yieldPct = totalCostForDiv > 0 ? (grandAnnual / totalCostForDiv * 100) : 0;

  // 월별 배당 집계
  const monthly = Array(12).fill(0);
  // ★ monthlyDiv: 월별 기준일 보유수량 반영된 배당금
  divRows.forEach(r => {
    if (r.monthlyDiv) {
      Object.entries(r.monthlyDiv).forEach(([m, div]) => { monthly[Number(m)-1] += div; });
    } else {
      r.dd.months.forEach(m => { monthly[m-1] += r.dd.perShare * r.totalQty; });
    }
  });

  // 올해 지난달까지 누적 수령액
  // Forecast months are NOT evidence of a cash deposit, even after month-end.
  const receivedSoFar = allDivRows.reduce((sum,r)=>sum+(r.receivedDiv||0),0);
  const netReceivedSoFar = allDivRows.reduce((sum,r)=>sum+(r.netReceivedDiv||0),0);
  const netReceivedEntries = allDivRows.reduce((sum,r)=>sum+(r.netReceivedCount||0),0);
  const withheldTaxSoFar = allDivRows.reduce((sum,r)=>sum+(r.withheldTaxDiv||0),0);
  const taxRecordedEntries = allDivRows.reduce((sum,r)=>sum+(r.withheldTaxCount||0),0);
  const remainingYear = Math.max(0,grandAnnual-receivedSoFar);
  // Real cashflow covers historical payments even when zero-current-qty is hidden.
  const cashMonths = Array.from({length:12},()=>({declared:0,confirmedGross:0,net:0,tax:0,netCount:0,taxCount:0}));
  allDivRows.forEach(r => cashMonths.forEach((m,i) => {
    const month=i+1;
    m.declared += Number(r.monthlyDeclaredGross?.[month] || 0);
    m.confirmedGross += Number(r.monthlyReceivedGross?.[month] || 0);
    m.net += Number(r.monthlyNetReceived?.[month] || 0);
    m.tax += Number(r.monthlyWithheldTax?.[month] || 0);
    m.netCount += Number(r.monthlyNetCount?.[month] || 0);
    m.taxCount += Number(r.monthlyTaxCount?.[month] || 0);
  }));
  const cashTotal = cashMonths.reduce((a,m)=>({
    declared:a.declared+m.declared,confirmedGross:a.confirmedGross+m.confirmedGross,
    net:a.net+m.net,tax:a.tax+m.tax,netCount:a.netCount+m.netCount,taxCount:a.taxCount+m.taxCount
  }),{declared:0,confirmedGross:0,net:0,tax:0,netCount:0,taxCount:0});
  const selectedMonth = _divSelectedMonth;
  const selectedMonthTotal = selectedMonth ? monthly[selectedMonth - 1] : totalAnnual;

  const publicKeyStatus = window.GAS_API_KEY_STATUS?.publicDataApiKeyConfigured;
  const publicKeySaved = publicKeyStatus === true;
  const publicKeyLabel = publicKeySaved ? '공공데이터 키 저장됨' : publicKeyStatus === false ? '공공데이터 키 미설정' : '공공데이터 키 상태 확인 중';

  let html = `

  ${ambiguousDividendNames.length ? `<div role="alert" style="border:1px solid var(--amber);border-radius:9px;padding:9px 12px;margin-bottom:12px;font-size:.72rem;color:var(--amber)">배당 기준일의 보통주·우선주 금액이 충돌합니다: ${ambiguousDividendNames.map(name => _escapeHtml(name)).join(', ')} · 해당 배당은 합계에서 제외하고 원본 검증이 필요합니다. 자동으로 금액을 선택하거나 원본을 변경하지 않습니다.</div>` : ''}
  <!-- ── 배당 자동 연동 + 수동 갱신 ── -->
  <div style="margin-bottom:14px">
    <div class="div-link-panel" style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:6px;padding:10px 12px;background:var(--s2);border:1px solid var(--border);border-radius:10px">
      <div style="display:flex;flex-direction:column;gap:2px">
        <div class="ui-status-heading" style="color:var(--text)">🔗 배당 연동 상태</div>
        <span id="dividendLinkStatus" data-state="${_dividendLinkState?.state || 'idle'}" class="ui-status-text">${_escapeHtml(_dividendLinkState?.message || (GSHEET_API_URL ? '자동 연동 대기 중' : 'GAS 연동 설정 필요'))}</span>
        <span id="sync-badge-div" class="ui-status-meta" title="외부 배당 API 조회와 무관하게, GAS에 저장된 배당 데이터를 이 브라우저로 다시 받은 최근 실행 결과입니다." style="font-size:.64rem;color:var(--muted)">${typeof _tabSyncText === 'function' ? _tabSyncText('div').text : ''}</span>
        <span class="ui-status-meta" title="현재 화면의 종목별 배당 데이터 updatedAt 중 가장 최근 시각입니다." style="font-size:.62rem;color:var(--muted)">📅 화면 배당 데이터 최근 갱신 · ${dividendUpdatedLabel}</span>
      </div>
      <div class="div-link-actions" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span class="div-gas-link-badge ${GSHEET_API_URL ? 'connected' : 'disconnected'}">${GSHEET_API_URL ? '☁️ GAS 연동 설정됨 · 저장 시 동기화' : '○ GAS 미연동'}</span>
        ${GSHEET_API_URL ? `<button id="divFetchBtn" data-div-action="fetch" class="btn-amber-sm" title="ETF는 SEIBro에서 강제 재조회하고, 일반 종목은 공공데이터에서 다시 조회한 뒤 검증된 결과를 GAS에 저장합니다." ${_dividendLinkState?.state === 'syncing' ? 'disabled' : ''}>📥 배당 데이터 갱신</button>` : ''}
        <button data-sync-tab="div" id="sync-btn-div" class="btn-purple-sm" title="외부 배당 API를 호출하지 않고 GAS에 마지막으로 저장된 DIVDATA를 현재 브라우저로 다시 받습니다." ${GSHEET_API_URL && _dividendLinkState?.state !== 'syncing' ? '' : 'disabled'}>☁️ GAS 데이터 다시 받기</button>
      </div>
    </div>
    <div style="font-size:.65rem;color:var(--muted);margin-top:4px;padding:0 2px">
      ${GSHEET_API_URL ? '배당 데이터 갱신 = 외부 소스 재조회 후 GAS 저장 · GAS 데이터 다시 받기 = 저장된 데이터를 이 브라우저로 복원' : 'GAS 연동 설정이 필요합니다.'}
    </div>
  </div>

  <div style="background:var(--s2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap">
    <div>
      <div class="ui-status-heading" style="color:var(--text)">🧾 배당 API 상태</div>
      <div style="font-size:.62rem;color:var(--muted);margin-top:2px">ETF는 배당 탭 진입 시 GAS가 SEIBro 이력을 자동 갱신합니다. 일반 종목은 공공데이터에서 조회하며, 조회·저장이 미확인인 자료는 기존 값을 유지하고 경고합니다.</div>
    </div>
    <span style="font-size:.62rem;color:${publicKeySaved ? 'var(--green-lt)' : 'var(--amber)'};border:1px solid var(--border);border-radius:999px;padding:3px 8px;background:var(--s1)">${publicKeyLabel}</span>
    <div id="divFetchStatus" style="flex-basis:100%;font-size:.66rem;color:var(--muted);min-height:1.2em"></div>
  </div>

  <!-- ── 수량 0 숨김 토글 ── -->
  <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
    <button data-div-action="toggle-zero" class="btn-sort-toggle${_divHideZeroQty?' active':''}" style="font-size:.70rem">
      ${_divHideZeroQty ? '👁 전체 보기' : '🙈 수량 0 숨김'}
    </button>
  </div>

  <!-- ── 요약 카드 5개 — PC: 1줄, 모바일: 2×2+1 ── -->
  <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:14px" class="div-summary-grid">
    <div class="div-stat-card">
      <div class="div-stat-label">💸 연간 예상 (세전)</div>
      <div class="div-stat-value" style="color:var(--cyan)">${fmtW(Math.round(grandAnnual))}</div>
      <div class="div-stat-sub">공시·등록 ${fmtW(Math.round(totalActual))} · ${allDivRows.length}개</div>
    </div>
    <div class="div-stat-card">
      <div class="div-stat-label">📅 월 평균 (세전)</div>
      <div class="div-stat-value c-green">${fmtW(monthlyAvg)}</div>
      <div class="div-stat-sub">전체 계좌 · 세전</div>
    </div>
    <div class="div-stat-card">
      <div class="div-stat-label">일반계좌 연간 세후 참고</div>
      <div class="div-stat-value c-amber">${fmtW(totalAfterTax)}</div>
      <div class="div-stat-sub">15.4% 단순 가정 · 월 ${fmtW(monthlyAfter)} · 최종 세액 아님</div>
    </div>
    <div class="div-stat-card">
      <div class="div-stat-label">📊 배당수익률</div>
      <div class="div-stat-value" style="color:var(--purple)">${yieldPct.toFixed(2)}<span style="font-size:.65rem">%</span></div>
      <div class="div-stat-sub">투자원금 대비 연간</div>
    </div>
    <div class="div-stat-card">
      <div class="div-stat-label">✅ 올해 입금 확인 (수동·세전)</div>
      <div class="div-stat-value c-green">${fmtW(Math.round(receivedSoFar))}</div>
      <div class="div-stat-sub">세후 실입금 직접기록 ${netReceivedEntries}건 ${netReceivedEntries ? fmtW(Math.round(netReceivedSoFar)) : '미입력'} · 원천징수 직접기록 ${taxRecordedEntries}건 ${taxRecordedEntries ? fmtW(Math.round(withheldTaxSoFar)) : '미입력'} · 미입금 확인·예상 ${fmtW(Math.round(remainingYear))}</div>
    </div>
  </div>

  ${_divTaxPanel(taxSummary,_divTaxFilter,allDivRows)}

  <!-- ── Verified bank cashflow versus published gross dividend ── -->
  <section aria-label="배당 현금흐름 검증" style="background:var(--s1);border:1px solid var(--border);border-radius:12px;padding:13px 14px;margin-bottom:14px">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:7px">
      <strong style="font-size:var(--type-body)">월별 배당 현금흐름 · 실입금 확인 (전체)</strong>
      <span style="font-size:.66rem;color:var(--muted)">${cashTotal.netCount ? `은행 실입금 직접기록 ${cashTotal.netCount}건` : '은행 실입금 내역 미등록'}</span>
    </div>
    <div style="font-size:.64rem;color:var(--muted);margin-bottom:9px">공시 세전금액은 입금 증명이 아닙니다. 실제 세후 입금액·원천세는 사용자가 확인한 금액만 집계하며, 미등록은 0원으로 간주하지 않습니다. 아래 수치는 지급일 기준이며 지급일 미등록 건은 기준일을 사용한 참고값입니다.</div>
    <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px;font-size:.72rem">
      <span>공시·등록 세전 <b>${fmtW(Math.round(cashTotal.declared))}</b></span>
      <span>수동 입금확인 세전 <b>${fmtW(Math.round(cashTotal.confirmedGross))}</b></span>
      <span>은행 실입금 <b>${cashTotal.netCount ? fmtW(Math.round(cashTotal.net)) : '미등록'}</b></span>
      <span>실제 원천세 <b>${cashTotal.taxCount ? fmtW(Math.round(cashTotal.tax)) : '미등록'}</b></span>
    </div>
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
      <table style="width:100%;min-width:490px;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:.70rem">
        <thead><tr style="background:var(--s2);color:var(--muted)"><th style="padding:6px;text-align:left">월</th><th style="padding:6px;text-align:right">공시 세전</th><th style="padding:6px;text-align:right">입금확인 세전</th><th style="padding:6px;text-align:right">은행 실입금</th><th style="padding:6px;text-align:right">원천세</th></tr></thead>
        <tbody>${cashMonths.map((m,i)=>`<tr style="border-bottom:1px solid var(--border)"><td style="padding:5px 6px">${i+1}월</td><td style="padding:5px 6px;text-align:right">${m.declared ? fmtW(Math.round(m.declared)) : '–'}</td><td style="padding:5px 6px;text-align:right">${m.confirmedGross ? fmtW(Math.round(m.confirmedGross)) : '–'}</td><td style="padding:5px 6px;text-align:right">${m.netCount ? fmtW(Math.round(m.net)) : '미등록'}</td><td style="padding:5px 6px;text-align:right">${m.taxCount ? fmtW(Math.round(m.tax)) : '미등록'}</td></tr>`).join('')}</tbody>
      </table>
    </div>
  </section>

  <!-- ── 월별 필터 + 바 차트 ── -->
  <div style="background:var(--s1);border:1px solid var(--border);border-radius:14px;padding:16px 18px;margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:6px">
      <div>
        <div style="font-size:var(--type-body);font-weight:650">📅 ${nowYear}년 월별 배당 · ${DIV_TAX_LABELS[_divTaxFilter]}</div>
        <div style="font-size:.65rem;color:var(--muted);margin-top:2px">확정+예상 · 현재월 <span style="color:var(--cyan)">${nowMonth}월</span></div>
      </div>
      <div style="display:flex;gap:10px;font-size:.63rem;color:var(--muted);align-items:center;flex-shrink:0">
        <span><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:var(--muted);opacity:.72;margin-right:3px;vertical-align:middle"></span>지난달</span>
        <span><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:var(--cyan);margin-right:3px;vertical-align:middle"></span>이번달</span>
        <span><span style="display:inline-block;width:7px;height:7px;border-radius:2px;background:var(--green);margin-right:3px;vertical-align:middle"></span>예정</span>
      </div>
    </div>
    <div class="div-month-filter" role="group" aria-label="배당 월 필터">
      <button type="button" data-div-action="filter-month" data-div-month="0" class="${selectedMonth === 0 ? 'active' : ''}">연간 전체</button>
      ${Array.from({length:12}, (_, i) => `<button type="button" data-div-action="filter-month" data-div-month="${i+1}" class="${selectedMonth === i+1 ? 'active' : ''}">${i+1}월</button>`).join('')}
    </div>
    <div class="div-month-selection">
      <span>${selectedMonth ? `${selectedMonth}월 예상 배당` : '연간 예상 배당'}</span>
      <strong>${fmtW(Math.round(selectedMonthTotal))}</strong>
      <small>${selectedMonth ? `${divRows.filter(r => Number(r.monthlyDiv?.[selectedMonth] || 0) > 0).length}개 종목` : `${divRows.length}개 종목`}</small>
    </div>
    <div class="div-month-chart-scroll">
    <div class="div-month-chart" style="display:flex;align-items:flex-end;gap:3px;height:110px;padding-bottom:18px;position:relative">
      ${(() => {
        const maxV = Math.max(...monthly, 1);
        return monthly.map((v, i) => {
          const isPast    = (i + 1) < nowMonth;
          const isCurrent = (i + 1) === nowMonth;
          const pct = v > 0 ? Math.max((v / maxV) * 100, 3) : 1;
          const label = _formatDividendChartManwon(v);
          const bg = isCurrent
            ? 'linear-gradient(to top,color-mix(in srgb,var(--cyan) 32%,transparent),var(--cyan))'
            : isPast
            ? 'linear-gradient(to top,color-mix(in srgb,var(--muted) 38%,transparent),var(--muted))'
            : 'linear-gradient(to top,color-mix(in srgb,var(--green) 28%,transparent),var(--green))';
          const border = isCurrent ? '1px solid var(--cyan)' : isPast ? '1px solid color-mix(in srgb,var(--muted) 72%,transparent)' : 'none';
          const labelColor = isCurrent ? 'var(--cyan)' : isPast ? 'var(--text)' : 'var(--green)';
          const monthColor = isCurrent ? 'var(--cyan)' : 'var(--muted)';
          const fw = isCurrent ? '700' : '400';
          const isSelected = selectedMonth === i + 1;
          return `<button type="button" data-div-action="filter-month" data-div-month="${i+1}" aria-label="${i+1}월 배당 ${Math.round(v).toLocaleString()}원" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;border:none;background:transparent;cursor:pointer;padding:0;opacity:${selectedMonth && !isSelected ? '.45' : '1'}">
            ${label ? `<div class="div-month-bar-label" style="color:${labelColor};font-weight:${fw};margin-bottom:2px;white-space:nowrap;max-width:100%;text-align:center">${label}</div>` : '<div style="margin-bottom:10px"></div>'}
            <div style="width:100%;height:${pct}%;background:${bg};border:${isSelected ? '2px solid var(--gold)' : border};border-radius:3px 3px 0 0;box-shadow:${isSelected ? '0 0 8px var(--c-amber-40)' : isCurrent?'0 0 6px var(--c-cyan-50)':'none'}"></div>
            <div class="div-month-bar-month" style="color:${monthColor};font-weight:${fw};margin-top:2px">${i+1}월</div>
          </button>`;
        }).join('');
      })()}
    </div></div>
  </div>

  <!-- ── 종목별 월별 배당 매트릭스 ── -->
  <div class="div-monthly-matrix">
    <div class="div-monthly-matrix-head">
      <div><strong>📊 종목별 월별 배당</strong><span>선택 유형: ${DIV_TAX_LABELS[_divTaxFilter]} · 월별 확정+예상 금액</span></div>
      <small>단위: 원 · 주식/ETF 구분 · 연간금액 내림차순</small>
    </div>
    <div class="div-monthly-matrix-scroll">
      <table>
        <thead><tr><th>종목명</th>${Array.from({length:12}, (_, i) => `<th class="${selectedMonth === i+1 ? 'selected' : ''}">${i+1}월</th>`).join('')}<th>연간</th></tr></thead>
        <tbody>${(() => {
          const groups = _sortDividendMatrixRows(divRows);
          const renderRows = rows => rows.map(r => `<tr><td><span class="div-asset-badge ${r.assetType === 'ETF' ? 'etf' : 'stock'}">${r.assetType}</span>${_escapeHtml(r.name)}</td>${Array.from({length:12}, (_, i) => { const value = Number(r.monthlyDiv?.[i+1] || 0); return `<td class="${selectedMonth === i+1 ? 'selected' : ''}">${value > 0 ? Math.round(value).toLocaleString() : '–'}</td>`; }).join('')}<td>${Math.round(r.annualDiv).toLocaleString()}</td></tr>`).join('');
          const renderGroup = (label, rows, badgeClass) => rows.length ? `<tr class="div-monthly-group"><th colspan="14"><span class="div-asset-badge ${badgeClass}">${label}</span> 연간금액 높은 순 · ${rows.length}종목</th></tr>${renderRows(rows)}` : '';
          return renderGroup('주식', groups.stocks, 'stock') + renderGroup('ETF', groups.etfs, 'etf');
        })()}</tbody>
        <tfoot><tr><th>합계</th>${monthly.map((value, i) => `<th class="${selectedMonth === i+1 ? 'selected' : ''}">${value > 0 ? Math.round(value).toLocaleString() : '–'}</th>`).join('')}<th>${Math.round(totalAnnual).toLocaleString()}</th></tr></tfoot>
      </table>
    </div>
  </div>`;

  // ── 종목별 배당 테이블 (PC: 풀 테이블, 모바일: 카드형)
  const sorted = [...divRows]
    .filter(r => !selectedMonth || Number(r.monthlyDiv?.[selectedMonth] || 0) > 0)
    .sort((a,b) => selectedMonth
      ? Number(b.monthlyDiv?.[selectedMonth] || 0) - Number(a.monthlyDiv?.[selectedMonth] || 0)
      : b.annualDiv - a.annualDiv);

  // PC 테이블
  html += `
  <div style="background:var(--s1);border:1px solid var(--border);border-radius:12px;margin-bottom:14px;overflow:hidden" class="div-tbl-wrap">
    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-bottom:1px solid var(--border)">
      <h3 style="margin:0;font-size:var(--type-body);font-weight:650">💸 종목별 배당 상세 · ${DIV_TAX_LABELS[_divTaxFilter]}${selectedMonth ? ` · ${selectedMonth}월` : ''}</h3>
      <div style="font-size:.70rem;color:var(--cyan)">${selectedMonth ? `${selectedMonth}월` : '연간'} 합계 <b>${fmtW(Math.round(selectedMonthTotal))}</b></div>
    </div>
    <div style="overflow-x:auto;-webkit-overflow-scrolling:touch">
    <table style="width:100%;border-collapse:collapse;min-width:560px">
      <thead>
        <tr style="background:var(--s2)">
          <th style="padding:7px 14px;text-align:left;font-size:.68rem;color:var(--muted);font-weight:600">종목명</th>
          <th style="padding:7px 8px;text-align:center;font-size:.68rem;color:var(--muted);font-weight:600">구분</th>
          <th style="padding:7px 8px;text-align:center;font-size:.68rem;color:var(--muted);font-weight:600">주기</th>
          <th style="padding:7px 8px;text-align:right;font-size:.68rem;color:var(--muted);font-weight:600">현재 수량</th>
          <th style="padding:7px 8px;text-align:right;font-size:.68rem;color:var(--muted);font-weight:600">주당</th>
          <th style="padding:7px 8px;text-align:left;font-size:.68rem;color:var(--muted);font-weight:600">지급월</th>
          <th style="padding:7px 8px;text-align:right;font-size:.68rem;color:var(--muted);font-weight:600">연간(세전)</th>
          <th style="padding:7px 8px;text-align:right;font-size:.68rem;color:var(--muted);font-weight:600">${selectedMonth ? `${selectedMonth}월` : '월평균'}(세전)</th>
          <th style="padding:7px 8px;text-align:right;font-size:.68rem;color:var(--muted);font-weight:600">수익률</th>
        </tr>
      </thead>
      <tbody>`;

  sorted.forEach(r => {
    const acctDots  = r.accts.map(a=>`<span class="adot" style="background:${ACCT_COLORS[a]}" title="${a}"></span>`).join('');
    const monthBadges = r.dd.months.map(m=>`<span style="display:inline-block;padding:1px 4px;border-radius:3px;font-size:.65rem;background:rgba(34,211,238,.12);color:var(--cyan);margin:1px">${m}월</span>`).join('');
    const freqColors = { '월배당':'var(--green)', '분기':'var(--blue)', '반기':'var(--purple)', '연간':'var(--amber)' };
    const fCol = freqColors[r.dd.freq] || 'var(--muted)';
    const costAmt = rows.filter(rr=>rr.name===r.name&&(_divTaxFilter==='all'||_divAccountTaxType(rr.acct)===_divTaxFilter)).reduce((s,rr)=>s+(rr.costAmt||0),0);
    const yld = _divTaxFilter!=='unclassified' && costAmt > 0 ? (r.annualDiv / costAmt * 100).toFixed(2) : '-';
    const monthlyDiv = Math.round(selectedMonth ? Number(r.monthlyDiv?.[selectedMonth] || 0) : r.annualDiv / 12);

    html += `<tr style="border-top:1px solid var(--border)">
      <td style="padding:9px 14px">
        <div style="font-weight:600;font-size:var(--type-body)">${r.name}</div>
        <div style="font-size:.63rem;color:var(--muted);margin-top:1px">${acctDots} ${r.accts.join('·')}</div>
      </td>
      <td style="padding:9px 8px;text-align:center"><span class="div-asset-badge ${r.assetType === 'ETF' ? 'etf' : 'stock'}">${r.assetType}</span></td>
      <td style="padding:9px 8px;text-align:center">
        <span style="display:inline-block;padding:2px 6px;border-radius:4px;font-size:.63rem;font-weight:700;background:${fCol}22;color:${fCol}">${r.dd.freq}</span>
      </td>
      <td style="padding:9px 8px;text-align:right;font-size:var(--type-body);font-variant-numeric:tabular-nums">${r.totalQty.toLocaleString()}</td>
      <td style="padding:9px 8px;text-align:right;font-size:var(--type-body);font-variant-numeric:tabular-nums">${r.dd.perShare.toLocaleString()}</td>
      <td style="padding:9px 8px">${monthBadges}</td>
      <td style="padding:9px 8px;text-align:right;color:var(--cyan);font-weight:600;font-variant-numeric:tabular-nums">${fmtW(Math.round(r.annualDiv))}</td>
      <td style="padding:9px 8px;text-align:right;color:var(--green);font-variant-numeric:tabular-nums">${fmtW(monthlyDiv)}</td>
      <td style="padding:9px 8px;text-align:right;color:var(--purple);font-variant-numeric:tabular-nums">${yld !== '-' ? yld+'%' : '-'}</td>
    </tr>`;
  });

  html += `</tbody></table></div></div>`;

  // ── 모바일 카드형 (JS로 화면 폭 분기)
  html += `<div class="div-card-list" style="display:none;margin-bottom:14px">`;
  sorted.forEach(r => {
    const freqColors = { '월배당':'var(--green)', '분기':'var(--blue)', '반기':'var(--purple)', '연간':'var(--amber)' };
    const fCol = freqColors[r.dd.freq] || 'var(--muted)';
    const costAmt = rows.filter(rr=>rr.name===r.name&&(_divTaxFilter==='all'||_divAccountTaxType(rr.acct)===_divTaxFilter)).reduce((s,rr)=>s+(rr.costAmt||0),0);
    const yld = _divTaxFilter!=='unclassified' && costAmt > 0 ? (r.annualDiv / costAmt * 100).toFixed(2) : '-';
    const monthlyDiv = Math.round(selectedMonth ? Number(r.monthlyDiv?.[selectedMonth] || 0) : r.annualDiv / 12);
    const monthBadges = r.dd.months.map(m=>`<span style="display:inline-block;padding:1px 4px;border-radius:3px;font-size:.65rem;background:rgba(34,211,238,.12);color:var(--cyan);margin:1px">${m}월</span>`).join('');
    const acctDots = r.accts.map(a=>`<span class="adot" style="background:${ACCT_COLORS[a]}"></span>`).join('');
    html += `
    <div style="background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:var(--type-body);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.name}</div>
          <div style="font-size:.62rem;color:var(--muted);margin-top:1px">${acctDots} ${r.accts.join('·')}</div>
        </div>
        <div style="display:flex;gap:4px;align-items:center;flex-shrink:0;margin-left:8px"><span class="div-asset-badge ${r.assetType === 'ETF' ? 'etf' : 'stock'}">${r.assetType}</span><span style="display:inline-block;padding:2px 7px;border-radius:4px;font-size:.62rem;font-weight:700;background:${fCol}22;color:${fCol}">${r.dd.freq}</span></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:var(--type-body)">
        <div style="background:var(--s2);border-radius:6px;padding:7px 10px">
          <div style="font-size:.65rem;color:var(--muted);margin-bottom:2px">연간(세전)</div>
          <div style="font-weight:700;color:var(--cyan);font-variant-numeric:tabular-nums">${fmtW(Math.round(r.annualDiv))}</div>
        </div>
        <div style="background:var(--s2);border-radius:6px;padding:7px 10px">
          <div style="font-size:.65rem;color:var(--muted);margin-bottom:2px">${selectedMonth ? `${selectedMonth}월` : '월평균'}(세전)</div>
          <div style="font-weight:600;color:var(--green);font-variant-numeric:tabular-nums">${fmtW(monthlyDiv)}</div>
        </div>
        <div style="background:var(--s2);border-radius:6px;padding:7px 10px">
          <div style="font-size:.65rem;color:var(--muted);margin-bottom:2px">주당 배당금</div>
          <div style="font-variant-numeric:tabular-nums">${r.dd.perShare.toLocaleString()}</div>
        </div>
        <div style="background:var(--s2);border-radius:6px;padding:7px 10px">
          <div style="font-size:.65rem;color:var(--muted);margin-bottom:2px">수익률</div>
          <div style="color:var(--purple);font-variant-numeric:tabular-nums">${yld !== '-' ? yld+'%' : '-'}</div>
        </div>
      </div>
      <div style="margin-top:8px;font-size:.62rem;color:var(--muted)">지급월: ${monthBadges || '-'}</div>
    </div>`;
  });
  html += `</div>`;

  // 배당 없는 종목
  const noDivNames = rawHoldings
    .filter(h => {
      if (h.fund) return false;
      const divKey = (typeof getDivKey === 'function') ? getDivKey(h.name) : h.name;
      const dd = DIVDATA[divKey] || DIVDATA[h.name];
      return !dd || dd.perShare === 0;
    })
    .map(h=>h.name).filter((v,i,a)=>a.indexOf(v)===i);
  if (noDivNames.length > 0) {
    html += `<div style="background:var(--s1);border:1px solid var(--border);border-radius:10px;padding:10px 14px;font-size:.75rem;color:var(--muted);margin-bottom:14px">
      <span style="font-weight:600;color:var(--text)">🚫 배당 없는 종목</span>
      <span style="margin-left:8px">${noDivNames.join(' · ')}</span>
    </div>`;
  }

  // 배당 설정 수동 편집
  html += `<div class="card-12">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div>
        <div style="font-size:.78rem;font-weight:700;color:var(--gold)">⚙️ 배당 설정 수동 편집</div>
        <div style="font-size:.62rem;color:var(--muted);margin-top:2px">ETF 등 자동 조회가 안 되는 종목은 직접 등록할 수 있으며, 입력값은 GAS에 저장됩니다.</div>
      </div>
    </div>
    <div id="divMgmtBody" style="max-height:420px;overflow-y:auto"></div>
  </div>

  <div id="divManualModal" style="display:none;position:fixed;inset:0;z-index:10020;background:rgba(2,6,23,.72);align-items:center;justify-content:center;padding:16px">
    <div style="width:min(440px,100%);background:var(--s1);border:1px solid var(--border);border-radius:14px;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,.45)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px">
        <div id="divManualTitle" style="font-size:var(--type-body);font-weight:650;color:var(--text)">배당 수동 입력</div>
        <button type="button" data-div-action="manual-close" class="btn-cancel-sm">✕</button>
      </div>
      <label class="lbl-62-muted-3" for="dv_amt_manual">주당 배당금 (원)</label>
      <input type="number" min="0" step="any" id="dv_amt_manual" placeholder="예: 350" class="input-full-73" style="margin:5px 0 12px"/>
      <div style="font-size:.61rem;color:var(--muted);margin:-7px 0 12px">향후 예상 계산용 기본 금액입니다. 실제 지급액은 아래 배당 건별 금액을 우선 적용합니다.</div>
      <div class="lbl-62-muted-3">지급 주기</div>
      <input type="hidden" id="dv_freq_manual" value="-"/>
      <div id="dv_freq_grp_manual" style="display:flex;flex-wrap:wrap;gap:4px;margin:5px 0 12px"></div>
      <label class="lbl-62-muted-3" for="dv_months_manual">지급 월</label>
      <input type="text" id="dv_months_manual" placeholder="예: 1,4,7,10" class="input-full-73" style="margin:5px 0 4px"/>
      <div style="font-size:.61rem;color:var(--muted);margin-bottom:14px">여러 달은 쉼표로 구분하며 1~12월만 입력할 수 있습니다.</div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:12px 0 7px">
        <div>
          <div class="lbl-62-muted-3">배당 건별 입력</div>
          <div style="font-size:.60rem;color:var(--muted);margin-top:2px">금액이 매번 다르면 기준일·지급일·주당 금액을 각각 입력하세요.</div>
        </div>
        <button type="button" data-div-action="manual-event-add" class="btn-purple-sm">＋ 배당 건</button>
      </div>
      <div id="divManualEvents" style="max-height:220px;overflow-y:auto;padding-right:2px"></div>
      <div style="font-size:.60rem;color:var(--cyan);margin:8px 0 10px">☁️ 저장 시 연결된 Google Apps Script의 설정 시트에 반영됩니다.</div>
      <div style="display:flex;justify-content:flex-end;gap:7px">
        <button type="button" data-div-action="manual-close" class="btn-cancel-sm">취소</button>
        <button type="button" data-div-action="manual-save" class="btn-amber-sm">💾 저장</button>
      </div>
    </div>
  </div>`;

  area.innerHTML = html;
  buildDivMgmt();

  // ── PC/모바일 분기: 560px 이하면 카드형, 초과면 테이블
  (function applyDivLayout() {
    const tbl  = area.querySelector('.div-tbl-wrap');
    const card = area.querySelector('.div-card-list');
    const grid = area.querySelector('.div-summary-grid');
    if (!tbl || !card) return;
    const isMobile = window.innerWidth <= 560;
    tbl.style.display  = isMobile ? 'none' : '';
    card.style.display = isMobile ? '' : 'none';
    if (grid) grid.style.gridTemplateColumns = isMobile ? 'repeat(2,1fr)' : 'repeat(5,1fr)';
    // 모바일 요약 카드 5번째 항목 full-width
    if (grid) {
      const cards = grid.querySelectorAll('.div-stat-card');
      if (cards.length === 5) {
        cards[4].style.gridColumn = isMobile ? 'span 2' : '';
      }
    }
  })();
}

// LOAN VIEW + 부동산
// LOAN, REAL_ESTATE 선언 → loadHoldings 앞으로 이동 (복원 순서 보장)
function _toggleDivHideZero() {
  _divHideZeroQty = !_divHideZeroQty;
  if (typeof lsSave === 'function') lsSave(DIV_HIDE_ZERO_KEY, _divHideZeroQty);
  const area = $el('view-area');
  if (area) renderDivView(area, true);
}
