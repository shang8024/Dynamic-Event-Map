import {useEffect,useState} from 'react';
import {Link,useNavigate,useParams} from 'react-router-dom';
import EventForm from '../../components/EventForm';
import {fetchEvent} from '../../services/eventsService';
import {post} from '../../services/apiService';
import useGoogleMaps from '../../hooks/useGoogleMaps';
import {useNotifications} from '../../contexts/NotificationContext';
import {isEnded} from '../../utils/event';

export default function EventComposePage() {
  const {eventId}=useParams(),suggesting=Boolean(eventId),navigate=useNavigate(),{push}=useNotifications();
  const {isLoaded,loadError}=useGoogleMaps();
  const [state,setState]=useState({event:null,loading:suggesting,error:''}),[retry,setRetry]=useState(0);
  const returnTo=suggesting?`/events/${eventId}`:'/';
  useEffect(()=>{document.title=`${suggesting?'Suggest an update':'Create event'} · Dynamic Event Map`;},[suggesting]);
  useEffect(()=>{
    if(!eventId) return;
    let active=true;
    fetchEvent(eventId).then(event=>{if(active) setState({event,loading:false,error:''});})
      .catch(error=>{if(active) setState({event:null,loading:false,error:error.message});});
    return()=>{active=false;};
  },[eventId,retry]);
  function saved(result) {
    const pending=result.publication_status==='pending';
    push({type:'success',title:suggesting?'Suggestion submitted':pending?'Event submitted for review':'Event published',
      message:suggesting?'Your changes are waiting for administrator review. The result will appear in your inbox.':pending?'Your first event needs approval. Track it in My events; the decision will appear in your inbox.':'Your event is now available on the map.'});
    navigate(suggesting?`/contributions?request=${result.id}`:pending?`/event-submissions/${result.submission_id}`:`/events/${result.id}`);
  }
  const eligible=!suggesting||state.event?.submission_role==='reporter'&&!isEnded(state.event)&&state.event.status!=='cancelled';
  return <main className="event-compose-page">
    <Link className="link compose-back" to={returnTo}>← {suggesting?'Back to event':'Back to map'}</Link>
    <header className="compose-heading"><p className="eyebrow">{suggesting?'Community contribution':'Share an event'}</p>
      <h1>{suggesting?'Suggest an update':'Create event'}</h1><p className="form-help">{suggesting?'Add a correction or missing detail. Changes are published only after review.':'Start with the details, confirm the location and add a photo. Your first event requires approval; track its status in My events.'}</p></header>
    {state.loading&&<p role="status">Loading event…</p>}
    {state.error&&<div role="alert" className="page-error"><p>{state.error}</p><button className="btn btn-outline" onClick={()=>setRetry(old=>old+1)}>Retry</button></div>}
    {suggesting&&!state.loading&&!state.error&&!eligible&&<p className="content-card">This listing is not accepting community suggestions. You can use Report abuse to request a correction or management access.</p>}
    {loadError&&<p role="status" className="content-card">Address search and the map preview are unavailable. You can still enter the address and exact coordinates manually.</p>}
    {(!suggesting||!state.loading&&!state.error)&&eligible&&<div className="compose-card"><EventForm key={eventId||'new'} initialData={suggesting?state.event:{}} wizard={!suggesting} mapsReady={isLoaded}
      onSubmitChanges={suggesting?payload=>post(`/events/${eventId}/suggestions`,payload):undefined} onSaved={saved} onCancel={()=>navigate(returnTo)}/></div>}
  </main>;
}
