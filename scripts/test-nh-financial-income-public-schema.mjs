import assert from 'node:assert/strict';
import {inspectFinancialIncomeContract} from './nh-financial-income-public-schema.mjs';
const fields=keys=>Object.fromEntries(keys.map(k=>[k,{type:'string'}]));
const mk=(required,keys,tax)=>({parameters:[{$ref:'#/components/parameters/CtsHeader'}],requestBody:{content:{'application/json':{schema:{properties:{Input_0:{required,properties:fields(required)}}}}}},responses:{'200':{content:{'application/json':{schema:{properties:{Output_0:{type:'array',items:{properties:{...fields(keys),...(tax?{tax:{description:'세금합계'}}:{})}}}}}}}}}});
const spec={components:{parameters:{CtsHeader:{name:'cts'}}},paths:{
 '/n2/acctinfo':{post:mk([],['acct_no','acct_type'],false)},
 '/common/inquiry/v1/totalTransaction':{post:mk(['iqr_tp_cd','iqr_rge_cd','act_no','iqr_sta_dt','iqr_end_dt','iem_llf_cd','act_trd_dtl_cd'],['cur_cd','trd_dt','iem_cd','trd_amt','int_amt','tax_sum','sps_cd_krl_anm'],true)},
 '/common/inquiry/v1/depositWithdrawal':{post:mk(['iqr_tp_cd','act_no','iqr_sta_dt','iqr_end_dt','act_trd_dtl_cd'],['trd_dt','trd_amt','sps_cd_krl_anm','act_trd_tp_nm'],false)}}};
const result=inspectFinancialIncomeContract(spec);
assert.equal(result.accountsAccessed,false);assert.equal(result.financialTaxClassificationVerified,false);
assert.equal(result.endpoints[0].taxTotalDocumented,true);
delete spec.paths['/common/inquiry/v1/totalTransaction'];
assert.throws(()=>inspectFinancialIncomeContract(spec));
console.log('PASS: official public contract shape only; no private account call');
