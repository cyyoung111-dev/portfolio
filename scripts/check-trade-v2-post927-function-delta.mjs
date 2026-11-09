// Source-only scan of function-level trade-v2 vs protected v9.287.
import {composeFundSnapshot9287SourcePreview} from './compose-fund-snapshot-9287-source-preview.mjs';
import {composeGas9286IntegratedPreview} from './compose-gas9286-integrated-preview.mjs';
const build=source=>{
 const result=new Map();
 const matches=[...source.matchAll(/^function ([A-Za-z_$][\w$]*)\s*\(/gm)];
 for(const m of matches){
  const tail=source.indexOf('\n}',m.index);
  if(tail<0)throw Error('FUNCTION_UNTERMINATED:'+m[1]);
  if(result.has(m[1]))throw Error('DUPLICATE_FUNCTION:'+m[1]);
  result.set(m[1],source.slice(m.index,tail+2));
 }
 return result;
};
const live=build(composeFundSnapshot9287SourcePreview().candidate);
const proposed=build(composeGas9286IntegratedPreview().candidate);
const changed=[...proposed].filter(([name,fn])=>live.has(name)&&live.get(name)!==fn).map(([name])=>name);
const added=[...proposed.keys()].filter(name=>!live.has(name));
const removed=[...live.keys()].filter(name=>!proposed.has(name));
console.log('TRADE_V2_9287_FUNCTION_DELTA '+JSON.stringify({liveCount:live.size,tradeCount:proposed.size,changed,added,removed}));
