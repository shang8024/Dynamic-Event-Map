import {createContext,useCallback,useContext} from 'react';
import {useLocation,useNavigate} from 'react-router-dom';
import {useAuth} from './AuthContext';
import {authPath,safeReturnTo,authIntent} from '../services/authNavigation';

const AuthFlowContext=createContext(null);
export function AuthFlowProvider({children}) {
  const {user}=useAuth(),location=useLocation(),navigate=useNavigate();
  const requestAuth=useCallback((reason='',returnTo=location.pathname+location.search,intent=null)=>{
    const destination=safeReturnTo(returnTo);
    const pending=authIntent(intent,destination);
    navigate(user?destination:authPath('signin',reason,destination),{state:user?{authIntent:pending}:{intent:pending}});
  },[user,location.pathname,location.search,navigate]);
  return <AuthFlowContext.Provider value={requestAuth}>{children}</AuthFlowContext.Provider>;
}
// eslint-disable-next-line react-refresh/only-export-components
export function useAuthFlow() {
  const value=useContext(AuthFlowContext);
  if(!value) throw new Error('useAuthFlow must be used within AuthFlowProvider');
  return value;
}
