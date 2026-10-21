import {useEffect,useId,useRef} from 'react';
export default function Modal({title,children,onClose,className='',closeLabel='Close window',description}) {
  const dialog=useRef(null),heading=useRef(null),body=useRef(null),label=useId();
  useEffect(()=>{
    const previous=document.activeElement;const node=dialog.current;
    const viewport=window.visualViewport;
    const resize=()=>{
      node.style.setProperty('--dialog-height',`${viewport?.height||window.innerHeight}px`);
      node.style.setProperty('--dialog-top',`${viewport?.offsetTop||0}px`);
    };
    resize();viewport?.addEventListener('resize',resize);viewport?.addEventListener('scroll',resize);
    node.showModal();heading.current?.focus({preventScroll:true});
    return()=>{viewport?.removeEventListener('resize',resize);viewport?.removeEventListener('scroll',resize);node.close();if(previous?.isConnected) previous.focus({preventScroll:true});};
  },[]);
  useEffect(()=>{body.current?.scrollTo({top:0});heading.current?.focus({preventScroll:true});},[title]);
  function trapFocus(event) {
    if(event.key!=='Tab') return;
    const targets=[...dialog.current.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex="-1"])')]
      .filter(node=>!node.matches(':disabled') && node.getClientRects().length>0 && node.tabIndex>=0);
    const first=targets[0],last=targets.at(-1),current=document.activeElement;
    if(event.shiftKey && (current===first || current===heading.current) || !event.shiftKey && current===last) {
      event.preventDefault();(event.shiftKey?last:first)?.focus();
    }
  }
  return <dialog ref={dialog} className="app-dialog" aria-modal="true" aria-labelledby={label} aria-describedby={description?`${label}-description`:undefined} onKeyDown={trapFocus} onCancel={event=>{event.preventDefault();onClose();}}>
    <section className={`app-dialog-panel ${className}`}>
      <header className="app-dialog-header"><h2 ref={heading} tabIndex={-1} id={label} className="text-xl font-semibold outline-none">{title}</h2>
        <button type="button" className="btn btn-circle btn-ghost" aria-label={closeLabel} onClick={onClose}>✕</button></header>
      <div ref={body} className="app-dialog-body">{description && <p id={`${label}-description`} className="dialog-description">{description}</p>}{children}</div>
    </section>
  </dialog>;
}
