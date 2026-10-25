import {useEffect,useState} from 'react';
import {Link,useParams} from 'react-router-dom';
import {useAuth} from '../contexts/AuthContext';
import {useNotifications} from '../contexts/NotificationContext';
import {get,post} from '../services/apiService';
import PageLayout from './PageLayout';
import PublicationArtwork from './PublicationArtwork';
import PublicationFeedback from './PublicationFeedback';
import {scheduleSummary,occurrenceTime} from '../utils/event';
import './Publications.css';

export default function EventSubmissionPage() {
  const {submissionId}=useParams(),{user}=useAuth(),{push}=useNotifications();
  const [state,setState]=useState({item:null,error:'',loading:true}),[retry,setRetry]=useState(0),[note,setNote]=useState(''),[busy,setBusy]=useState(''),[error,setError]=useState('');
  useEffect(()=>{
    const controller=new AbortController();
    get(`/event-publications/${submissionId}`,{signal:controller.signal})
      .then(item=>{if(!controller.signal.aborted)setState({item,error:'',loading:false});})
      .catch(failure=>{if(!controller.signal.aborted)setState({item:null,error:failure.message,loading:false});});
    return()=>controller.abort();
  },[submissionId,retry]);
  const item=state.item,draft=item?.draft,when=draft?scheduleSummary(draft):null,reviewing=user.role==='admin'&&item?.status==='pending';
  useEffect(()=>{document.title=`${draft?.title||'Event submission'} · Dynamic Event Map`;},[draft?.title]);
  async function review(decision) {
    if(busy) return;
    if(decision==='reject'&&!note.trim()) {setError('Include a reason so the author knows what to correct.');return;}
    setBusy(decision);setError('');
    try {
      const updated=await post(`/event-publications/${item.id}/review`,{decision,note});
      setState({item:updated,error:'',loading:false});
      push({type:'success',message:decision==='approve'?'The event was published. Its author has been notified.':'The submission was rejected. Its author has received your reason.'});
    } catch(failure) {setError(failure.message);} finally {setBusy('');}
  }
  return <PageLayout title={draft?.title||'Event submission'} eyebrow={reviewing?'Publishing review':'Your submission'} intro="Submission details are private to the author and administrators."
    actions={<Link className="btn btn-ghost" to={user.role==='admin'&&String(item?.user_id)!==String(user.id)?'/my-events?review=true':'/my-events'}>← Back to events</Link>}>
    {state.loading&&<p role="status">Loading submission…</p>}
    {state.error&&<div role="alert" className="page-error"><p>{state.error}</p><button className="btn btn-outline" onClick={()=>setRetry(old=>old+1)}>Retry</button></div>}
    {item&&<article className="publication-preview">
      <PublicationArtwork item={item} large/>
      <div className="publication-preview-body"><p className="eyebrow">{draft.category}</p>
        <dl className="publication-facts"><div><dt>{when.label} · Toronto time</dt><dd>{when.text}</dd></div>
          <div><dt>Location</dt><dd>{draft.location_address}</dd></div>{draft.organizer_name&&<div><dt>Organizer</dt><dd>{draft.organizer_name}</dd></div>}</dl>
        <section><h2>About this event</h2><p className="event-description">{draft.description}</p></section>
        {draft.occurrences?.length>1&&<details className="schedule-details"><summary>All dates · {draft.occurrences.length} occurrences</summary><ul className="occurrence-list">{draft.occurrences.map(item=><li key={item.key}>{occurrenceTime(item)}</li>)}</ul></details>}
        {item.status==='pending'&&!reviewing&&<p className="content-card">Your event is under review. We’ll send the decision to your inbox; it is not visible on the map yet.</p>}
        {item.status==='approved'&&<section className="publication-feedback"><h2>Published</h2><p>Your event passed review.</p>{item.event_id?<Link className="btn btn-primary self-start" to={`/events/${item.event_id}`}>View published event</Link>:<p className="muted">The published listing is no longer available.</p>}</section>}
        {item.status==='rejected'&&<PublicationFeedback note={item.review_note}/>}
        {reviewing&&<section className="publication-feedback"><h2>Review this event</h2><p className="muted">Confirm the event details and source. Rejection requires a reason, visible to the author.</p>
          <label className="form-field"><span>Review note / rejection reason</span><textarea className="textarea textarea-bordered w-full" rows={4} maxLength={2000} value={note} disabled={!!busy} onChange={event=>setNote(event.target.value)}/></label>
          {error&&<p role="alert" className="form-error">{error}</p>}
          <div className="publication-review-actions"><button className="btn btn-primary" disabled={!!busy||String(item.user_id)===String(user.id)} onClick={()=>review('approve')}>{busy==='approve'?'Publishing…':'Approve & publish'}</button>
            <button className="btn btn-outline" disabled={!!busy||String(item.user_id)===String(user.id)} onClick={()=>review('reject')}>{busy==='reject'?'Rejecting…':'Reject with reason'}</button></div>
          {String(item.user_id)===String(user.id)&&<p className="form-help">Another administrator must review your own submission.</p>}
        </section>}
      </div>
    </article>}
  </PageLayout>;
}
