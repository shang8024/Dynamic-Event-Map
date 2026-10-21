import {ApiError,clientError} from './apiErrors.js';

export async function mutateBookmark({eventId,save,add,remove,list}) {
  const action=save?'save':'remove';
  try {return {ok:true,eventId,action,bookmark:await (save?add(eventId):remove(eventId))};}
  catch(failure) {
    const error=clientError(failure,{method:save?'POST':'DELETE',dispatched:true});
    if(!save&&error.status===404) return {ok:true,eventId,action,alreadyAbsent:true};
    if(!error.ambiguous) return {ok:false,eventId,action,error,ambiguous:false};
    try {
      const {items}=await list();
      if(!Array.isArray(items)) throw new Error('Invalid saved-event snapshot');
      const present=items.some(item=>String(item.data?.id)===String(eventId));
      if(present===save) return {ok:true,eventId,action,items,reconciled:true};
      return {ok:false,eventId,action,items,ambiguous:false,error:new ApiError('Your saved list still shows the previous state. You can try again.',{code:'change_not_applied'})};
    } catch {
      return {ok:false,eventId,action,ambiguous:true,error:new ApiError('We could not confirm this change. Check your saved events before trying again.',
        {code:'bookmark_unconfirmed',ambiguous:true})};
    }
  }
}

// One request at a time, spaced below the ordinary 30 writes/minute budget.
// Other tabs may share that budget, so a 429 always stops the remaining work.
export async function removeBookmarkBatch(ids,{remove,onProgress=()=>{},wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),
  intervalMs=2200,shouldStop=()=>false}={}) {
  const unique=[...new Set(ids)],results=[];let retryAfter=null,stopped=false;
  function snapshot() {
    return {total:unique.length,completed:results.length,removed:results.filter(result=>result.ok).length,
      failed:results.filter(result=>!result.ok&&!result.ambiguous).map(result=>result.eventId),
      uncertain:results.filter(result=>result.ambiguous).map(result=>result.eventId),
      remaining:unique.slice(results.length),results:[...results],retryAfter,stopped};
  }
  onProgress(snapshot());
  for(const eventId of unique) {
    if(results.length) await wait(intervalMs);
    if(shouldStop()) {stopped=true;break;}
    let result;
    try {result=await remove(eventId);} catch(failure) {
      const error=clientError(failure,{method:'DELETE',dispatched:true});
      result={ok:false,eventId,error,ambiguous:error.ambiguous};
    }
    results.push(result);
    if(result.error?.status===429) {retryAfter=result.error.retryAfter??60;stopped=true;}
    if(result.ambiguous||[401,403].includes(result.error?.status)) stopped=true;
    onProgress(snapshot());
    if(stopped) break;
  }
  return snapshot();
}
