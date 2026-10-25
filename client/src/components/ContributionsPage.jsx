import {useCallback,useEffect,useRef,useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {useAuth} from '../contexts/AuthContext';
import {useNotifications} from '../contexts/NotificationContext';
import {get,post} from '../services/apiService';
import {occurrenceTime} from '../utils/event';
import PageLayout from './PageLayout';

const LABELS={title:'Event title',description:'Description',category:'Category',location_address:'Address',latitude:'Latitude',longitude:'Longitude',
  organizer_name:'Organizer',occurrences:'Dates and times',place_id:'Venue reference'};
function valueText(key,value) {
  if(key==='occurrences'&&Array.isArray(value)) return value.map(occurrenceTime).join('\n');
  if(key==='place_id') return value?'Selected from address search':'Manually placed location';
  return value==null||value===''?'—':String(value);
}
function Contribution({item,onReviewed,selected=false}) {
  const {user}=useAuth(),{push}=useNotifications(),[note,setNote]=useState(''),[busy,setBusy]=useState(''),[error,setError]=useState('');
  const reviewing=user.role==='admin'&&item.status==='pending',stale=item.event_id==null||item.event_archived_at||String(item.event_version)!==String(item.base_version);
  async function decide(decision) {
    if(busy) return;
    if(decision==='reject'&&!note.trim()) {setError('Include a reason so the contributor knows what to improve.');return;}
    setBusy(decision);setError('');
    try {await post(`/event-suggestions/${item.id}/review`,{decision,note});push({type:'success',message:`Suggestion ${decision==='approve'?'approved':'rejected'}. The contributor has been notified.`});onReviewed();}
    catch(failure) {setError(failure.message);}
    finally {setBusy('');}
  }
  return <article className="content-card contribution-card" id={`submission-${item.id}`}>
    <header><div><span className={`contribution-status status-${item.status}`}>{item.status==='pending'?'Awaiting review':item.status==='approved'?'Approved':'Not approved'}</span>
      <h2>{item.event_title}</h2></div>{item.event_id&&<Link className="link" to={`/events/${item.event_id}`}>View event ↗</Link>}</header>
    <p className="text-sm muted">Submitted by {item.submitter_name} · {new Date(item.created_at).toLocaleString()}</p>
    <p className="contribution-explanation">{item.explanation}</p>
    <details open={selected||reviewing||undefined}><summary>Proposed changes · {Object.keys(item.changes).length} {Object.keys(item.changes).length===1?'field':'fields'}</summary>
      <dl className="review-diff">{Object.entries(item.changes).map(([key,value])=><div key={key}><dt>{LABELS[key]||'Event detail'}</dt>
        <dd><div><span>Before submission</span><p>{valueText(key,item.original_values[key])}</p></div><div><span>Suggested</span><p>{valueText(key,value)}</p></div></dd></div>)}</dl>
    </details>
    {item.reviewed_at&&<div className="contribution-result"><strong>{item.status==='approved'?'Your update was published.':'Your update was not published.'}</strong>
      {item.review_note&&<p>{item.review_note}</p>}<time className="text-xs muted" dateTime={item.reviewed_at}>{new Date(item.reviewed_at).toLocaleString()}</time></div>}
    {reviewing&&<div className="contribution-review">
      {stale&&<p role="status" className="form-help">The event changed or was removed. This suggestion cannot be approved; explain the issue when rejecting it.</p>}
      <label className="form-field"><span>Review note <span className="muted">· required when rejecting</span></span><textarea className="textarea textarea-bordered w-full" rows={3} maxLength={2000} value={note} disabled={!!busy} onChange={event=>setNote(event.target.value)}/></label>
      {error&&<p role="alert" className="form-error">{error}</p>}
      <div className="flex flex-wrap gap-3"><button className="btn btn-primary" disabled={!!busy||!!stale||String(user.id)===String(item.submitter_id)} onClick={()=>decide('approve')}>{busy==='approve'?'Publishing…':'Approve and publish'}</button>
        <button className="btn btn-outline" disabled={!!busy||String(user.id)===String(item.submitter_id)} onClick={()=>decide('reject')}>{busy==='reject'?'Sending result…':'Reject with reason'}</button></div>
      {String(user.id)===String(item.submitter_id)&&<p className="form-help">Another administrator must review your own suggestion.</p>}
    </div>}
  </article>;
}
export default function ContributionsPage() {
  const {user}=useAuth(),[params,setParams]=useSearchParams(),review=user.role==='admin'&&params.get('review')==='true',selected=params.get('request');
  const [state,setState]=useState({items:[],next:null,loading:true,error:''}),[moreBusy,setMoreBusy]=useState(false);
  const generation=useRef(0);
  const refresh=useCallback(async()=>{
    const request=++generation.current;
    setState(old=>({...old,loading:true,error:''}));
    try {
      const result=await get(`/event-suggestions${review?'?review=true':''}`);
      if(selected&&!result.items.some(item=>String(item.id)===selected)) result.items.unshift(await get(`/event-suggestions/${selected}`));
      if(request===generation.current) setState({...result,loading:false,error:''});
    } catch(failure) {if(request===generation.current) setState(old=>({...old,loading:false,error:failure.message}));}
  },[review,selected]);
  // This ref invalidates requests; it is not a DOM node to capture at setup time.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{void refresh();return()=>{generation.current++;};},[refresh]);
  async function more() {
    if(moreBusy||!state.next) return;setMoreBusy(true);const request=generation.current;
    try {
      const result=await get(`/event-suggestions?before=${state.next}${review?'&review=true':''}`);
      if(request===generation.current) setState(old=>({...old,items:[...old.items,...result.items.filter(item=>!old.items.some(previous=>previous.id===item.id))],next:result.next,error:''}));
    } catch(failure) {if(request===generation.current) setState(old=>({...old,error:failure.message}));} finally {setMoreBusy(false);}
  }
  return <PageLayout title={review?'Review community updates':'My contributions'} intro={review?'Compare each suggestion with its original details before publishing. Decisions are delivered to the contributor’s inbox.':'Track your suggested changes. Approved updates add your name to the event’s community reporters.'}
    actions={<button className="btn btn-outline" disabled={state.loading} onClick={refresh}>Refresh</button>}>
    {user.role==='admin'&&<div className="page-toolbar" role="group" aria-label="Contribution view"><button className={`btn ${review?'btn-ghost':'btn-outline'}`} onClick={()=>setParams({})}>My suggestions</button><button className={`btn ${review?'btn-outline':'btn-ghost'}`} onClick={()=>setParams({review:'true'})}>Review queue</button><Link className="btn btn-outline" to="/my-events?review=true">Review first events</Link></div>}
    {state.loading&&<p role="status">Loading contributions…</p>}
    {state.error&&<p role="alert" className="form-error">{state.error}</p>}
    {!state.loading&&!state.items.length&&!state.error&&<div className="empty-state"><p>{review?'There are no suggestions waiting for review.':'You have not suggested any updates yet.'}</p><p className="form-help">{review?'New community suggestions will appear here and in your inbox.':'Open a community-reported event and choose Suggest an update.'}</p></div>}
    {state.items.map(item=><Contribution key={`${item.id}-${item.status}`} item={item} onReviewed={refresh} selected={selected===String(item.id)}/>)}
    {state.next&&<button className="btn btn-outline" disabled={moreBusy} onClick={more}>{moreBusy?'Loading…':'More contributions'}</button>}
  </PageLayout>;
}
