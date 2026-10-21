import {useState} from 'react';
import {useBookmarks,useCountBookmarks} from '../hooks';
import {useAuth} from '../contexts/AuthContext';
import {useAuthAction} from '../contexts/AuthFlowContext';
import EventArtwork from './EventArtwork';
import EventComments from './EventComments';
import EventImageEditor from './EventImageEditor';
import VenuePhoto from './VenuePhoto';
import Icon from './Icon';
import {eventImage,isEnded,eventOccurrences,occurrenceTime,scheduleSummary} from '../utils/event';

export default function EventInfo({event,onClose,onEdit,onDelete,onSaved}) {
  const {user}=useAuth(),{isBookmarked,isPending,toggle}=useBookmarks();
  const count=useCountBookmarks(event?.id);
  const [failedURL,setFailedURL]=useState(null);
  const save=useAuthAction(next=>toggle(event.id,next,event),'save this event');
  if(!event) return null;
  const candidate=eventImage(event),image=candidate?.url===failedURL?null:candidate;
  const ended=isEnded(event),cancelled=event.status==='cancelled',manage=user&&(user.role==='admin'||String(user.id)===String(event.user_id));
  const occurrences=eventOccurrences(event),when=scheduleSummary(event),now=Date.now();
  const future=occurrences.filter(item=>Date.parse(item.starts_at)>=now||item.ends_at&&Date.parse(item.ends_at)>now);
  const past=occurrences.filter(item=>item.ends_at&&Date.parse(item.ends_at)<=now);
  const unconfirmed=occurrences.filter(item=>!item.ends_at&&Date.parse(item.starts_at)<now);
  const dateList=items=><ul className="occurrence-list">{items.map(item=><li key={item.key||item.source_row_id||item.starts_at}>{occurrenceTime(item)}</li>)}</ul>;
  return <article className="event-detail-content">
    <div className="event-detail-actions"><button className="btn btn-circle bg-base-100 shadow" aria-label="Close event details" onClick={onClose}>✕</button></div>
    <div className="event-detail-hero">{!image&&!ended&&!cancelled&&!event.data?.image_hidden
      ?<VenuePhoto key={[event.id,event.data?.place_id,event.location_address,event.latitude,event.longitude].join(':')} event={event}/>
      :<EventArtwork src={image?.url} alt={image?.alt} title={event.title} category={event.category} className="h-full w-full" loading="eager" onUnavailable={()=>setFailedURL(candidate?.url)}/>}
    </div>
    <div className="event-detail-body">
      {image&&<p className="photo-credit">{image.credit||(image.source==='toronto'?'Photo supplied with the Toronto event listing':'Event photo')}
        {image.source==='toronto'&&<> · <a href="https://open.toronto.ca/dataset/festivals-events/" target="_blank" rel="noopener noreferrer" className="link">Source</a></>}</p>}
      <header className="event-heading"><span className="category-label">{event.category||'Other'}</span><h2 id="event-detail-title" tabIndex={-1}>{event.title}</h2></header>
      {(ended||cancelled)&&<p role="status" className="event-status-note">{cancelled?'This event has been cancelled.':'This event has ended. It stays in your saved events.'}</p>}
      <dl className="event-facts">
        <div><Icon name="calendar"/><div><dt>{when.label} <span>· Toronto time</span></dt><dd>{when.text}</dd></div></div>
        <div><Icon name="pin"/><div><dt>Location</dt><dd>{event.location_name&&<>{event.location_name}<br/></>}{event.location_address||'Location to be confirmed'}</dd></div></div>
      </dl>
      <div className="event-save">
        <button className={`btn w-full ${isBookmarked(event.id)?'btn-outline':'btn-primary'}`} aria-pressed={isBookmarked(event.id)} disabled={isPending(event.id)} onClick={()=>save(user?undefined:true)}><Icon name="bookmark"/>{isPending(event.id)?'Updating…':isBookmarked(event.id)?'Saved · remove bookmark':'Save event'}</button>
        {count>0&&<p className="text-sm muted">Saved by {count} {count===1?'person':'people'}</p>}
      </div>
      <section className="detail-section"><h3>About this event</h3><p className="event-description">{event.description||'The organizer has not provided a description yet.'}</p>
        {event.data?.website&&/^https?:\/\//.test(event.data.website)&&<a className="link organizer-link" href={event.data.website} target="_blank" rel="noopener noreferrer">Organizer’s website ↗</a>}
      </section>
      {occurrences.length>0&&<details className="schedule-details"><summary>All dates <span>· {occurrences.length} {occurrences.length===1?'occurrence':'occurrences'}</span></summary>
        {future.length>0&&dateList(future)}
        {unconfirmed.length>0&&<details className="past-dates"><summary>Earlier dates · end time unknown · {unconfirmed.length}</summary>{dateList(unconfirmed)}</details>}
        {past.length>0&&<details className="past-dates"><summary>Past dates · {past.length}</summary>{dateList(past)}</details>}
      </details>}
      <EventComments key={event.id} eventId={event.id}/>
      {manage&&<section className="event-management" aria-label="Manage event"><div><p className="eyebrow">Manage event</p><p className="text-sm muted">Only you and project administrators can change this listing.</p></div>
        <div className="flex flex-wrap gap-2"><button className="btn btn-outline flex-1" onClick={()=>onEdit(event)}>Edit event</button>
          <button className="btn btn-ghost text-error" onClick={()=>{if(confirm(event.source==='external'?'Cancel this event? Its saved history will be retained.':'Delete this event?')) onDelete(event.id);}}>{event.source==='external'?'Cancel event':'Delete event'}</button></div>
        {!ended&&<EventImageEditor key={`${event.id}:${event.version}`} event={event} onSaved={onSaved}/>}
      </section>}
      {event.source==='external'&&<p className="source-disclosure">Listed by Toronto Festivals & Events. Details may change; confirm with the organizer. <a href="https://open.toronto.ca/open-data-licence/" target="_blank" rel="noopener noreferrer" className="link">Data licence</a></p>}
    </div>
  </article>;
}
