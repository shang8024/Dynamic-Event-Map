import {useEffect,useId,useRef,useState} from 'react';
import {get} from '../services/apiService';

export default function ReportedBy({event}) {
  const preview=event.contributor_preview||[],count=Number(event.contributor_count)||preview.length;
  const [open,setOpen]=useState(false),[state,setState]=useState({items:[],next:null,loaded:false,busy:false,error:''});
  const root=useRef(null),button=useRef(null),id=useId(),request=useRef(0);
  async function load(after=null) {
    const version=++request.current;setState(old=>({...old,busy:true,error:''}));
    try {
      const result=await get(`/events/${event.id}/contributors${after?`?after=${after}`:''}`);
      if(version===request.current) setState(old=>({items:after?[...old.items,...result.items]:result.items,next:result.next,loaded:true,busy:false,error:''}));
    } catch(failure) {if(version===request.current) setState(old=>({...old,busy:false,error:failure.message}));}
  }
  useEffect(()=>()=>{request.current++;},[]);
  useEffect(()=>{
    if(!open) return;
    const outside=event=>{if(!root.current?.contains(event.target)) setOpen(false);};
    document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
  },[open]);
  function show() {setOpen(true);if(!state.loaded&&!state.busy) void load();}
  function close() {button.current?.focus();setOpen(false);}
  if(count<=3) return <span className="reported-by">Reported by {preview.length?preview.map(user=>user.name).join(', '):event.author_name||'a community member'}</span>;
  return <span ref={root} className="reported-by contributor-disclosure" onMouseEnter={show}
    onMouseLeave={()=>{if(!root.current?.contains(document.activeElement)) setOpen(false);}}
    onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget)) setOpen(false);}}
    onKeyDown={event=>{if(event.key==='Escape'&&open) {event.preventDefault();event.stopPropagation();close();}}}>
    Reported by <button ref={button} type="button" className="contributor-count" onFocus={show} onClick={show} aria-expanded={open} aria-controls={open?id:undefined}>{count} users</button>
    {open&&<span className="contributor-panel" id={id} role="group" aria-label="Event contributors">
      <span className="contributor-panel-heading"><strong>Community reporters</strong><button type="button" className="btn btn-ghost btn-xs" onClick={close} aria-label="Close contributor list">✕</button></span>
      <span className="contributor-names">{(state.items.length?state.items:preview).map(user=><span key={user.id}>{user.name}</span>)}</span>
      {state.busy&&<span role="status">Loading names…</span>}
      {state.error&&<span role="alert">{state.error} <button type="button" className="link" onClick={()=>load(state.next)}>Retry</button></span>}
      {state.next&&<button type="button" className="link" disabled={state.busy} onClick={()=>load(state.next)}>More names</button>}
    </span>}
  </span>;
}
