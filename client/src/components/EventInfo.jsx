import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {useBookmarks,useCountBookmarks} from '../hooks';
import {useAuth} from '../contexts/AuthContext';
import {useAuthFlow} from '../contexts/AuthFlowContext';
import EventArtwork from './EventArtwork';
import EventComments from './EventComments';
import EventImageEditor from './EventImageEditor';
import VenuePhoto from './VenuePhoto';
import Icon from './Icon';
import Modal from './Modal';
import ReportedBy from './ReportedBy';
import {updateEvent} from '../services/eventsService';
import {eventImage,isEnded,eventOccurrences,occurrenceTime,scheduleSummary} from '../utils/event';

export default function EventInfo({event,onClose,onEdit,onDelete,onSaved,pendingAction,onActionHandled,bodyRef,onBodyScroll,standalone=false,mapsReady=true,promptForPhoto=false,detailsLoading=false,detailsError='',onRetryDetails}) {
  const {user}=useAuth(),{isBookmarked,isPending,toggle,loading:bookmarksLoading,error:bookmarkError,refetchBookmarks}=useBookmarks();
  const count=useCountBookmarks(event?.id);
  const [failedURL,setFailedURL]=useState(null);
  const [management,setManagement]=useState(null),[managementBusy,setManagementBusy]=useState(false),[managementError,setManagementError]=useState(''),[photoOpen,setPhotoOpen]=useState(false);
  const [photoEditing,setPhotoEditing]=useState({dirty:false,busy:false});
  const requestAuth=useAuthFlow(),handled=useRef(null),saveButton=useRef(null);
  const returnTo=standalone?`/events/${event?.id}`:`/?event=${event?.id}`;
  const save=()=>user?toggle(event.id,undefined,event):requestAuth('save this event',returnTo,{kind:'save',eventId:event.id});
  useEffect(()=>{setManagement(null);setManagementError('');setPhotoOpen(false);},[event?.id]);
  useEffect(()=>{
    if(!event||!user||!pendingAction||String(pendingAction.eventId)!==String(event.id)||pendingAction.kind==='save'&&bookmarksLoading) return;
    const key=`${event.id}:${pendingAction.kind}`;
    if(handled.current===key) return;
    handled.current=key;onActionHandled?.();
    if(pendingAction.kind==='save') {
      const target=saveButton.current;
      Promise.resolve(isBookmarked(event.id)?null:toggle(event.id,true,event)).finally(()=>requestAnimationFrame(()=>{
        if(target?.isConnected&&target.dataset.eventId===String(event.id)) target.focus({preventScroll:true});
      }));
    }
    if(pendingAction.kind==='comment') requestAnimationFrame(()=>document.getElementById(`comment-${event.id}`)?.focus());
  },[event,user,pendingAction,bookmarksLoading,isBookmarked,toggle,onActionHandled]);
  if(!event) return null;
  const candidate=eventImage(event),image=candidate?.url===failedURL?null:candidate;
  const ended=isEnded(event),cancelled=event.status==='cancelled',manage=!detailsLoading&&user&&(user.role==='admin'||String(user.id)===String(event.user_id));
  const occurrences=eventOccurrences(event),when=scheduleSummary(event),now=Date.now();
  const future=occurrences.filter(item=>Date.parse(item.starts_at)>=now||item.ends_at&&Date.parse(item.ends_at)>now);
  const past=occurrences.filter(item=>item.ends_at&&Date.parse(item.ends_at)<=now);
  const unconfirmed=occurrences.filter(item=>!item.ends_at&&Date.parse(item.starts_at)<now);
  const dateList=items=><ul className="occurrence-list">{items.map(item=><li key={item.key||item.source_row_id||item.starts_at}>{occurrenceTime(item)}</li>)}</ul>;
  const Heading=standalone?'h1':'h2';
  const SectionHeading=standalone?'h2':'h3';
  const photoLocked=photoEditing.dirty||photoEditing.busy;
  async function applyManagement() {
    if(managementBusy||photoLocked) return;
    setManagementBusy(true);setManagementError('');
    try {
      if(management==='cancel') {
        const row=await updateEvent(event.id,{status:'cancelled',version:event.version});
        onSaved?.(row);
      } else if(await onDelete(event.id)===false) throw new Error('This event could not be deleted. Please try again.');
      setManagement(null);
    } catch(failure) {setManagementError(failure.message||'Unable to update this event. Please try again.');}
    finally {setManagementBusy(false);}
  }
  const askManagement=action=>{if(photoLocked) return;setManagementError('');setManagement(action);};
  return <article className="event-detail-content">
    <div className="event-detail-hero">{mapsReady&&!image&&!ended&&!cancelled&&!event.data?.image_hidden
      ?<VenuePhoto key={[event.id,event.data?.place_id,event.location_address,event.latitude,event.longitude].join(':')} event={event}/>
      :<EventArtwork src={image?.url} alt={image?.alt} title={event.title} category={event.category} className="h-full w-full" loading="eager" onUnavailable={()=>setFailedURL(candidate?.url)}/>}
      {!standalone&&<button className="btn btn-circle event-detail-close" aria-label="Close event details" onClick={onClose}>✕</button>}
    </div>
    <div ref={bodyRef} className="event-detail-scroll" onScroll={onBodyScroll}>
    <div className="event-detail-body">
      {(image||event.submission_role==='reporter')&&<div className="event-credit-row">
        {image&&<p className="photo-credit">{image.credit||(image.source==='toronto'?'Photo supplied with the Toronto event listing':'Event photo')}
          {image.source==='toronto'&&event.submission_role!=='reporter'&&<> · <a href="https://open.toronto.ca/dataset/festivals-events/" target="_blank" rel="noopener noreferrer" className="link">Source</a></>}</p>}
        {event.submission_role==='reporter'&&<ReportedBy key={`${event.id}-${event.contributor_count}`} event={event}/>}
      </div>}
      <div className="event-overview">
      <div className="event-intro">
      <header className="event-heading"><div className="event-heading-topline"><span className="category-label">{event.category||'Other'}</span>{!standalone&&<div className="event-heading-links"><Link className="event-full-link" to={`/events/${event.id}`} target="_blank" rel="noopener noreferrer">Full details <span aria-hidden="true">↗</span><span className="sr-only"> (opens in a new tab)</span></Link></div>}</div><Heading id="event-detail-title" tabIndex={-1}>{event.title}</Heading></header>
      {event.data?.organizer_name&&<p className="event-organizer">Organizer <strong>{event.data.organizer_name}</strong></p>}
      {(ended||cancelled)&&<p role="status" className="event-status-note">{cancelled?'This event has been cancelled.':'This event has ended. It stays in your saved events.'}</p>}
      {promptForPhoto&&manage&&!ended&&!cancelled&&<div className="rounded-xl border border-base-300 p-3 flex flex-wrap items-center justify-between gap-3" role="status"><p className="text-sm">Your event is published. Add a photo to help people recognize it.</p><button className="btn btn-outline btn-sm" onClick={()=>setPhotoOpen(value=>Number(value)+1)}>Add photo link</button></div>}
      </div>
      <section className="event-visit-card" aria-label="Time, location and saving">
      <dl className="event-facts">
        <div><Icon name="calendar"/><div><dt>{when.label} <span>· Toronto time</span></dt><dd>{when.text}</dd></div></div>
        <div><Icon name="pin"/><div><dt>Location</dt><dd>{event.location_name&&<>{event.location_name}<br/></>}{event.location_address||'Location to be confirmed'}</dd></div></div>
      </dl>
      <div className="event-save">
        <button ref={saveButton} data-event-id={event.id} className={`btn w-full ${isBookmarked(event.id)?'btn-outline':'btn-primary'}`} aria-pressed={isBookmarked(event.id)} disabled={isPending(event.id)||!!user&&bookmarksLoading} onClick={save}><Icon name="bookmark"/>{isPending(event.id)?'Updating…':user&&bookmarksLoading?'Checking saved events…':isBookmarked(event.id)?'Saved · remove bookmark':'Save event'}</button>
        {bookmarkError&&<p role="alert" className="text-sm text-error">{bookmarkError} <button className="link min-h-11" onClick={refetchBookmarks}>Retry</button></p>}
        {count>0&&<p className="text-sm muted">Saved by {count} {count===1?'person':'people'}</p>}
      </div>
      </section>
      <div className="event-story">
      <section className="detail-section"><SectionHeading>About this event</SectionHeading>{detailsLoading?<p role={detailsError?'alert':'status'} className="event-description">{detailsError||'Loading event details…'}{detailsError&&<button className="btn btn-outline btn-sm ml-3" onClick={onRetryDetails}>Retry</button>}</p>:<p className="event-description">{event.description||'The organizer has not provided a description yet.'}</p>}
        {event.data?.website&&/^https?:\/\//.test(event.data.website)&&<a className="link organizer-link" href={event.data.website} target="_blank" rel="noopener noreferrer">Organizer’s website ↗</a>}
      </section>
      {occurrences.length>0&&<details className="schedule-details"><summary>All dates <span>· {occurrences.length} {occurrences.length===1?'occurrence':'occurrences'}</span></summary>
        {future.length>0&&dateList(future)}
        {unconfirmed.length>0&&<details className="past-dates"><summary>Earlier dates · end time unknown · {unconfirmed.length}</summary>{dateList(unconfirmed)}</details>}
        {past.length>0&&<details className="past-dates"><summary>Past dates · {past.length}</summary>{dateList(past)}</details>}
      </details>}
      </div>
      </div>
      {event.submission_role==='reporter'&&!manage&&!ended&&!cancelled&&<section className="community-contribute"><div><h3>Help keep this event accurate</h3><p>Suggest a correction or add a missing detail. Updates are reviewed before publication.</p></div><Link className="btn btn-outline" to={`/events/${event.id}/suggest`}>Suggest an update</Link></section>}
      <EventComments key={event.id} eventId={event.id} preview={!standalone} returnTo={standalone?`${returnTo}#comments`:returnTo}/>
      {manage&&<section className="event-management" aria-label="Manage event"><div><p className="eyebrow">Manage event</p><p className="text-sm muted">Only you and project administrators can change this listing.</p></div>
        <div className="flex flex-wrap gap-2"><button className="btn btn-outline flex-1" onClick={()=>onEdit(event)}>Edit event</button>
          {!cancelled&&!ended&&<button className="btn btn-outline" disabled={photoLocked} aria-describedby={photoLocked?'photo-management-help':undefined} onClick={()=>askManagement('cancel')}>Cancel event</button>}</div>
        {photoLocked&&<p id="photo-management-help" role="status" className="text-sm muted">{photoEditing.busy?'Wait for the photo request to finish before cancelling or deleting this event.':'Save or discard your photo changes before cancelling or deleting this event.'}</p>}
        {event.source!=='external'&&<details className="rounded-xl border border-base-300 p-3"><summary className="cursor-pointer py-1 font-medium">More management options</summary><p className="text-sm muted mt-3 mb-3">Cancelling keeps the event, comments and saved history. Permanently deleting also removes its comments and bookmarks.</p><button className="btn btn-ghost text-error" disabled={photoLocked} aria-describedby={photoLocked?'photo-management-help':undefined} onClick={()=>askManagement('delete')}>Delete event permanently</button></details>}
        {!ended&&!cancelled&&<EventImageEditor key={event.id} event={event} onSaved={onSaved} initiallyOpen={photoOpen} onStateChange={setPhotoEditing}/>}
      </section>}
      {event.source==='external'&&<p className="source-disclosure">Listed by Toronto Festivals & Events. Details may change; confirm with the organizer. <a href="https://open.toronto.ca/open-data-licence/" target="_blank" rel="noopener noreferrer" className="link">Data licence</a></p>}
      {management&&<Modal title={management==='cancel'?'Cancel this event?':'Permanently delete this event?'} busy={managementBusy} onClose={()=>setManagement(null)}>
        <p className="font-semibold break-words">{event.title}</p>
        <p className="mt-3 text-sm leading-relaxed">{management==='cancel'?'This event will be marked cancelled and leave upcoming results. Comments and saved history will stay available. You can change its status later in Edit event.':'This permanently deletes the event, all its comments, bookmarks and scheduled reminders. People will lose their saved record. This cannot be undone. Cancel the event instead to keep its history.'}</p>
        {managementError&&<p role="alert" className="form-error mt-4">{managementError}</p>}
        <div className="flex flex-wrap justify-end gap-3 mt-5"><button className="btn btn-ghost" disabled={managementBusy} onClick={()=>setManagement(null)}>Keep event</button>
          {management==='delete'&&!cancelled&&!ended&&<button className="btn btn-outline" disabled={managementBusy} onClick={()=>askManagement('cancel')}>Cancel event instead</button>}
          <button className={`btn ${management==='delete'?'btn-error':'btn-primary'}`} disabled={managementBusy||photoLocked} onClick={applyManagement}>{managementBusy?(management==='cancel'?'Cancelling…':'Deleting…'):management==='cancel'?'Confirm cancellation':'Permanently delete'}</button></div>
      </Modal>}
    </div>
    </div>
  </article>;
}
