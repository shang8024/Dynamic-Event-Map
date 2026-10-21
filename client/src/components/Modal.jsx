import {useEffect,useId,useRef} from 'react';
export default function Modal({title,children,onClose,className=''}) {
  const dialog=useRef(null),heading=useRef(null),label=useId();
  useEffect(()=>{
    const previous=document.activeElement;const node=dialog.current;
    node.showModal();heading.current?.focus();
    return()=>{node.close();if(previous?.isConnected) previous.focus();};
  },[]);
  return <dialog ref={dialog} className="app-dialog" aria-labelledby={label} onCancel={event=>{event.preventDefault();onClose();}}>
    <section className={`app-dialog-panel ${className}`}>
      <header className="app-dialog-header"><h2 ref={heading} tabIndex={-1} id={label} className="text-xl font-semibold outline-none">{title}</h2>
        <button type="button" className="btn btn-circle btn-ghost" aria-label="Close window" onClick={onClose}>✕</button></header>
      <div className="app-dialog-body">{children}</div>
    </section>
  </dialog>;
}
