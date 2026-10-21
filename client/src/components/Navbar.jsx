import {useEffect,useRef,useState} from 'react';
import {Link,NavLink,useLocation} from 'react-router-dom';
import {useAuth} from '../contexts/AuthContext';
import {useAuthFlow} from '../contexts/AuthFlowContext';
import GuestAvatar from '../assets/guest.png';
import {NotificationBell} from './NotificationInbox';
import {authErrorMessage} from '../services/authSession';

export default function Navbar() {
  const {user,account,loading,logout}=useAuth();
  const requestAuth=useAuthFlow(),location=useLocation();
  const menu=useRef(null);
  const authPage=['/signin','/register','/reset-password'].includes(location.pathname);
  const [logoutError,setLogoutError]=useState('');
  const create=()=>requestAuth('create an event','/',{kind:'create'});
  useEffect(()=>{if(menu.current) menu.current.open=false;},[location]);
  useEffect(()=>{
    const outside=event=>{if(menu.current && !menu.current.contains(event.target)) menu.current.open=false;};
    const escape=event=>{if(event.key==='Escape' && menu.current?.open) {menu.current.open=false;menu.current.querySelector('summary')?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[]);
  async function handleLogout() {
    setLogoutError('');
    try {await logout();} catch(error) {setLogoutError(authErrorMessage(error));}
  }
  return <header className="site-header">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <Link to="/" className="brand" aria-label="Dynamic Event Map home">
      <img src="/logo.png" alt="" width="34" height="40"/>
      <span className="brand-name">Dynamic Event Map</span>
    </Link>
    <nav className="primary-nav" aria-label="Main navigation">
      <NavLink to="/" end>Explore</NavLink>
      <NavLink to="/bookmarks">Saved</NavLink>
      <NavLink to="/recommendations">For you</NavLink>
    </nav>
    <div className="header-actions">
      <button className="btn btn-primary create-event-button" onClick={create} disabled={loading}><span aria-hidden="true">＋</span> Create event</button>
      {user && <NotificationBell/>}
      {user?<details ref={menu} className="account-menu">
        <summary aria-label="Account menu"><img src={user.photoURL||GuestAvatar} alt="" width="32" height="32"/></summary>
        <div className="account-menu-panel">
          <div className="account-menu-heading"><strong>{user.displayName||'Your account'}</strong><span>{user.email}</span>{user.role==='admin' && <span className="admin-badge">Administrator</span>}</div>
          <Link to="/bookmarks">Saved events</Link><Link to="/recommendations">For you</Link><Link to="/comments">My comments</Link><Link to="/notifications">Notifications</Link><Link to="/settings">Email & privacy</Link>
          <button onClick={handleLogout}>Sign out</button>
        </div>
      </details>:!authPage&&<button className="btn btn-ghost sign-in-button" disabled={loading} onClick={()=>requestAuth()}>{loading?'Loading…':account?account.emailVerified?'Finish sign-in':'Verify email':'Sign in'}</button>}
    </div>
    {logoutError && <p role="alert" className="header-error">{logoutError}</p>}
  </header>;
}
