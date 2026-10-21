import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {useBlocker} from 'react-router-dom';
import Modal from '../components/Modal';
import UnsavedChangesContext from './UnsavedChangesContext';
import {blocksUnsavedNavigation,pendingUnsavedChanges} from '../utils/unsavedChanges';

export default function UnsavedChangesProvider({children}) {
  const [guards,setGuards]=useState(new Map());
  const bypass=useRef(new Set());
  const register=useCallback((id,guard)=>setGuards(old=>{
    const previous=old.get(id);
    if(previous&&Object.keys(guard).every(key=>previous[key]===guard[key])) return old;
    return new Map(old).set(id,guard);
  }),[]);
  const unregister=useCallback(id=>setGuards(old=>{
    if(!old.has(id)) return old;
    const next=new Map(old);next.delete(id);return next;
  }),[]);
  const allowNavigation=useCallback((id,callback)=>{
    bypass.current.add(id);
    try {return callback();}
    finally {queueMicrotask(()=>bypass.current.delete(id));}
  },[]);
  const shouldBlock=useCallback(({currentLocation,nextLocation})=>blocksUnsavedNavigation(guards,currentLocation,nextLocation,bypass.current),[guards]);
  const blocker=useBlocker(shouldBlock);
  const pending=pendingUnsavedChanges(guards),busy=pending.some(guard=>guard.busy);
  const hasPending=pending.length>0;
  useEffect(()=>{
    if(!hasPending) return;
    const beforeUnload=event=>{event.preventDefault();event.returnValue='';};
    window.addEventListener('beforeunload',beforeUnload);
    return()=>window.removeEventListener('beforeunload',beforeUnload);
  },[hasPending]);
  useEffect(()=>{
    if(blocker.state==='blocked'&&!hasPending) blocker.proceed();
  },[blocker,hasPending]);
  function discardAndLeave() {
    pending.forEach(guard=>guard.onDiscard?.());
    blocker.proceed();
  }
  const context=useMemo(()=>({register,unregister,allowNavigation}),[register,unregister,allowNavigation]);
  return <UnsavedChangesContext.Provider value={context}>{children}
    {blocker.state==='blocked'&&<Modal title={busy?'Please wait for saving to finish':pending.length===1?pending[0].title:'Leave without saving?'} onClose={()=>blocker.reset()}>
      <p className="text-sm">{busy?'Your changes are still being saved. Stay on this page until the request finishes.':pending.length===1?pending[0].description:'You have unsaved changes. Stay on this page to keep editing, or leave without saving them.'}</p>
      <div className="mt-5 flex flex-wrap justify-end gap-3">
        <button type="button" className="btn btn-primary" onClick={()=>blocker.reset()}>{busy?'Stay on this page':'Keep editing'}</button>
        {!busy&&<button type="button" className="btn btn-outline text-error" onClick={discardAndLeave}>Leave without saving</button>}
      </div>
    </Modal>}
  </UnsavedChangesContext.Provider>;
}
