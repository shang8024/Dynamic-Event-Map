import {useCallback,useEffect,useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {useAuth} from '../contexts/AuthContext';
import {get} from '../services/apiService';
import PageLayout from './PageLayout';
import EventArtwork from './EventArtwork';
import PublicationArtwork from './PublicationArtwork';
import PublicationStatus from './PublicationStatus';
import {eventImage,scheduleSummary} from '../utils/event';
import socket from '../services/socket';
import './Publications.css';

function SubmissionCard({item}) {
  const when=scheduleSummary(item.draft);
  return <article className="publication-card">
    <Link to={`/event-submissions/${item.id}`} className="publication-photo-link" aria-label={`View ${item.draft.title}`}><PublicationArtwork item={item}/></Link>
    <div className="publication-card-body"><p className="eyebrow">{item.draft.category||'Event'}</p>
      <h3><Link to={`/event-submissions/${item.id}`}>{item.draft.title}</Link></h3><p className="muted text-sm">{when.text}</p>
      <p className="text-sm muted">{item.status==='pending'?'Visible only to its author and administrators.':item.status==='rejected'?'Open your submission to read the reason.':'Your event has been reviewed.'}</p>
      <Link className="link" to={`/event-submissions/${item.id}`}>{item.status==='rejected'?'View rejection reason':'View submission'} →</Link>
    </div>
  </article>;
}
function PublishedCard({event}) {
  return <article className="publication-card"><Link to={`/events/${event.id}`} className="publication-photo-link" aria-label={`View ${event.title}`}>
    <div className="publication-artwork"><EventArtwork src={eventImage(event,'thumb')?.url} title={event.title} category={event.category} className="h-full w-full"/><PublicationStatus/></div>
    </Link><div className="publication-card-body"><p className="eyebrow">{event.category}</p><h3><Link to={`/events/${event.id}`}>{event.title}</Link></h3>
      <p className="text-sm muted">{scheduleSummary(event).text}</p><p className="text-sm muted">{event.archived_at?'Ended · retained in your history':event.status==='cancelled'?'Cancelled':'Visible on the map while upcoming'}</p>
      <Link className="link" to={`/events/${event.id}`}>Manage event →</Link></div></article>;
}
function Dashboard() {
  const [state,setState]=useState({submissions:null,published:null,loading:true,error:''}),[revision,setRevision]=useState(0),[busy,setBusy]=useState('');
  const refresh=useCallback(()=>setRevision(old=>old+1),[]);
  useEffect(()=>{
    const controller=new AbortController();
    Promise.all([get('/event-publications',{signal:controller.signal}),get('/my-events',{signal:controller.signal})])
      .then(([submissions,published])=>{if(!controller.signal.aborted)setState({submissions,published,loading:false,error:''});})
      .catch(error=>{if(!controller.signal.aborted)setState(old=>({...old,loading:false,error:error.message}));});
    return()=>controller.abort();
  },[revision]);
  useEffect(()=>{socket.on('notification:changed',refresh);return()=>socket.off('notification:changed',refresh);},[refresh]);
  async function more(section) {
    if(busy) return;
    setBusy(section);
    try {
      const result=await get(`${section==='published'?'/my-events':'/event-publications'}?before=${state[section].next}`);
      setState(old=>({...old,[section]:{...result,items:[...old[section].items,...result.items.filter(row=>!old[section].items.some(item=>String(item.id)===String(row.id)))]},error:''}));
    } catch(error) {setState(old=>({...old,error:error.message}));} finally {setBusy('');}
  }
  const submissions=state.submissions?.items.filter(item=>item.status!=='approved'||!item.event_id)||[],published=state.published?.items||[];
  return <PageLayout title="My events" intro="Track your submissions and manage published events. Your first event is reviewed before it appears on the map."
    actions={<><button className="btn btn-ghost" onClick={refresh} disabled={!!busy}>Refresh</button><Link className="btn btn-primary" to="/events/new">Create event</Link></>}>
    {state.loading&&<p role="status">Loading your events…</p>}
    {state.error&&<div role="alert" className="page-error"><p>{state.error}</p><button className="btn btn-outline" onClick={refresh}>Retry</button></div>}
    {!!submissions.length&&<section className="publication-section"><div className="publication-section-heading"><h2>Submitted for review</h2><p className="muted">Private until approved</p></div>
      <div className="publication-grid">{submissions.map(item=><SubmissionCard key={item.id} item={item}/>)}</div></section>}
    {state.submissions?.next&&<button className="btn btn-outline self-start" disabled={!!busy} onClick={()=>more('submissions')}>{busy==='submissions'?'Loading…':'More submissions'}</button>}
    <section className="publication-section"><div className="publication-section-heading"><h2>Published events</h2><p className="muted">Your public listings</p></div>
      {published.length?<div className="publication-grid">{published.map(event=><PublishedCard key={event.id} event={event}/>)}</div>:!state.loading&&<div className="empty-state"><p>No published events yet.</p><p className="text-sm muted">Approved submissions will appear here.</p></div>}</section>
    {state.published?.next&&<button className="btn btn-outline self-start" disabled={!!busy} onClick={()=>more('published')}>{busy==='published'?'Loading…':'More published events'}</button>}
    {!state.loading&&!submissions.length&&!published.length&&!state.error&&<Link className="link self-start" to="/events/new">Share your first event →</Link>}
  </PageLayout>;
}
function ReviewQueue() {
  const [state,setState]=useState({items:[],next:null,loading:true,error:''}),[retry,setRetry]=useState(0),[busy,setBusy]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    get('/event-publications?review=true',{signal:controller.signal}).then(result=>{if(!controller.signal.aborted)setState({...result,loading:false,error:''});})
      .catch(error=>{if(!controller.signal.aborted)setState({items:[],loading:false,error:error.message});});
    return()=>controller.abort();
  },[retry]);
  async function more() {
    setBusy(true);
    try {const result=await get(`/event-publications?review=true&before=${state.next}`);setState(old=>({...result,loading:false,error:'',items:[...old.items,...result.items]}));}
    catch(error) {setState(old=>({...old,error:error.message}));} finally {setBusy(false);}
  }
  return <PageLayout title="First-event reviews" eyebrow="Publishing review" intro="Review the full submission before publishing. Authors receive the decision and your reason in their inbox."
    actions={<Link className="btn btn-ghost" to="/contributions?review=true">Community updates</Link>}>
    {state.loading&&<p role="status">Loading submissions…</p>}{state.error&&<div role="alert" className="page-error"><p>{state.error}</p><button className="btn btn-outline" onClick={()=>setRetry(old=>old+1)}>Retry</button></div>}
    {!state.loading&&!state.items.length&&!state.error&&<div className="empty-state">No first events are waiting for review.</div>}
    <div className="publication-grid">{state.items.map(item=><SubmissionCard key={item.id} item={item}/>)}</div>
    {state.next&&<button className="btn btn-outline self-start" disabled={busy} onClick={more}>{busy?'Loading…':'More submissions'}</button>}
  </PageLayout>;
}
export default function MyEventsPage() {
  const {user}=useAuth(),[params]=useSearchParams();
  return user.role==='admin'&&params.get('review')==='true'?<ReviewQueue/>:<Dashboard/>;
}
