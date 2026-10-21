import {useCallback,useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {useAuth} from '../contexts/AuthContext';
import {get,post} from '../services/apiService';
import socket,{onRealtimeWake} from '../services/socket';
import PageLayout from './PageLayout';
function useInbox() {
  const {user}=useAuth();const uid=user?.uid;const [data,setData]=useState({items:[],unread:0,next:null}),[error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const generation=useRef(0);
  const refresh=useCallback(async()=>{
    if(!uid) return;
    const request=++generation.current;
    try {const result=await get('/notifications');if(request===generation.current) {setData(result);setError('');}}
    catch {if(request===generation.current) setError('Notifications are temporarily unavailable.');}
    finally {if(request===generation.current) setLoading(false);}
  },[uid]);
  useEffect(()=>{
    generation.current++;setData({items:[],unread:0,next:null});setError('');
    if(!uid) {setLoading(false);return;}
    setLoading(true);
    const changed=()=>{void refresh();};socket.on('notification:changed',changed);const stop=onRealtimeWake(changed);
    window.addEventListener('eventmap:inbox-read',changed);
    const timer=setInterval(()=>{if(document.visibilityState==='visible') changed();},30000);changed();
    // This is a request-generation counter, not a DOM ref; invalidate pending reads on logout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return()=>{generation.current++;socket.off('notification:changed',changed);window.removeEventListener('eventmap:inbox-read',changed);stop();clearInterval(timer);};
  },[uid,refresh]);
  async function mark(id) {try {await post('/notifications/read',id?{id}:{});window.dispatchEvent(new Event('eventmap:inbox-read'));await refresh();} catch {setError('Unable to update notifications. Please try again.');}}
  async function more() {
    if(!data.next) return;
    const request=generation.current;
    try {const result=await get(`/notifications?before=${data.next}`);if(request===generation.current) setData(old=>({...result,items:[...old.items,...result.items.filter(item=>!old.items.some(existing=>existing.id===item.id))]}));}
    catch {setError('Unable to load more notifications.');}
  }
  return {data,error,refresh,mark,more,loading};
}
export function NotificationBell() {
  const {data,loading}=useInbox();
  return <Link to="/notifications" className="btn btn-ghost notification-bell" aria-label={loading?'Notifications':`Notifications, ${data.unread} unread`}>
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6"/></svg>
    {data.unread>0 && <span className="notification-count">{data.unread>99?'99+':data.unread}</span>}
  </Link>;
}
export default function NotificationInbox() {
  const {data,error,mark,more,refresh,loading}=useInbox();
  return <PageLayout title="Notifications" narrow intro="Updates and new conversations on your saved events." actions={<button className="btn btn-outline" disabled={!data.unread} onClick={()=>mark()}>Mark all read</button>}>
    {error&&<div role="alert" className="page-error"><p>{error}</p><button className="btn btn-outline" onClick={refresh}>Retry</button></div>}
    {loading&&<p role="status" className="content-card">Loading notifications…</p>}
    <ul className="notification-list">{data.items.map(item=><li key={item.id} className={`content-card ${item.read_at?'':'notification-unread'}`}>
      <div className="flex items-start justify-between gap-3"><h2 className="font-semibold">{item.title}</h2>
        {!item.read_at && <button className="btn btn-ghost btn-sm" onClick={()=>mark(item.id)}>Mark read</button>}</div>
      {!item.read_at&&<span className="notification-new">New</span>}<p className="notification-message">{item.message}</p>
      <div className="flex flex-wrap items-center justify-between gap-3"><time className="text-xs muted" dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>
        {item.event_id && <Link className="link font-medium" to={`/?event=${item.event_id}`} onClick={()=>{void mark(item.id);}}>View event</Link>}</div>
    </li>)}</ul>
    {!loading&&!data.items.length&&!error&&<div className="empty-state"><p>You’re all caught up.</p><p className="text-sm muted mt-2">Save an event to receive updates here.</p><Link className="btn btn-outline mt-4" to="/">Explore events</Link></div>}
    {data.next && <button className="btn mt-4" onClick={more}>Load more</button>}
  </PageLayout>;
}
