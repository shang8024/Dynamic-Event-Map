import {useEffect,useRef,useState} from 'react';
import {createEvent,updateEvent} from '../services/eventsService';
import {CATEGORIES} from '../utils/event';
import LocationSearch from './LocationSearch';
import Icon from './Icon';
import {editableOccurrences,serializeOccurrences,sameOccurrences} from '../utils/eventSchedule';

export default function EventForm({initialData={},onSaved,onCancel}) {
  const [form,setForm]=useState(()=>({...initialData,title:initialData.title||'',description:initialData.description||'',
    location_address:initialData.location_address||'',category:initialData.category||'Other',status:initialData.status||'scheduled',
    latitude:initialData.latitude??initialData.position?.lat??'',longitude:initialData.longitude??initialData.position?.lng??'',
  }));
  const [dates,setDates]=useState(()=>editableOccurrences(initialData));
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [dateErrors,setDateErrors]=useState({});
  const warning=useRef(null);
  useEffect(()=>{if(error) warning.current?.focus();},[error]);
  const update=event=>setForm(old=>({...old,[event.target.name]:event.target.value}));
  function updateDate(key,name,value) {
    setDateErrors(old=>({...old,[key]:null}));
    setDates(old=>old.map(row=>row.key===key?{...row,[name]:value}:row));
  }
  async function submit(event) {
    event.preventDefault();setError('');
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
        status:form.status,version:initialData.version,...(form.place_id?{place_id:form.place_id}:{})};
      if(!initialData.id||!sameOccurrences(occurrences,serializeOccurrences(editableOccurrences(initialData)))) payload.occurrences=occurrences;
      const saved=initialData.id?await updateEvent(initialData.id,payload):await createEvent(payload);onSaved(saved);
    } catch(failure) {setError(failure.message||'Unable to save this event.');}
    finally {setBusy(false);}
  }
  const field=(name,label,type='text',extra={})=><label className="form-field" htmlFor={`event-${name}`}>
    <span>{label}</span><input id={`event-${name}`} name={name} value={form[name]} onChange={update} type={type} className="input input-bordered w-full" disabled={busy} {...extra}/></label>;
  return <form onSubmit={submit} className="event-form">
    {error&&<p ref={warning} tabIndex={-1} role="alert" className="form-error">{error}</p>}
    <fieldset className="form-section" disabled={busy}><legend>About the event</legend>
      {field('title','Event title','text',{required:true,maxLength:255})}
      <label className="form-field" htmlFor="event-category"><span>Category</span><select id="event-category" name="category" value={form.category} onChange={update} className="select select-bordered w-full">{CATEGORIES.map(value=><option key={value}>{value}</option>)}</select></label>
      <label className="form-field" htmlFor="event-description"><span>Description</span><textarea id="event-description" name="description" value={form.description} onChange={update} required maxLength={20000} rows={4} className="textarea textarea-bordered w-full" placeholder="What can visitors look forward to?"/></label>
      {initialData.id&&<label className="form-field" htmlFor="event-status"><span>Event status</span><select id="event-status" name="status" value={form.status} onChange={update} className="select select-bordered w-full"><option value="scheduled">Scheduled</option><option value="cancelled">Cancelled</option></select></label>}
    </fieldset>
    <fieldset className="form-section" disabled={busy}><legend>Where</legend>
      <LocationSearch showLabel label="Find a venue or address" placeholder="Search for a venue or street address" onSelected={place=>setForm(old=>({...old,place_id:place.place_id,location_address:place.formatted_address,latitude:place.geometry.location.lat(),longitude:place.geometry.location.lng()}))}/>
      {field('location_address','Event address','text',{required:true,maxLength:2000,'aria-describedby':'event-location-help'})}
      <p id="event-location-help" className="form-help">Choose a search result to position the pin. Changing only the address text does not move it.</p>
      <details className="advanced-fields"><summary>Pin coordinates <span>· advanced</span></summary>
        <p className="form-help">Adjust the exact pin position when a venue cannot be found. A new event starts at the map centre.</p>
        <div className="form-grid">{field('latitude','Latitude','number',{step:'any',min:-90,max:90})}{field('longitude','Longitude','number',{step:'any',min:-180,max:180})}</div>
      </details>
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
