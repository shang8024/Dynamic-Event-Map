import {useEffect,useLayoutEffect,useMemo,useRef,useSyncExternalStore} from 'react';
import {Link} from 'react-router-dom';
import {useAuth} from '../contexts/AuthContext';
import {get,post} from '../services/apiService';
import {createNotificationInbox} from '../services/notificationInbox';
import socket,{onRealtimeWake} from '../services/socket';
import PageLayout from './PageLayout';

function useInbox({summary=false,listRef}={}) {
  const {user}=useAuth(),uid=user?.uid,anchor=useRef(null);
  const inbox=useMemo(()=>createNotificationInbox({get,post,summary,enabled:Boolean(uid),
    onRead:()=>window.dispatchEvent(new Event('eventmap:inbox-read'))}),[uid,summary]);
  const subscribe=useMemo(()=>listener=>inbox.subscribe(()=>{
    const list=listRef?.current,scroller=list?.closest('.app-content');
    if(list&&scroller) {
      const edge=scroller.getBoundingClientRect().top;
      const item=[...list.children].find(node=>node.getBoundingClientRect().bottom>edge);
      if(item) anchor.current={id:item.dataset.notificationId,top:item.getBoundingClientRect().top,scroller};
    }
    listener();
  }),[inbox,listRef]);
  const state=useSyncExternalStore(subscribe,inbox.getSnapshot,inbox.getSnapshot);
  useLayoutEffect(()=>{
    const saved=anchor.current;anchor.current=null;
    if(!saved) return;
    const item=[...(listRef?.current?.children||[])].find(node=>node.dataset.notificationId===saved.id);
    if(item) saved.scroller.scrollTop+=item.getBoundingClientRect().top-saved.top;
  },[state,listRef]);
  useEffect(()=>{
    inbox.start();
    const changed=()=>{void inbox.invalidate();};
    socket.on('notification:changed',changed);const stop=onRealtimeWake(changed);
    window.addEventListener('eventmap:inbox-read',changed);
    const timer=setInterval(()=>{if(document.visibilityState==='visible') changed();},30000);
    return()=>{inbox.stop();socket.off('notification:changed',changed);window.removeEventListener('eventmap:inbox-read',changed);stop();clearInterval(timer);};
  },[inbox]);
  return {...state,refresh:inbox.refresh,mark:inbox.mark,more:inbox.more};
}
export function NotificationBell() {
  const {data,loading}=useInbox({summary:true});
  return <Link to="/notifications" className="btn btn-ghost notification-bell" aria-label={loading?'Notifications':`Notifications, ${data.unread} unread`}>
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6"/></svg>
    {data.unread>0 && <span className="notification-count">{data.unread>99?'99+':data.unread}</span>}
  </Link>;
}
export default function NotificationInbox() {
  const listRef=useRef(null);
  const {data,error,moreError,markError,marking,mark,more,refresh,loading,loadingMore,refreshing}=useInbox({listRef});
  return <PageLayout title="Notifications" narrow intro="Updates and new conversations on your saved events." actions={<button className="btn btn-outline" disabled={!data.unread||marking.length>0} onClick={()=>mark()}>{marking.includes('all')?'Marking all read…':'Mark all read'}</button>}>
    {error&&<div role="alert" className="page-error"><p>{error}</p><button className="btn btn-outline" disabled={refreshing} onClick={refresh}>{refreshing?'Retrying…':'Retry refresh'}</button></div>}
    {markError&&<div role="alert" className="page-error"><p>{markError.message}</p><button className="btn btn-outline" disabled={marking.length>0} onClick={()=>mark(markError.id)}>Retry marking read</button></div>}
    {loading&&<p role="status" className="content-card">Loading notifications…</p>}
    <ul ref={listRef} className="notification-list">{data.items.map(item=><li key={item.id} data-notification-id={item.id} className={`content-card ${item.read_at?'':'notification-unread'}`}>
      <div className="flex items-start justify-between gap-3"><h2 className="font-semibold">{item.title}</h2>
        {!item.read_at && <button className="btn btn-ghost btn-sm" disabled={marking.includes('all')||marking.includes(String(item.id))} onClick={()=>mark(item.id)}>{marking.includes(String(item.id))?'Marking…':'Mark read'}</button>}</div>
      {!item.read_at&&<span className="notification-new">New</span>}<p className="notification-message">{item.message}</p>
      <div className="flex flex-wrap items-center justify-between gap-3"><time className="text-xs muted" dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>
        {item.event_id && <Link className="link font-medium" to={`/events/${item.event_id}`} onClick={()=>{void mark(item.id);}}>View event</Link>}</div>
    </li>)}</ul>
    {!loading&&!data.items.length&&!error&&<div className="empty-state"><p>You’re all caught up.</p><p className="text-sm muted mt-2">Save an event to receive updates here.</p><Link className="btn btn-outline mt-4" to="/">Explore events</Link></div>}
    {moreError&&<p role="alert" className="text-error mt-4">{moreError}</p>}
    {data.next && <button className="btn mt-4" disabled={loadingMore} onClick={more}>{loadingMore?'Loading more…':moreError?'Retry loading more':'Load more'}</button>}
  </PageLayout>;
}
