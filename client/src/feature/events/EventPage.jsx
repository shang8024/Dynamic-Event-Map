import {lazy,Suspense,useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Link,useLocation,useNavigate,useParams} from 'react-router-dom';
import EventInfo from '../../components/EventInfo';
const EventForm=lazy(()=>import('../../components/EventForm'));
import Modal from '../../components/Modal';
import useGoogleMaps from '../../hooks/useGoogleMaps';
import {useNotifications} from '../../contexts/NotificationContext';
import {fetchEvent,deleteEvent} from '../../services/eventsService';
import {authIntent,eventPageId} from '../../services/authNavigation';
import socket,{onRealtimeWake} from '../../services/socket';
import {eventView} from '../../utils/event';

function EventEditor(props) {
  const {isLoaded,loadError}=useGoogleMaps();
  if(!isLoaded&&!loadError)return <p role="status">Loading venue search…</p>;
  return <>{loadError&&<p className="form-error mb-4">Venue search is unavailable. You can still enter the pin coordinates under Advanced pin position.</p>}<Suspense fallback={<p role="status">Loading event editor…</p>}><EventForm {...props}/></Suspense></>;
}

export default function EventPage() {
  const {eventId}=useParams(),id=eventPageId(`/events/${eventId}`);
  const location=useLocation(),navigate=useNavigate(),{push}=useNotifications();
  const [event,setEvent]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[missing,setMissing]=useState(false),[form,setForm]=useState(null);
  const [formDirty,setFormDirty]=useState(false),[formBusy,setFormBusy]=useState(false);
  const active=useRef(false),generation=useRef(0),focused=useRef('');
  const discardForm=useCallback(()=>{setForm(null);setFormDirty(false);setFormBusy(false);},[]);
  const pendingAction=useMemo(()=>authIntent(location.state?.authIntent,location.pathname+location.search),[location]);
  const handled=useCallback(()=>navigate(location.pathname+location.search+location.hash,{replace:true,state:null}),[navigate,location]);
  const refresh=useCallback(async()=>{
    if(!id) return;
    const request=++generation.current;
    try {
      const row=await fetchEvent(id);
      if(!active.current||request!==generation.current) return;
      setEvent(eventView(row));setMissing(false);setError('');
    } catch(failure) {
      if(!active.current||request!==generation.current) return;
      if(failure.status===404) {setEvent(null);setMissing(true);setError('');setForm(null);}
      else setError('This event could not be refreshed. Please try again.');
    } finally {if(active.current&&request===generation.current) setLoading(false);}
  },[id]);
  useEffect(()=>{
    active.current=true;setEvent(null);setLoading(Boolean(id));setMissing(!id);setError('');setForm(null);
    if(id) void refresh();
    const changed=row=>{if(String(row.id)===String(id)) void refresh();};
    // Archived events leave the map too; only a real 404 removes their detail page.
    const deleted=row=>{if(String(row.id)===String(id)) void refresh();};
    socket.on('event:updated',changed);socket.on('event:deleted',deleted);
    const stop=onRealtimeWake(refresh),timer=setInterval(()=>{if(document.visibilityState==='visible') void refresh();},60000);
    // This ref is a request counter, not a DOM node.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return()=>{active.current=false;generation.current++;stop();clearInterval(timer);socket.off('event:updated',changed);socket.off('event:deleted',deleted);};
  },[id,refresh]);
  useEffect(()=>{document.title=`${event?.title||(missing?'Event not found':'Event details')} · Dynamic Event Map`;},[event?.title,missing]);
  useEffect(()=>{
    const key=`${id}:${location.hash}:${missing}`;
    if(loading||focused.current===key) return;
    focused.current=key;
    if(pendingAction?.kind==='comment') return;
    const frame=requestAnimationFrame(()=>{
      const target=document.getElementById(location.hash==='#comments'?'comments-title':'event-detail-title')||document.getElementById('event-page-status');
      target?.focus({preventScroll:location.hash!=='#comments'});
    });
    return()=>cancelAnimationFrame(frame);
  },[id,loading,missing,location.hash,pendingAction?.kind]);
  function saved() {setForm(null);void refresh();}
  async function remove(eventId) {
    try {
      const result=await deleteEvent(eventId);
      if(result.event) saved();else {generation.current++;setEvent(null);setMissing(true);setForm(null);}
      return true;
    } catch(failure) {push({type:'error',message:failure.message||'Unable to update this event.'});return false;}
  }
  return <main className="event-page">
    <nav aria-label="Event navigation" className="event-page-nav"><Link className="btn btn-ghost" to={id?`/?event=${id}`:'/'}>← Back to map</Link><span className="text-sm muted">Event details</span></nav>
    {loading&&<p role="status" className="p-6">Loading event…</p>}
    {missing&&<section className="event-page-message"><h1 id="event-page-status" tabIndex={-1}>This event is no longer available</h1><p>It may have been removed. You can still explore other events on the map.</p><Link className="btn btn-primary" to="/">Explore events</Link></section>}
    {error&&<div role="alert" className="page-error"><p>{error}</p><button className="btn btn-outline" onClick={refresh}>Retry</button></div>}
    {event&&<EventInfo key={event.id} event={event} standalone onEdit={value=>{setFormDirty(false);setFormBusy(false);setForm(value);}} onDelete={remove} onSaved={saved} pendingAction={pendingAction} onActionHandled={handled}/>}
    {form&&<Modal dirty={formDirty} busy={formBusy} title="Edit event" onClose={discardForm} description="Dates and times use Toronto time.">{({requestClose})=>
      <EventEditor initialData={form} onDirtyChange={setFormDirty} onBusyChange={setFormBusy} onDiscard={discardForm} onCancel={requestClose} onSaved={saved}/>}
    </Modal>}
  </main>;
}
