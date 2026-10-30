// Accept a compatible GAS 9.x patch without pinning a one-off diagnostic
// to an obsolete deployment. Unreviewed older/major versions fail closed.
export function supportedNhGasVersion(value){
 const match=/^9\.(\d{3})$/.exec(String(value||''));
 return !!match&&Number(match[1])>=281;
}
