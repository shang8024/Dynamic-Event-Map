import {useCallback,useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {useAuth} from '../contexts/AuthContext';
import {get,post} from '../services/apiService';
import socket,{onRealtimeWake} from '../services/socket';
export function useInbox() {
  const {user}=useAuth();const [data,setData]=useState({items:[],unread:0,next:null}),[error,setError]=useState('');
  const generation=useRef(0);
  const refresh=useCallback(async()=>{
    if(!user) return;
    const request=++generation.current;
    try {const result=await get('/notifications');if(request===generation.current) {setData(result);setError('');}}
    catch {if(request===generation.current) setError('Notifications are temporarily unavailable.');}
  },[user?.uid]);
  useEffect(()=>{
    generation.current++;setData({items:[],unread:0,next:null});setError('');
    if(!user) return;
    const changed=()=>{void refresh();};socket.on('notification:changed',changed);const stop=onRealtimeWake(changed);
    const timer=setInterval(()=>{if(document.visibilityState==='visible') changed();},30000);changed();
    return()=>{generation.current++;socket.off('notification:changed',changed);stop();clearInterval(timer);};
  },[user?.uid,refresh]);
  async function mark(id) {try {await post('/notifications/read',id?{id}:{});await refresh();} catch {setError('Unable to update notifications. Please try again.');}}
  async function more() {
    if(!data.next) return;
    const request=generation.current;
    try {const result=await get(`/notifications?before=${data.next}`);if(request===generation.current) setData(old=>({...result,items:[...old.items,...result.items.filter(item=>!old.items.some(existing=>existing.id===item.id))]}));}
    catch {setError('Unable to load more notifications.');}
  }
  return {data,error,refresh,mark,more};
}
export function NotificationBell() {
  const {data}=useInbox();
  return <Link to="/notifications" className="btn btn-ghost btn-sm" aria-label={`Notifications, ${data.unread} unread`}>
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6"/></svg>
    {data.unread>0 && <span className="badge badge-primary badge-sm">{data.unread>99?'99+':data.unread}</span>}
  </Link>;
}
export default function NotificationInbox() {
  const {data,error,mark,more}=useInbox();
  return <main className="mx-auto w-full max-w-3xl py-6">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><h1 className="text-2xl font-semibold">Notifications</h1>
      <button className="btn btn-ghost" disabled={!data.unread} onClick={()=>mark()}>Mark all read</button></div>
    <p className="mb-5 text-base-content/75">Updates and new comments on your saved events.</p>
    {error && <p role="alert" className="mb-4 text-error">{error}</p>}
    <ul className="space-y-3">{data.items.map(item=><li key={item.id} className={`rounded-xl border border-base-300 p-4 ${item.read_at?'bg-base-100':'bg-base-200'}`}>
      <div className="flex items-start justify-between gap-3"><h2 className="font-semibold">{item.title}</h2>
        {!item.read_at && <button className="btn btn-ghost btn-sm" onClick={()=>mark(item.id)}>Mark read</button>}</div>
      <p className="my-2">{item.message}</p>
      <div className="flex flex-wrap items-center justify-between gap-3"><time className="text-sm text-base-content/75" dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>
        {item.event_id && <Link className="link font-medium" to={`/?event=${item.event_id}`} onClick={()=>{void mark(item.id);}}>View event</Link>}</div>
    </li>)}</ul>
    {!data.items.length && !error && <p role="status" className="rounded-xl bg-base-200 p-6">You are all caught up. Save events to receive updates here.</p>}
    {data.next && <button className="btn mt-4" onClick={more}>Load more</button>}
  </main>;
}
