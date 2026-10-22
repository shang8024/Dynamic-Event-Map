import {useEffect,useRef,useState} from 'react';
import {Link,NavLink,useLocation} from 'react-router-dom';
import {useAuth} from '../contexts/AuthContext';
import {useAuthFlow} from '../contexts/AuthFlowContext';
import GuestAvatar from '../assets/guest.png';
import {NotificationBell} from './NotificationInbox';
import {authErrorMessage} from '../services/authSession';
import {useTheme} from '../contexts/ThemeContext';
import './Navbar.css';

export default function Navbar() {
  const {user,account,loading,logout}=useAuth();
  const {colorMode,toggleColorMode}=useTheme();
  const themeAction=colorMode==='dark'?'Switch to day mode':'Switch to night mode';
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
  return <div className="site-header-shell">
    <header className="site-header">
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
      <button type="button" className="btn btn-ghost btn-circle theme-toggle" aria-label={themeAction} title={themeAction} onClick={toggleColorMode}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {colorMode==='dark'?<><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/></>:<path d="M20.9 13a9 9 0 0 1-9.9-9.9A9 9 0 1 0 20.9 13Z"/>}
        </svg>
      </button>
      <button className="btn btn-primary create-event-button" onClick={create} disabled={loading}><span aria-hidden="true">＋</span> Create event</button>
      {user && <NotificationBell/>}
      {user?<details ref={menu} className="account-menu">
        <summary aria-label="Account menu"><img src={user.photoURL||GuestAvatar} alt="" width="32" height="32"/></summary>
        <div className="account-menu-panel">
          <div className="account-menu-heading"><strong>{user.displayName||'Your account'}</strong><span>{user.email}</span>{user.role==='admin' && <span className="admin-badge">Administrator</span>}</div>
          <Link to="/bookmarks">Saved events</Link><Link to="/recommendations">For you</Link><Link to="/comments">My comments</Link><Link to="/notifications">Notifications</Link><Link to="/settings">Settings</Link>
          <button onClick={handleLogout}>Sign out</button>
        </div>
      </details>:!authPage&&<button className="btn btn-ghost sign-in-button" disabled={loading} onClick={()=>requestAuth()}>{loading?'Loading…':account?account.emailVerified?'Finish sign-in':'Verify email':'Sign in'}</button>}
    </div>
    {logoutError && <p role="alert" className="header-error">{logoutError}</p>}
  </header></div>;
}
