import {useEffect,useRef,useState} from 'react';
import {createEvent,updateEvent} from '../services/eventsService';
import {CATEGORIES} from '../utils/event';
import LocationSearch from './LocationSearch';
import Icon from './Icon';
import {editableOccurrences,serializeOccurrences,sameOccurrences} from '../utils/eventSchedule';
import {eventDraftSignature,eventLocationError,locationPoint,sameLocation,withinGTA} from '../utils/eventLocation';
import useUnsavedChanges from '../hooks/useUnsavedChanges';

export default function EventForm({initialData={},onSaved,onCancel,onDirtyChange,onBusyChange,onDiscard}) {
  const [form,setForm]=useState(()=>({...initialData,title:initialData.title||'',description:initialData.description||'',
    location_address:initialData.location_address||'',category:initialData.category||'Other',status:initialData.status||'scheduled',
    latitude:initialData.latitude??initialData.position?.lat??'',longitude:initialData.longitude??initialData.position?.lng??'',
    place_id:initialData.place_id??initialData.data?.place_id??null,
  }));
  const [dates,setDates]=useState(()=>editableOccurrences(initialData));
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [dateErrors,setDateErrors]=useState({});
  const [locationConfirmed,setLocationConfirmed]=useState(false),[locationError,setLocationError]=useState('');
  const initial=useRef({form,signature:eventDraftSignature(form,dates)});
  const dirty=eventDraftSignature(form,dates)!==initial.current.signature;
  const {allowNavigation}=useUnsavedChanges({dirty,busy,title:'Leave this event without saving?',description:'Your event changes have not been saved. Keep editing to finish your listing.',onDiscard});
  useEffect(()=>{onDirtyChange?.(dirty);},[dirty,onDirtyChange]);
  useEffect(()=>{onBusyChange?.(busy);},[busy,onBusyChange]);
  const warning=useRef(null);
  useEffect(()=>{if(error) warning.current?.focus();},[error]);
  const update=event=>{
    const {name,value}=event.target;
    const changesLocation=['location_address','latitude','longitude'].includes(name);
    if(changesLocation) {setLocationConfirmed(false);setLocationError('');}
    setForm(old=>({...old,[name]:value,...(changesLocation?{place_id:null}:{})}));
  };
  function selectPlace(place) {
    setForm(old=>({...old,place_id:place.place_id,location_address:place.formatted_address,latitude:place.geometry.location.lat(),longitude:place.geometry.location.lng()}));
    setLocationConfirmed(true);setLocationError('');
  }
  function updateDate(key,name,value) {
    setDateErrors(old=>({...old,[key]:null}));
    setDates(old=>old.map(row=>row.key===key?{...row,[name]:value}:row));
  }
  async function submit(event) {
    event.preventDefault();setError('');
    const placeError=eventLocationError(form,{existing:initialData.id?initial.current.form:null,confirmed:locationConfirmed});
    setLocationError(placeError);
    if(placeError) {setError(placeError);return;}
    const invalid={};
    dates.forEach(item=>{try {serializeOccurrences([item]);} catch(failure) {invalid[item.key]=failure instanceof RangeError?'This Toronto time is ambiguous or does not exist during the daylight-saving transition. Choose another time.':failure.message;}});
    setDateErrors(invalid);
    const invalidIndex=dates.findIndex(item=>invalid[item.key]);
    if(invalidIndex>=0) {setError(`Check date range ${invalidIndex+1}. ${invalid[dates[invalidIndex].key]}`);return;}
    let occurrences;
    try {occurrences=serializeOccurrences(dates);}
    catch(failure) {setError(failure instanceof RangeError?'This Toronto time is ambiguous or does not exist during the daylight-saving transition. Choose another time.':failure.message);return;}
    setBusy(true);
    try {
      const payload={title:form.title.trim(),description:form.description.trim(),category:form.category,
        location_address:form.location_address.trim(),latitude:form.latitude===''?null:Number(form.latitude),longitude:form.longitude===''?null:Number(form.longitude),
        status:form.status,version:initialData.version,place_id:form.place_id||null};
      if(!initialData.id||!sameOccurrences(occurrences,serializeOccurrences(editableOccurrences(initialData)))) payload.occurrences=occurrences;
      const saved=initialData.id?await updateEvent(initialData.id,payload):await createEvent(payload);allowNavigation(()=>onSaved(saved));
    } catch(failure) {setError(failure.message||'Unable to save this event.');}
    finally {setBusy(false);}
  }
  const field=(name,label,type='text',extra={})=><label className="form-field" htmlFor={`event-${name}`}>
    <span>{label}</span><input id={`event-${name}`} name={name} value={form[name]} onChange={update} type={type} className="input input-bordered w-full" disabled={busy} {...extra}/></label>;
  const point=locationPoint(form),locationChanged=!initialData.id||!sameLocation(form,initial.current.form);
  return <form onSubmit={submit} className="event-form">
    {error&&<p ref={warning} tabIndex={-1} role="alert" className="form-error">{error}</p>}
    <fieldset className="form-section" disabled={busy}><legend>About the event</legend>
      {field('title','Event title','text',{required:true,maxLength:255})}
      <label className="form-field" htmlFor="event-category"><span>Category</span><select id="event-category" name="category" value={form.category} onChange={update} className="select select-bordered w-full">{CATEGORIES.map(value=><option key={value}>{value}</option>)}</select></label>
      <label className="form-field" htmlFor="event-description"><span>Description</span><textarea id="event-description" name="description" value={form.description} onChange={update} required maxLength={20000} rows={4} className="textarea textarea-bordered w-full" placeholder="What can visitors look forward to?"/></label>
      {initialData.id&&<label className="form-field" htmlFor="event-status"><span>Event status</span><select id="event-status" name="status" value={form.status} onChange={update} className="select select-bordered w-full"><option value="scheduled">Scheduled</option><option value="cancelled">Cancelled</option></select></label>}
    </fieldset>
    <fieldset className="form-section" disabled={busy}><legend>Where</legend>
      <LocationSearch showLabel label="Find a venue or address" placeholder="Search for a venue or street address" onSelected={selectPlace}/>
      {field('location_address','Event address','text',{required:true,maxLength:2000,'aria-invalid':!!locationError,'aria-describedby':locationError?'event-location-help event-location-error':'event-location-help'})}
      <p id="event-location-help" className="form-help">Choose a search result to position the pin within the GTA. If you enter an address manually, check and confirm its coordinates below.</p>
      <div className="rounded-lg border border-base-300 p-3 text-sm" role="status">
        <strong className="block">{form.place_id?'Venue selected':locationChanged?'Pin needs your confirmation':'Current event location'}</strong>
        <span>{point?`Pin: ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}${withinGTA(point)?' · GTA':' · outside the GTA'}`:'No pin coordinates are available.'}</span>
        {locationChanged&&!form.place_id&&<p className="mt-1">Typing an address does not move the pin. Choose a search result or adjust the coordinates before confirming.</p>}
      </div>
      <details className="advanced-fields"><summary>Pin coordinates <span>· advanced</span></summary>
        <p className="form-help">Adjust the exact pin position when a venue cannot be found. A new event starts at the map centre.</p>
        <div className="form-grid">{field('latitude','Latitude','number',{step:'any',min:-90,max:90})}{field('longitude','Longitude','number',{step:'any',min:-180,max:180})}</div>
      </details>
      {locationChanged&&!form.place_id&&<label className="flex items-start gap-3 text-sm"><input type="checkbox" className="checkbox checkbox-primary" checked={locationConfirmed} disabled={!point||!withinGTA(point)} onChange={event=>{setLocationConfirmed(event.target.checked);setLocationError('');}}/>
        <span>I checked that these pin coordinates match the event address.</span></label>}
      {locationError&&<p id="event-location-error" className="text-sm text-error">{locationError}</p>}
    </fieldset>
    <fieldset className="form-section" disabled={busy}><legend>When <span>· Toronto time</span></legend>
      <p className="form-help">Each date range is a separate occurrence. Leave the end blank if it is unknown.</p>
      <div className="date-ranges">{dates.map((item,index)=><div key={item.key} className="date-range">
        <div className="date-range-heading"><span>Date range {index+1}</span><button type="button" className="btn btn-ghost btn-sm" disabled={dates.length===1} aria-label={`Remove occurrence ${index+1}`} onClick={()=>setDates(old=>old.filter(row=>row.key!==item.key))}>Remove</button></div>
        <div className="form-grid">{['starts_at','ends_at'].map(name=><label key={name} className="form-field"><span>{name==='starts_at'?'Start':'End (optional)'}</span><input type="datetime-local" className="input input-bordered w-full" aria-label={`Occurrence ${index+1} ${name==='starts_at'?'start':'end'}`} aria-invalid={!!dateErrors[item.key]} aria-describedby={dateErrors[item.key]?`date-error-${item.key}`:undefined} required={name==='starts_at'} value={item[name]} onChange={event=>updateDate(item.key,name,event.target.value)}/></label>)}</div>
        {dateErrors[item.key]&&<p id={`date-error-${item.key}`} className="text-sm text-error mt-3">{dateErrors[item.key]}</p>}
      </div>)}</div>
      <button type="button" className="btn btn-outline self-start" disabled={dates.length>=366} onClick={()=>setDates(old=>[...old,{key:crypto.randomUUID(),starts_at:'',ends_at:''}])}>＋ Add another date range</button>
    </fieldset>
    <section className="form-photo-note"><Icon name="photo" size={24}/><div><h3>Event photo</h3><p>After saving, use Manage event to add or update a photo link. You can keep browsing while we check the image.</p></div></section>
    <div className="form-actions"><button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy?'Saving…':initialData.id?'Save changes':'Create event'}</button></div>
  </form>;
}
