import {useState,useEffect,useRef,useCallback,useMemo} from 'react';
import {fetchBookmarks,addBookmark,removeBookmark,fetchTodaysBookmarks} from '../services/bookmarksService.js';
import {useAuth} from '../contexts/AuthContext.jsx';
import {useNotifications,isDismissedToday} from '../contexts/NotificationContext.jsx';
import {ApiError,clientError} from '../services/apiErrors.js';
import {mutateBookmark} from '../services/bookmarkOperations.js';

export function useBookmarks() {
  const {user}=useAuth(),uid=user?.uid,{push}=useNotifications();
  const [bookmarkedIds,setBookmarkedIds]=useState(()=>new Set()),[items,setItems]=useState([]);
  const [pendingIds,setPendingIds]=useState(()=>new Set()),[uncertainIds,setUncertainIds]=useState(()=>new Set());
  const [loading,setLoading]=useState(true),[error,setError]=useState('');
  const owner=useRef(uid),latestRead=useRef(null),mutationEpoch=useRef(0),pending=useRef(new Set());
  const applySnapshot=useCallback(rows=>{
    setItems(rows);setBookmarkedIds(new Set(rows.map(item=>item.data?.id).filter(id=>id!=null)));setUncertainIds(new Set());
  },[]);
  const refetchBookmarks=useCallback(async()=>{
    if(!uid) return {ok:false};
    const request=Symbol(),epoch=mutationEpoch.current;latestRead.current=request;setLoading(true);setError('');
    try {
      const result=await fetchBookmarks();
      if(owner.current!==uid||latestRead.current!==request) return {ok:false};
      if(epoch===mutationEpoch.current) applySnapshot(result.items||[]);
      return {ok:true,items:result.items||[]};
    } catch(failure) {
      const safe=clientError(failure);
      if(owner.current===uid&&latestRead.current===request) setError(safe.message);
      return {ok:false,error:safe};
    } finally {if(owner.current===uid&&latestRead.current===request) setLoading(false);}
  },[uid,applySnapshot]);
  useEffect(()=>{
    owner.current=uid;latestRead.current=null;mutationEpoch.current++;pending.current=new Set();
    setBookmarkedIds(new Set());setItems([]);setPendingIds(new Set());setUncertainIds(new Set());setError('');
    if(!uid) {setLoading(false);return;}
    void refetchBookmarks();
    let cancelled=false;
    const stickyKey=`todays-bookmarks:${uid}`;
    if(window.location.pathname!=='/bookmarks'&&!isDismissedToday(stickyKey)) {
      void fetchTodaysBookmarks().then(todays=>{
        if(cancelled||owner.current!==uid) return;
        if((todays[0]?.total??0)+(todays[1]?.total??0)>0) push({type:'info',
          message:`You have ${todays[0]?.total??0} bookmarked events starting and ${todays[1]?.total??0} ending today.`,
          stickyKey,action:{label:'View',href:'/bookmarks'}});
      }).catch(()=>{});
    }
    return()=>{cancelled=true;owner.current=null;latestRead.current=null;};
  },[uid,push,refetchBookmarks]);

  const toggle=useCallback(async(eventId,next,eventObj,{quiet=false}={})=>{
    const action=next===false?'remove':'save';
    if(!uid||owner.current!==uid) return {ok:false,eventId,action,error:new ApiError('Sign in to update your saved events.',{status:401,code:'sign_in_required'})};
    if(pending.current.has(eventId)||uncertainIds.has(eventId)) return {ok:false,eventId,action,ambiguous:uncertainIds.has(eventId),
      error:new ApiError('Check the current saved-event status before making another change.',{code:'bookmark_pending',ambiguous:uncertainIds.has(eventId)})};
    const prev=bookmarkedIds.has(eventId),save=typeof next==='boolean'?next:!prev;
    mutationEpoch.current++;pending.current.add(eventId);setPendingIds(new Set(pending.current));setError('');
    const setMarked=marked=>setBookmarkedIds(old=>{const ids=new Set(old);if(marked) ids.add(eventId);else ids.delete(eventId);return ids;});
    setMarked(save);
    try {
      const result=await mutateBookmark({eventId,save,add:addBookmark,remove:removeBookmark,list:fetchBookmarks});
      if(owner.current!==uid) return result;
      if(result.items) applySnapshot(result.items);
      if(result.ok) {
        setMarked(save);
        if(!save) setItems(old=>old.filter(item=>item.data?.id!==eventId));
        else if(eventObj) setItems(old=>old.some(item=>item.data?.id===eventId)?old:[{id:result.bookmark?.id,
          created_at:result.bookmark?.created_at||new Date().toISOString(),data:{...(eventObj._row||eventObj),id:eventId,
            latitude:eventObj.position?.lat??eventObj.latitude??null,longitude:eventObj.position?.lng??eventObj.longitude??null}},...old]);
        else if(!result.items) void refetchBookmarks();
        // Counts are optional display data. A failed stats read must never undo a confirmed write.
        if(!quiet) push({type:'success',message:save?'Event saved.':'Event removed from saved events.',autoCloseMs:2500});
      } else {
        if(!result.items) setMarked(prev);
        if(result.ambiguous) setUncertainIds(old=>new Set(old).add(eventId));
        setError(result.error.message);
        if(!quiet) push({type:result.ambiguous?'warning':'error',message:result.error.message,
          ...(result.ambiguous?{action:{label:'Check saved events',onClick:()=>{void refetchBookmarks();}}}:{})});
      }
      return result;
    } finally {
      if(owner.current===uid) {pending.current.delete(eventId);setPendingIds(new Set(pending.current));}
    }
  },[uid,uncertainIds,bookmarkedIds,applySnapshot,push,refetchBookmarks]);
  const listBookmarkedEvents=useCallback(()=>uid&&owner.current===uid?items.map(item=>{
    const row=item.data;return {id:row?.id,eventData:row?{id:row.id,title:row.title,description:row.description??null,
      position:typeof row.latitude==='number'&&typeof row.longitude==='number'?{lat:row.latitude,lng:row.longitude}:null,_row:row}:null,
      bookmarkInfo:{updatedAt:item.created_at||row?.updated_at||new Date().toISOString()}};
  }):[],[uid,items]);
  const isBookmarked=useCallback(id=>owner.current===uid&&bookmarkedIds.has(id),[uid,bookmarkedIds]);
  const isPending=useCallback(id=>owner.current===uid&&(pendingIds.has(id)||uncertainIds.has(id)),[uid,pendingIds,uncertainIds]);
  return useMemo(()=>({isBookmarked,isPending,toggle,listBookmarkedEvents,refetchBookmarks,loading,error}),
    [isBookmarked,isPending,toggle,listBookmarkedEvents,refetchBookmarks,loading,error]);
}
