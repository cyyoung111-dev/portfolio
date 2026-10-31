// Financial unit fixtures intentionally isolate admission from business logic.
// Only the deterministic generated admission line is removed; production body,
// settings and all writer/math code remain identical. Full live admission is
// independently tested by check-issue507-live-release.mjs without this helper.
export function isolateGasBusinessLogic(source){
 return source.replace(/^  if \(typeof _issue507GateInside_ !== 'undefined' && !_issue507GateInside_\) return _issue507GateInvoke_\('[\w]+', [\w]+, this, arguments\);\n?/gm,'');
}
