import {useState} from 'react';
import {createEvent,updateEvent} from '../services/eventsService';
import {CATEGORIES} from '../utils/event';
import LocationSearch from './LocationSearch';
import {editableOccurrences,serializeOccurrences,sameOccurrences} from '../utils/eventSchedule';
export default function EventForm({initialData={},onSaved,onCancel}) {
  const [form,setForm]=useState(()=>({...initialData,title:initialData.title||'',description:initialData.description||'',
    location_address:initialData.location_address||'',category:initialData.category||'Other',status:initialData.status||'scheduled',
    latitude:initialData.latitude??initialData.position?.lat??'',longitude:initialData.longitude??initialData.position?.lng??'',
  }));
  const [dates,setDates]=useState(()=>editableOccurrences(initialData));
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const update=event=>setForm(old=>({...old,[event.target.name]:event.target.value}));
  async function submit(event) {
    event.preventDefault();setError('');
    let occurrences;
    try {
      occurrences=serializeOccurrences(dates);
    } catch(failure) {setError(failure instanceof RangeError?'This Toronto time is ambiguous or does not exist during the daylight-saving transition. Choose another time.':failure.message);return;}
    setBusy(true);
    try {
      const payload={title:form.title.trim(),description:form.description.trim(),category:form.category,
        location_address:form.location_address.trim(),latitude:form.latitude===''?null:Number(form.latitude),longitude:form.longitude===''?null:Number(form.longitude),
        status:form.status,version:initialData.version,...(form.place_id?{place_id:form.place_id}:{})};
      if(!initialData.id || !sameOccurrences(occurrences,serializeOccurrences(editableOccurrences(initialData)))) payload.occurrences=occurrences;
      const saved=initialData.id?await updateEvent(initialData.id,payload):await createEvent(payload);onSaved(saved);
    } catch(failure) {setError(failure.message||'Unable to save this event.');}
    finally {setBusy(false);}
  }
  const field=(name,label,type='text',extra={})=><label className="form-field" htmlFor={`event-${name}`}>
    <span>{label}</span><input id={`event-${name}`} name={name} value={form[name]} onChange={update} type={type} className="input input-bordered w-full" disabled={busy} {...extra}/></label>;
  return <form onSubmit={submit} className="space-y-5">
    {error && <p role="alert" className="alert alert-error">{error}</p>}
    {field('title','Event title','text',{required:true,maxLength:255})}
    <LocationSearch label="Find event venue" placeholder="Find the event’s venue or address" onSelected={place=>setForm(old=>({...old,place_id:place.place_id,location_address:place.formatted_address,latitude:place.geometry.location.lat(),longitude:place.geometry.location.lng()}))}/>
    {field('location_address','Address','text',{required:true,maxLength:2000})}
    <p className="text-sm text-base-content/75">Coordinates determine the map pin. Update them too if you change the venue.</p>
    <div className="grid gap-4 sm:grid-cols-2">{field('latitude','Latitude','number',{step:'any',min:-90,max:90})}{field('longitude','Longitude','number',{step:'any',min:-180,max:180})}</div>
    <fieldset className="space-y-3" disabled={busy}><legend className="font-semibold">Dates & occurrences · Toronto time</legend>
      <p className="text-sm text-base-content/75">Each row is a separate date range. Leave the end blank if it is not known.</p>
      {dates.map((item,index)=><div key={item.key} className="space-y-3 rounded-xl border border-base-300 p-3">
        <div className="flex items-center justify-between gap-2"><span className="font-medium">Occurrence {index+1}</span><button type="button" className="btn btn-ghost btn-sm" disabled={dates.length===1} aria-label={`Remove occurrence ${index+1}`} onClick={()=>setDates(old=>old.filter(row=>row.key!==item.key))}>Remove</button></div>
        <div className="grid gap-3 sm:grid-cols-2">{['starts_at','ends_at'].map(name=><label key={name} className="form-field"><span>{name==='starts_at'?'Start':'End (optional)'}</span><input type="datetime-local" className="input input-bordered w-full" aria-label={`Occurrence ${index+1} ${name==='starts_at'?'start':'end'}`} required={name==='starts_at'} value={item[name]} onChange={event=>setDates(old=>old.map(row=>row.key===item.key?{...row,[name]:event.target.value}:row))}/></label>)}</div>
      </div>)}
      <button type="button" className="btn btn-outline" disabled={dates.length>=366} onClick={()=>setDates(old=>[...old,{key:crypto.randomUUID(),starts_at:'',ends_at:''}])}>Add another date range</button>
    </fieldset>
    <label className="form-field" htmlFor="event-category"><span>Category</span><select id="event-category" name="category" value={form.category} onChange={update} className="select select-bordered w-full" disabled={busy}>{CATEGORIES.map(value=><option key={value}>{value}</option>)}</select></label>
    <label className="form-field" htmlFor="event-description"><span>Description</span><textarea id="event-description" name="description" value={form.description} onChange={update} required maxLength={20000} rows={5} className="textarea textarea-bordered w-full" disabled={busy}/></label>
    {initialData.id && <label className="form-field" htmlFor="event-status"><span>Status</span><select id="event-status" name="status" value={form.status} onChange={update} className="select select-bordered w-full" disabled={busy}><option value="scheduled">Scheduled</option><option value="cancelled">Cancelled</option></select></label>}
    <div className="flex justify-end gap-3 border-t border-base-300 pt-4"><button type="button" className="btn" disabled={busy} onClick={onCancel}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy?'Saving…':initialData.id?'Save changes':'Create event'}</button></div>
  </form>;
}
