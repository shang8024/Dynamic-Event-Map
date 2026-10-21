import {createContext,useCallback,useContext,useEffect,useRef,useState} from 'react';
import {useAuth} from './AuthContext';
import AuthDialog from '../components/AuthDialog';
import {createAuthContinuation} from '../services/authContinuation';

const AuthFlowContext=createContext(null);

export function AuthFlowProvider({children}) {
  const {user}=useAuth();
  const [request,setRequest]=useState(null);
  const [continuation]=useState(()=>createAuthContinuation(action=>requestAnimationFrame(action)));
  useEffect(()=>()=>continuation.cancel(),[continuation]);
  const cancel=useCallback(()=>{continuation.cancel();setRequest(null);},[continuation]);
  const requestAuth=useCallback((reason='',action)=>{
    if(user) {action?.();return;}
    continuation.set(action);
    setRequest({reason});
  },[user,continuation]);
  const complete=useCallback(()=>{
    setRequest(null);
    // Close the sign-in dialog and restore focus before the next window opens.
    continuation.complete();
  },[continuation]);
  return <AuthFlowContext.Provider value={requestAuth}>
    {children}
    {request && <AuthDialog reason={request.reason} onClose={cancel} onAuthenticated={complete}/>}
  </AuthFlowContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuthFlow() {
  const value=useContext(AuthFlowContext);
  if(!value) throw new Error('useAuthFlow must be used within AuthFlowProvider');
  return value;
}

// Resume with the current callback, rather than its signed-out closure.
// Cancelling drops the action; unmounting its owner makes it a no-op.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuthAction(action,reason) {
  const requestAuth=useAuthFlow(),latest=useRef(action),active=useRef(true);
  useEffect(()=>{latest.current=action;},[action]);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  return useCallback((...args)=>requestAuth(reason,()=>{
    if(active.current) return latest.current(...args);
  }),[requestAuth,reason]);
}
