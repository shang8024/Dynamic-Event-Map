import Icon from './Icon';
import {useEffect,useId,useRef,useState} from 'react';
export default function Modal({title,children,onClose,className='',closeLabel='Close window',description,dirty=false,busy=false}) {
  const dialog=useRef(null),heading=useRef(null),body=useRef(null),label=useId();
  const [confirming,setConfirming]=useState(false),[waiting,setWaiting]=useState(false);
  const continueButton=useRef(null),closeTrigger=useRef(null);
  useEffect(()=>{
    const previous=document.activeElement;const node=dialog.current;
    const viewport=window.visualViewport;
    const resize=()=>{
      node.style.setProperty('--dialog-height',`${viewport?.height||window.innerHeight}px`);
      node.style.setProperty('--dialog-top',`${viewport?.offsetTop||0}px`);
    };
    resize();viewport?.addEventListener('resize',resize);viewport?.addEventListener('scroll',resize);
    node.showModal();heading.current?.focus({preventScroll:true});
    return()=>{viewport?.removeEventListener('resize',resize);viewport?.removeEventListener('scroll',resize);node.close();
      const target=previous?.isConnected?previous:document.querySelector('#main-content h1')||document.getElementById('main-content');target?.focus({preventScroll:true});};
  },[]);
  useEffect(()=>{body.current?.scrollTo({top:0});heading.current?.focus({preventScroll:true});},[title]);
  useEffect(()=>{if(confirming) continueButton.current?.focus();},[confirming]);
  useEffect(()=>{if(!busy) setWaiting(false);},[busy]);
  function requestClose() {
    if(busy) {setWaiting(true);return;}
    if(dirty) {closeTrigger.current=document.activeElement;setConfirming(true);return;}
    onClose();
  }
  function continueEditing() {
    setConfirming(false);
    requestAnimationFrame(()=>{const target=closeTrigger.current; (target?.isConnected?target:heading.current)?.focus({preventScroll:true});});
  }
  function trapFocus(event) {
    // Escape belongs to the top dialog, never the event panel behind it.
    if(event.key==='Escape') {event.stopPropagation();return;}
    if(event.key!=='Tab') return;
    const targets=[...dialog.current.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])')]
      .filter(node=>!node.matches(':disabled') && node.getClientRects().length>0 && node.tabIndex>=0);
    const first=targets[0],last=targets.at(-1),current=document.activeElement;
    if(event.shiftKey && (current===first || current===heading.current) || !event.shiftKey && current===last) {
      event.preventDefault();(event.shiftKey?last:first)?.focus();
    }
  }
  return <dialog ref={dialog} className="app-dialog" aria-modal="true" aria-labelledby={label} aria-describedby={!confirming&&description?`${label}-description`:undefined} onKeyDown={trapFocus} onCancel={event=>{event.preventDefault();if(confirming) continueEditing();else requestClose();}}>
    <section className={`app-dialog-panel ${className}`}>
      <header className="app-dialog-header"><h2 ref={heading} tabIndex={-1} id={label} className="text-xl font-semibold outline-none">{confirming?'Discard unsaved changes?':title}</h2>
        <button type="button" className="btn btn-circle btn-ghost" disabled={busy} aria-label={confirming?'Keep editing':closeLabel} onClick={confirming?continueEditing:requestClose}><Icon name="close" size={16}/></button></header>
      <div ref={body} className="app-dialog-body">
        <div hidden={confirming}>{description && <p id={`${label}-description`} className="dialog-description">{description}</p>}{typeof children==='function'?children({requestClose}):children}
          {waiting&&<p role="status" className="mt-3 text-sm">Please wait until saving finishes before closing.</p>}
        </div>
        {confirming&&<section><p>Your changes have not been saved. Keep editing, or discard them and close this window.</p><div className="mt-5 flex flex-wrap justify-end gap-3">
          <button ref={continueButton} type="button" className="btn btn-primary" onClick={continueEditing}>Keep editing</button>
          <button type="button" className="btn btn-outline text-error" onClick={onClose}>Discard changes</button>
        </div></section>}
      </div>
    </section>
  </dialog>;
}
