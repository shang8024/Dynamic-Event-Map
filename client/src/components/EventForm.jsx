import {useCallback,useEffect,useRef,useState} from 'react';
import {createEvent,updateEvent} from '../services/eventsService';
import {CATEGORIES} from '../utils/event';
import EventLocationPicker from './EventLocationPicker';
import Icon from './Icon';
import {editableOccurrences,serializeOccurrences,sameOccurrences} from '../utils/eventSchedule';
import {eventDraftSignature,eventLocationError,sameLocation} from '../utils/eventLocation';
import useUnsavedChanges from '../hooks/useUnsavedChanges';
import {post} from '../services/apiService';
import {useNotifications} from '../contexts/NotificationContext';
import {occurrenceTime} from '../utils/event';

const STEPS=['Event details','Location','Photo link','Review'];
export default function EventForm({initialData={},onSaved,onCancel,onDirtyChange,onBusyChange,onDiscard,wizard=false,onSubmitChanges,mapsReady=Boolean(window.google?.maps)}) {
  const [form,setForm]=useState(()=>({...initialData,title:initialData.title||'',description:initialData.description||'',
    location_address:initialData.location_address||'',category:initialData.category||'Other',status:initialData.status||'scheduled',
    latitude:initialData.latitude??initialData.position?.lat??'',longitude:initialData.longitude??initialData.position?.lng??'',
    place_id:initialData.place_id??initialData.data?.place_id??null,
    submission_role:'',organizer_confirmed:false,
    organizer_name:initialData.data?.organizer_name||'',suggestion_explanation:'',
  }));
  const [step,setStep]=useState(0),[photo,setPhoto]=useState({url:'',alt:'',credit:''}),[preview,setPreview]=useState('');
  const stepHeading=useRef(null),formElement=useRef(null),{push}=useNotifications();
  useEffect(()=>{if(wizard) {if(step>0) formElement.current?.scrollIntoView({block:'start'});stepHeading.current?.focus({preventScroll:true});}},[step,wizard]);
  const [dates,setDates]=useState(()=>editableOccurrences(initialData));
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const [dateErrors,setDateErrors]=useState({});
  const [locationConfirmed,setLocationConfirmed]=useState(false),[locationError,setLocationError]=useState('');
  const [locationBusy,setLocationBusy]=useState(false);
  const confirmLocation=useCallback(value=>{setLocationConfirmed(value);setLocationError('');},[]);
  const signature=eventDraftSignature(form,dates)+JSON.stringify(photo);
  const initial=useRef({form,signature});
  const dirty=signature!==initial.current.signature;
  const {allowNavigation}=useUnsavedChanges({dirty,busy,title:'Leave this event without saving?',description:'Your event changes have not been saved. Keep editing to finish your listing.',onDiscard});
  useEffect(()=>{onDirtyChange?.(dirty);},[dirty,onDirtyChange]);
  useEffect(()=>{onBusyChange?.(busy);},[busy,onBusyChange]);
  const warning=useRef(null);
  useEffect(()=>{if(error) warning.current?.focus();},[error]);
  const update=event=>{
    const {name,value,type,checked}=event.target;
    const changesLocation=['location_address','latitude','longitude'].includes(name);
    if(changesLocation) {setLocationConfirmed(false);setLocationError('');}
    setForm(old=>({...old,[name]:type==='checkbox'?checked:value,...(changesLocation?{place_id:null}:{}),
      ...(name==='submission_role'?{organizer_confirmed:false}:{})}));
  };
  function updateDate(key,name,value) {
    setDateErrors(old=>({...old,[key]:null}));
    setDates(old=>old.map(row=>row.key===key?{...row,[name]:value}:row));
  }
  function schedule() {
    const invalid={};
    dates.forEach(item=>{try {serializeOccurrences([item]);} catch(failure) {invalid[item.key]=failure instanceof RangeError?'This Toronto time is ambiguous or does not exist during the daylight-saving transition. Choose another time.':failure.message;}});
    setDateErrors(invalid);
    const invalidIndex=dates.findIndex(item=>invalid[item.key]);
    if(invalidIndex>=0) throw new Error(`Check date range ${invalidIndex+1}. ${invalid[dates[invalidIndex].key]}`);
    return serializeOccurrences(dates);
  }
  async function submit(event) {
    event.preventDefault();if(busy||locationBusy) return;setError('');
    if(wizard&&step===0) {
      try {schedule();setStep(1);} catch(failure) {setError(failure.message);}
      return;
    }
    if(wizard&&step===2) {
      if(!photo.url.trim()) {setPreview('');setStep(3);return;}
      setBusy(true);
      try {const result=await post('/event-photo-preview',{...photo,url:photo.url.trim()});setPreview(result.preview);setStep(3);}
      catch(failure) {setError(failure.message);push({type:'warning',title:'Image link was not accepted',message:failure.message});}
      finally {setBusy(false);}
      return;
    }
    const placeError=eventLocationError(form,{existing:initialData.id?initial.current.form:null,confirmed:locationConfirmed});
    setLocationError(placeError);
    if(placeError) {if(wizard) setStep(1);setError(placeError);return;}
    if(wizard&&step===1) {setStep(2);return;}
    let occurrences;
    try {occurrences=schedule();} catch(failure) {if(wizard) setStep(0);setError(failure.message);return;}
    setBusy(true);
    try {
      const payload={title:form.title.trim(),description:form.description.trim(),category:form.category,
        location_address:form.location_address.trim(),latitude:form.latitude===''?null:Number(form.latitude),longitude:form.longitude===''?null:Number(form.longitude),
        status:form.status,version:initialData.version,place_id:form.place_id||null,
        organizer_name:form.organizer_name.trim(),
        ...(!initialData.id?{submission_role:form.submission_role,organizer_confirmed:form.organizer_confirmed}:{})};
      if(wizard&&photo.url.trim()) payload.image={...photo,url:photo.url.trim()};
      if(onSubmitChanges) payload.explanation=form.suggestion_explanation.trim();
      if(!initialData.id||!sameOccurrences(occurrences,serializeOccurrences(editableOccurrences(initialData)))) payload.occurrences=occurrences;
      const saved=onSubmitChanges?await onSubmitChanges(payload):initialData.id?await updateEvent(initialData.id,payload):await createEvent(payload);allowNavigation(()=>onSaved(saved));
    } catch(failure) {setError(failure.message||'Unable to save this event.');}
    finally {setBusy(false);}
  }
  const field=(name,label,type='text',extra={})=><label className="form-field" htmlFor={`event-${name}`}>
    <span>{label}</span><input id={`event-${name}`} name={name} value={form[name]} onChange={update} type={type} className="input input-bordered w-full" disabled={busy} {...extra}/></label>;
  const locationChanged=!initialData.id||!sameLocation(form,initial.current.form);
  return <form ref={formElement} onSubmit={submit} className={`event-form ${wizard?'event-wizard':''}`} aria-busy={busy}>
    {wizard&&<><ol className="event-steps" aria-label="Create event steps">{STEPS.map((title,index)=><li key={title} aria-current={step===index?'step':undefined} data-complete={index<step}>
      <button type="button" disabled={busy||index>step} onClick={()=>{setStep(index);setError('');}}><span>{index+1}</span>{title}</button></li>)}</ol>
      <h2 ref={stepHeading} tabIndex={-1} className="wizard-step-title">{STEPS[step]}</h2></>}
    {error&&<p ref={warning} tabIndex={-1} role="alert" className="form-error">{error}</p>}
    {(!wizard||step===0)&&<>
    {!initialData.id&&<fieldset className="form-section" disabled={busy}><legend>Your connection to this event</legend>
      <div className="event-publisher-options">
        {[
          ['organizer',"I'm an organizer",'I organize this event or represent the organizer.'],
          ['reporter',"I'm sharing an event",'I am a reporter or visitor sharing an event I found.'],
        ].map(([value,title,description])=><label key={value} className="event-publisher-option" data-selected={form.submission_role===value}>
          <input type="radio" className="radio radio-primary radio-sm" name="submission_role" value={value} checked={form.submission_role===value} onChange={update} required/>
          <span><strong>{title}</strong><span>{description}</span></span>
        </label>)}
      </div>
      {form.submission_role==='organizer'&&<div className="event-organizer-confirmation">
        <label><input type="checkbox" className="checkbox checkbox-primary checkbox-sm" name="organizer_confirmed" checked={form.organizer_confirmed} onChange={update} required aria-describedby="event-organizer-help"/>
          <span>I confirm that I am the organizer or am authorized to publish this event on the organizer’s behalf.</span></label>
        <p id="event-organizer-help" className="form-help">This is your declaration. It does not mean the platform has verified your identity.</p>
      </div>}
    </fieldset>}
    <fieldset className="form-section" disabled={busy}><legend>About the event</legend>
      {field('title','Event title','text',{required:true,maxLength:255})}
      <label className="form-field" htmlFor="event-category"><span>Category</span><select id="event-category" name="category" value={form.category} onChange={update} className="select select-bordered w-full">{CATEGORIES.map(value=><option key={value}>{value}</option>)}</select></label>
      <label className="form-field" htmlFor="event-description"><span>Description</span><textarea id="event-description" name="description" value={form.description} onChange={update} required maxLength={20000} rows={4} className="textarea textarea-bordered w-full" placeholder="What can visitors look forward to?"/></label>
      {field('organizer_name','Organizer (optional)','text',{maxLength:255,placeholder:'Organization or person running the event'})}
      {initialData.id&&!onSubmitChanges&&<label className="form-field" htmlFor="event-status"><span>Event status</span><select id="event-status" name="status" value={form.status} onChange={update} className="select select-bordered w-full"><option value="scheduled">Scheduled</option><option value="cancelled">Cancelled</option></select></label>}
    </fieldset>
    </>}
    {(!wizard||step===1)&&
    <fieldset className="form-section" disabled={busy} aria-label={wizard?'Event location':undefined}>{!wizard&&<legend>Where</legend>}
      <EventLocationPicker value={form} onChange={setForm} confirmed={locationConfirmed} onConfirm={confirmLocation} onBusyChange={setLocationBusy} error={locationError} mapsReady={mapsReady} required={locationChanged} disabled={busy}/>
    </fieldset>}
    {(!wizard||step===0)&&
    <fieldset className="form-section" disabled={busy}><legend>When <span>· Toronto time</span></legend>
      <p className="form-help">Each date range is a separate occurrence. Leave the end blank if it is unknown.</p>
      <div className="date-ranges">{dates.map((item,index)=><div key={item.key} className="date-range">
        <div className="date-range-heading"><span>Date range {index+1}</span><button type="button" className="btn btn-ghost btn-sm" disabled={dates.length===1} aria-label={`Remove occurrence ${index+1}`} onClick={()=>setDates(old=>old.filter(row=>row.key!==item.key))}>Remove</button></div>
        <div className="form-grid">{['starts_at','ends_at'].map(name=><label key={name} className="form-field"><span>{name==='starts_at'?'Start':'End (optional)'}</span><input type="datetime-local" className="input input-bordered w-full" aria-label={`Occurrence ${index+1} ${name==='starts_at'?'start':'end'}`} aria-invalid={!!dateErrors[item.key]} aria-describedby={dateErrors[item.key]?`date-error-${item.key}`:undefined} required={name==='starts_at'} value={item[name]} onChange={event=>updateDate(item.key,name,event.target.value)}/></label>)}</div>
        {dateErrors[item.key]&&<p id={`date-error-${item.key}`} className="text-sm text-error mt-3">{dateErrors[item.key]}</p>}
      </div>)}</div>
      <button type="button" className="btn btn-outline self-start" disabled={dates.length>=366} onClick={()=>setDates(old=>[...old,{key:crypto.randomUUID(),starts_at:'',ends_at:''}])}><Icon name="plus" size={16}/> Add another date range</button>
    </fieldset>}
    {wizard&&step===2&&<fieldset className="form-section" disabled={busy}>
      <p className="form-help">Add a direct HTTPS image link, or leave this step blank. Supported hosts: Toronto, Unsplash, Imgur, Cloudinary and Pexels. We check the image before publishing.</p>
      {[['url','Image URL','url',4000],['alt','Describe the image','text',500],['credit','Photographer or image credit','text',300]].map(([name,label,type,maxLength])=><label className="form-field" key={name}><span>{label}{name==='url'?' (optional)':''}</span><input type={type} className="input input-bordered w-full" value={photo[name]} maxLength={maxLength} onChange={event=>{setPhoto(old=>({...old,[name]:event.target.value}));setPreview('');setError('');}}/></label>)}
      <p className="form-help">Still JPEG, PNG, WebP or AVIF · Up to 8 MB and 12 million pixels. The link stays here if it is rejected.</p>
    </fieldset>}
    {wizard&&step===3&&<section className="event-publish-preview" aria-label="Event preview">
      {preview&&<img src={preview} alt={photo.alt||form.title} className="publish-photo-preview"/>}
      <span className="category-label">{form.category}</span><h3>{form.title}</h3>
      <dl><div><dt>Published as</dt><dd>{form.submission_role==='organizer'?'Organizer':'Community reporter'}</dd></div>
        {form.organizer_name&&<div><dt>Organizer</dt><dd>{form.organizer_name}</dd></div>}<div><dt>Location</dt><dd>{form.location_address}</dd></div>
        <div><dt>Dates · Toronto time</dt><dd>{serializeOccurrences(dates).map(item=><p key={item.key}>{occurrenceTime(item)}</p>)}</dd></div></dl>
      <p className="event-description">{form.description}</p><p className="form-help">Your first event needs approval before it becomes public. You can track its status and the review result in My events.</p>
    </section>}
    {onSubmitChanges&&<label className="form-field"><span>What changed, and how did you confirm it?</span><textarea className="textarea textarea-bordered w-full" name="suggestion_explanation" required maxLength={2000} rows={3} value={form.suggestion_explanation} disabled={busy} onChange={update} placeholder="Describe your correction and include a source link when possible."/></label>}
    {!wizard&&!onSubmitChanges&&<section className="form-photo-note"><Icon name="photo" size={24}/><div><h3>Event photo</h3><p>Use Manage event to add or update a photo link after saving.</p></div></section>}
    <div className="form-actions">
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
      {wizard&&step>0&&<button type="button" className="btn btn-outline" disabled={busy} onClick={()=>{setStep(old=>old-1);setError('');}}>Back</button>}
      <button className="btn btn-primary" disabled={busy||locationBusy}>{locationBusy?'Finding address…':busy?(wizard&&step===2?'Checking photo…':'Saving…'):wizard&&step<3?'Continue':onSubmitChanges?'Submit for review':initialData.id?'Save changes':'Submit event'}</button>
    </div>
  </form>;
}
