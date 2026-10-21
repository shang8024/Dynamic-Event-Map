import {useCallback,useEffect,useRef,useState} from 'react';
import {put,del} from '../services/apiService';
import {useNotifications} from '../contexts/NotificationContext';
import useUnsavedChanges from '../hooks/useUnsavedChanges';

function imageFields(event) {
  const initial=event.data?.image_hidden?{}:event.data?.image||event.data?.imported_image||{};
  return {url:initial.url||'',alt:initial.alt||event.title,credit:initial.credit||''};
}
export default function EventImageEditor({event,onSaved,initiallyOpen=false,onStateChange}) {
  const [form,setForm]=useState(()=>imageFields(event)),[baseline,setBaseline]=useState(()=>imageFields(event));
  const [busy,setBusy]=useState(''),[error,setError]=useState(''),[errorAction,setErrorAction]=useState('save');
  const {push}=useNotifications(),warning=useRef(null),details=useRef(null),urlInput=useRef(null),savedVersion=useRef(Number(event.version||0));
  const dirty=Object.keys(form).some(key=>form[key]!==baseline[key]);
  const discard=useCallback(()=>{setForm({...baseline});setError('');requestAnimationFrame(()=>urlInput.current?.focus());},[baseline]);
  const {allowNavigation}=useUnsavedChanges({dirty,busy:Boolean(busy),title:'Leave this photo edit?',description:'Your image link changes have not been saved. Stay here to keep editing.',onDiscard:discard});
  useEffect(()=>{onStateChange?.({dirty,busy:Boolean(busy)});},[dirty,busy,onStateChange]);
  useEffect(()=>()=>onStateChange?.({dirty:false,busy:false}),[onStateChange]);
  useEffect(()=>{
    if(!initiallyOpen) return;
    details.current.open=true;
    urlInput.current?.focus();
  },[initiallyOpen]);
  useEffect(()=>{
    if(dirty||busy||Number(event.version||0)<savedVersion.current) return;
    const next=imageFields(event);
    if(Object.keys(next).some(key=>next[key]!==baseline[key])) {setForm(next);setBaseline(next);}
  },[event,dirty,busy,baseline]);
  function rejected(message,action) {
    setError(message);setErrorAction(action);
    push({type:'warning',title:action==='remove'?'Photo was not removed':'Image link was not saved',message,autoCloseMs:10000});
    requestAnimationFrame(()=>warning.current?.focus());
  }
  function saved(row) {
    savedVersion.current=Number(row.version||0);
    const next=imageFields(row);setForm(next);setBaseline(next);
    allowNavigation(()=>onSaved(row));
  }
  async function save(e) {
    e.preventDefault();if(busy) return;setBusy('save');setError('');
    try {saved(await put(`/events/${event.id}/image`,form));}
    catch(failure) {rejected(failure.message||'The image link could not be checked. Your photo has not been changed. Please try again.','save');}
    finally {setBusy('');}
  }
  async function remove() {
    if(busy) return;setBusy('remove');setError('');
    try {saved(await del(`/events/${event.id}/image`));}
    catch(failure) {rejected(failure.message||'Your photo could not be removed. Please try again.','remove');}
    finally {setBusy('');}
  }
  const update=key=>e=>{setForm(old=>({...old,[key]:e.target.value}));setError('');};
  return <details ref={details} className="rounded-xl border border-base-300 p-3">
    <summary className="cursor-pointer font-medium py-1">Manage event photo</summary>
    <form onSubmit={save} className="mt-4 space-y-3" aria-busy={Boolean(busy)}>
      <p className="text-sm text-base-content/75">Use a direct HTTPS image link from Toronto, Unsplash, Imgur, Cloudinary or Pexels. The image is checked before publication.</p>
      {dirty&&<p role="status" className="text-sm muted">You have unsaved photo changes.</p>}
      {error && <div id="photo-error" ref={warning} tabIndex={-1} role="alert" className="rounded-lg border border-warning bg-warning/15 p-3 text-sm"><strong className="block mb-1">{errorAction==='remove'?'Photo was not removed':'Image link was not saved'}</strong>{error}</div>}
      <label className="form-field" htmlFor="photo-url"><span>Image URL</span><input ref={urlInput} id="photo-url" type="url" required value={form.url} maxLength={4000} onChange={update('url')} aria-invalid={!!error&&errorAction==='save'} aria-describedby={error?'photo-error':'photo-help'} className="input input-bordered w-full" disabled={Boolean(busy)}/></label>
      <p id="photo-help" className="text-xs text-base-content/75">Still JPEG, PNG, WebP or AVIF · Up to 8 MB and 12 million pixels. A rejected link leaves the current photo unchanged.</p>
      <label className="form-field" htmlFor="photo-alt"><span>Describe the image</span><input id="photo-alt" value={form.alt} maxLength={500} onChange={update('alt')} className="input input-bordered w-full" disabled={Boolean(busy)}/></label>
      <label className="form-field" htmlFor="photo-credit"><span>Photographer or image credit</span><input id="photo-credit" value={form.credit} maxLength={300} onChange={update('credit')} className="input input-bordered w-full" disabled={Boolean(busy)}/></label>
      <div className="flex flex-wrap gap-2"><button className="btn btn-primary btn-sm" disabled={Boolean(busy)}>{busy==='save'?'Checking and saving…':'Save image link'}</button><button type="button" onClick={remove} className="btn btn-ghost btn-sm" disabled={Boolean(busy)||!baseline.url}>{busy==='remove'?'Removing photo…':'Remove photo'}</button>
        {dirty&&<button type="button" className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={discard}>Discard photo changes</button>}</div>
    </form>
  </details>;
}
