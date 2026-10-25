import {NavLink,useLocation} from 'react-router-dom';
import {useEffect,useRef} from 'react';
const links=[['/bookmarks','Saved events'],['/recommendations','For you'],['/comments','My comments'],['/notifications','Notifications'],['/contributions','Contributions'],['/settings','Settings']];
const labels={'/bookmarks':'Your saved plans','/recommendations':'Picked for you','/comments':'Your conversations','/notifications':'Updates & activity','/contributions':'Community contributions','/settings':'Your preferences','/my-events':'Your events'};
export default function PageLayout({title,intro,actions,eyebrow,narrow=false,children}) {
  const heading=useRef(null),{pathname}=useLocation();
  useEffect(()=>{heading.current?.focus({preventScroll:true});},[title]);
  return <main className={`personal-page ${narrow?'page-narrow':''}`}>
    <nav className="account-nav" aria-label="Account pages">{links.map(([path,label])=><NavLink key={path} to={path}>{label}</NavLink>)}</nav>
    <header className="page-heading"><p className="eyebrow">{eyebrow||labels[pathname]||'Your account'}</p><div className="page-title-row"><h1 ref={heading} tabIndex={-1}>{title}</h1>{actions&&<div className="page-heading-actions">{actions}</div>}</div>{intro&&<p className="page-intro">{intro}</p>}</header>
    <div className="page-body">{children}</div>
  </main>;
}
