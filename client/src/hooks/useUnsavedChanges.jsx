import {useCallback,useContext,useEffect,useId} from 'react';
import UnsavedChangesContext from '../contexts/UnsavedChangesContext';

export default function useUnsavedChanges({dirty,busy=false,title='Leave without saving?',description='Your changes have not been saved. Stay on this page to keep editing.',onDiscard}) {
  const context=useContext(UnsavedChangesContext),id=useId();
  if(!context) throw new Error('useUnsavedChanges requires UnsavedChangesProvider');
  const {register,unregister,allowNavigation:allow}=context;
  useEffect(()=>{
    register(id,{dirty,busy,title,description,onDiscard});
  },[id,dirty,busy,title,description,onDiscard,register]);
  useEffect(()=>()=>unregister(id),[id,unregister]);
  const allowNavigation=useCallback(callback=>allow(id,callback),[allow,id]);
  return {leavePrompt:null,allowNavigation};
}
