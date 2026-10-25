const destinations=new Set(['/','/bookmarks','/recommendations','/comments','/notifications','/settings','/events/new','/contributions','/my-events']);
export function eventPageId(pathname) {
  const match=/^\/events\/([1-9]\d{0,9})$/.exec(pathname);
  return match&&Number(match[1])<=2147483647?Number(match[1]):null;
}
export function safeReturnTo(value='/') {
  if(typeof value!=='string'||value.length>2048||!value.startsWith('/')||value.startsWith('//')||Array.from(value).some(char=>char==='\\'||char.charCodeAt(0)<32||char.charCodeAt(0)===127)) return '/';
  try {
    const target=new URL(value,'https://eventmap.invalid');
    const suggestion=/^\/events\/([1-9]\d{0,9})\/suggest$/.exec(target.pathname);
    const submission=/^\/event-submissions\/[1-9]\d{0,17}$/.test(target.pathname);
    if(target.origin!=='https://eventmap.invalid'||!destinations.has(target.pathname)&&!eventPageId(target.pathname)&&!(suggestion&&Number(suggestion[1])<=2147483647)&&!submission) return '/';
    target.searchParams.delete('action');
    return target.pathname+target.search+target.hash;
  } catch {return '/';}
}
export function authPath(mode='signin',reason='',returnTo='/') {
  const route=['signin','register','reset-password'].includes(mode)?mode:'signin';
  const params=new URLSearchParams({returnTo:safeReturnTo(returnTo)});
  if(reason) params.set('reason',String(reason).slice(0,200));
  return `/${route}?${params}`;
}
export function returnWithoutAction(value) {
  const target=new URL(safeReturnTo(value),'https://eventmap.invalid');
  target.searchParams.delete('action');target.searchParams.delete('create');
  return target.pathname+target.search+target.hash;
}
export function authIntent(value,returnTo='/') {
  if(!value||typeof value!=='object') return null;
  const target=new URL(safeReturnTo(returnTo),'https://eventmap.invalid');
  if(value.kind==='create'&&target.pathname==='/') return {kind:'create'};
  const id=Number(value.eventId);
  if(['save','comment'].includes(value.kind)&&Number.isSafeInteger(id)&&id!==0&&Math.abs(id)<=2147483647
    &&(target.pathname==='/'&&target.searchParams.get('event')===String(id)||eventPageId(target.pathname)===id)) return {kind:value.kind,eventId:id};
  return null;
}
