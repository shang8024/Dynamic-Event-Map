import {useRef,useState} from 'react';
import {put,del} from '../services/apiService';
import {useNotifications} from '../contexts/NotificationContext';
export default function EventImageEditor({event,onSaved}) {
  const initial=event.data?.image||event.data?.imported_image||{};
  const [url,setURL]=useState(initial.url||''),[alt,setAlt]=useState(initial.alt||event.title),[credit,setCredit]=useState(initial.credit||'');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const {push}=useNotifications(),warning=useRef(null);
  function rejected(message) {
    setError(message);
    push({type:'warning',title:'Image link was not saved',message,autoCloseMs:10000});
    requestAnimationFrame(()=>warning.current?.focus());
  }
  async function save(e) {
    e.preventDefault();setBusy(true);setError('');
    try {onSaved(await put(`/events/${event.id}/image`,{url,alt,credit}));}
    catch(failure) {rejected(failure.message||'The image link could not be checked. Your photo has not been changed. Please try again.');}
    finally {setBusy(false);}
  }
  async function remove() {
    setBusy(true);setError('');try {onSaved(await del(`/events/${event.id}/image`));setURL('');}
    catch(failure) {setError(failure.message||'Unable to remove this photo');} finally {setBusy(false);}
  }
  return <details className="rounded-xl border border-base-300 p-3">
    <summary className="cursor-pointer font-medium py-1">Manage event photo</summary>
    <form onSubmit={save} className="mt-4 space-y-3">
      <p className="text-sm text-base-content/75">Use a direct HTTPS image link from Toronto, Unsplash, Imgur, Cloudinary or Pexels. The image is checked before publication.</p>
      {error && <div id="photo-error" ref={warning} tabIndex={-1} role="alert" className="rounded-lg border border-warning bg-warning/15 p-3 text-sm"><strong className="block mb-1">Image link was not saved</strong>{error}</div>}
      <label className="form-field" htmlFor="photo-url"><span>Image URL</span><input id="photo-url" type="url" required value={url} maxLength={4000} onChange={e=>{setURL(e.target.value);setError('');}} aria-invalid={!!error} aria-describedby={error?'photo-error':'photo-help'} className="input input-bordered w-full" disabled={busy}/></label>
      <p id="photo-help" className="text-xs text-base-content/75">Still JPEG, PNG, WebP or AVIF · Up to 8 MB and 12 million pixels. A rejected link leaves the current photo unchanged.</p>
      <label className="form-field" htmlFor="photo-alt"><span>Describe the image</span><input id="photo-alt" value={alt} maxLength={500} onChange={e=>setAlt(e.target.value)} className="input input-bordered w-full" disabled={busy}/></label>
      <label className="form-field" htmlFor="photo-credit"><span>Photographer or image credit</span><input id="photo-credit" value={credit} maxLength={300} onChange={e=>setCredit(e.target.value)} className="input input-bordered w-full" disabled={busy}/></label>
      <div className="flex flex-wrap gap-2"><button className="btn btn-primary btn-sm" disabled={busy}>{busy?'Checking image…':'Save image link'}</button><button type="button" onClick={remove} className="btn btn-ghost btn-sm" disabled={busy}>Remove photo</button></div>
    </form>
  </details>;
}
