import {useBookmarks,useCountBookmarks} from '../hooks';
import {useAuth} from '../contexts/AuthContext';
import EventArtwork from './EventArtwork';
import EventComments from './EventComments';
import EventImageEditor from './EventImageEditor';
import VenuePhoto from './VenuePhoto';
import {eventImage,eventTime,nextStart,isEnded,eventOccurrences,nextOccurrence,occurrenceTime} from '../utils/event';
import {useState} from 'react';
export default function EventInfo({event,onClose,onEdit,onDelete,onSaved}) {
  const {user}=useAuth(),{isBookmarked,isPending,toggle}=useBookmarks();
  const count=useCountBookmarks(event?.id);
  const [failedURL,setFailedURL]=useState(null);
  if(!event) return null;
  const candidate=eventImage(event),image=candidate?.url===failedURL?null:candidate,ended=isEnded(event),manage=user&&(user.role==='admin'||String(user.id)===String(event.user_id));
  const occurrences=eventOccurrences(event),next=nextOccurrence(event);
  return <article className="event-detail-content">
    <div className="event-detail-actions"><button className="btn btn-circle bg-base-100 shadow" aria-label="Close event details" onClick={onClose}>✕</button></div>
    <div className="event-detail-hero">{!image && !ended && event.status!=='cancelled' && !event.data?.image_hidden?
      <VenuePhoto key={[event.id,event.data?.place_id,event.location_address,event.latitude,event.longitude].join(':')} event={event}/>:<EventArtwork src={image?.url} alt={image?.alt} title={event.title} category={event.category} className="h-full w-full" loading="eager" onUnavailable={()=>setFailedURL(candidate?.url)}/>}
      </div>
    <div className="space-y-5 p-5">
      {image && <p className="text-xs text-base-content/75">{image.credit|| (image.source==='toronto'?'Photo supplied with the Toronto event listing':'Event photo')}
        {image.source==='toronto' && <> · <a href="https://open.toronto.ca/dataset/festivals-events/" target="_blank" rel="noopener noreferrer" className="link">Source</a></>}</p>}
      <div><span className="badge badge-outline mb-3">{event.category||'Other'}</span><h2 id="event-detail-title" tabIndex={-1} className="text-2xl font-semibold leading-tight outline-none">{event.title}</h2></div>
      {(ended||event.status==='cancelled') && <p role="status" className="rounded-xl bg-base-300 p-3 font-medium">{event.status==='cancelled'?'This event has been cancelled.':'This event has ended. It stays in your saved events.'}</p>}
      <dl className="space-y-3 text-sm"><div><dt className="font-semibold">{ended?'Event dates':next && new Date(next.starts_at)<=new Date()?'Happening now':'Next occurrence'} · Toronto time</dt><dd className="mt-1">{next?occurrenceTime(next):eventTime(nextStart(event))}</dd></div>
        <div><dt className="font-semibold">Location</dt><dd className="mt-1 break-words">{event.location_name && <>{event.location_name}<br/></>}{event.location_address||'Location to be confirmed'}</dd></div></dl>
      {user?<button className={`btn w-full ${isBookmarked(event.id)?'btn-outline':'btn-primary'}`} aria-pressed={isBookmarked(event.id)} disabled={isPending(event.id)} onClick={()=>toggle(event.id,undefined,event)}>{isPending(event.id)?'Updating…':isBookmarked(event.id)?'Saved · remove bookmark':'Save event'}</button>
        :<p className="rounded-xl bg-base-200 p-3 text-sm">Sign in to save this event and receive updates.</p>}
      {count>0 && <p className="text-sm text-base-content/75">Saved by {count} {count===1?'person':'people'}</p>}
      <div><h3 className="font-semibold mb-2">About this event</h3><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{event.description}</p></div>
      {occurrences.length>0 && <details className="rounded-xl bg-base-200 p-3"><summary className="cursor-pointer font-medium">All dates · {occurrences.length} {occurrences.length===1?'occurrence':'occurrences'}</summary><ul className="mt-3 max-h-64 space-y-3 overflow-auto text-sm">{occurrences.map(item=><li key={item.key||item.source_row_id||item.starts_at}>{occurrenceTime(item)}{item.ends_at && new Date(item.ends_at)<new Date() && <span className="ml-2 text-base-content/70">Ended</span>}</li>)}</ul></details>}
      {event.data?.website && /^https?:\/\//.test(event.data.website) && <a className="btn btn-outline w-full" href={event.data.website} target="_blank" rel="noopener noreferrer">Organizer’s website ↗</a>}
      {manage && <><div className="flex flex-wrap gap-2"><button className="btn btn-outline flex-1" onClick={()=>onEdit(event)}>Edit event</button>
        <button className="btn btn-ghost text-error" onClick={()=>{if(confirm(event.source==='external'?'Cancel this event? Its saved history will be retained.':'Delete this event?')) onDelete(event.id);}}>{event.source==='external'?'Cancel event':'Delete'}</button></div>
        {!ended && <EventImageEditor key={`${event.id}:${event.version}`} event={event} onSaved={onSaved}/>}</>}
      {event.source==='external' && <p className="text-xs text-base-content/75">Listed by Toronto Festivals & Events. Details may change; confirm with the organizer. <a href="https://open.toronto.ca/open-data-licence/" target="_blank" rel="noopener noreferrer" className="link">Data licence</a></p>}
      <hr className="border-base-300"/><EventComments key={event.id} eventId={event.id}/>
    </div>
  </article>;
}
