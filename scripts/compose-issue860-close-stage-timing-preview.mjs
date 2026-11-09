// Issue #860: source-only observability, not a deployable GAS release.
// Append short stage/duration logs inside exact existing financial code paths;
// NEVER skip readbacks, modify write ordering, alter backup or lease admission.
import assert from 'node:assert/strict';

function editFunction(source,name,edit) {
 const from=source.indexOf('function '+name+'(');
 assert(from>=0,'ISSUE860_MISSING_FUNCTION:'+name);
 const to=source.indexOf('\n}',from);
 assert(to>from,'ISSUE860_BAD_FUNCTION_BOUNDARY:'+name);
 const before=source.slice(from,to+2);
 const after=edit(before);
 assert.notEqual(after,before,'ISSUE860_NO_INSTRUMENTATION:'+name);
 return source.slice(0,from)+after+source.slice(to+2);
}
function once(source,anchor,replacement,label) {
 assert.equal(source.split(anchor).length,2,'ISSUE860_ANCHOR_DRIFT:'+label);
 return source.replace(anchor,replacement);
}
const startClose=String.raw