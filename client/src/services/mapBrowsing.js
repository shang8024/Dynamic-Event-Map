// Public browsing state stays in this tab's memory, never in the account database.
const entries=new Map();
let latest=null;
function copy(view) {
  return view?{...view,center:{...view.center},clusterIds:[...view.clusterIds]}:null;
}
export function rememberMapBrowsing(key,view) {
  const snapshot=copy(view);
  entries.delete(key);entries.set(key,snapshot);latest=snapshot;
  while(entries.size>40) entries.delete(entries.keys().next().value);
}
export function readMapBrowsing(key,{fallback=true}={}) {
  return copy(entries.get(key)||(fallback?latest:null));
}
