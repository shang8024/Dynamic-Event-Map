import {NavLink} from 'react-router-dom';
import {useEffect,useRef} from 'react';
const links=[['/bookmarks','Saved events'],['/recommendations','For you'],['/comments','My comments'],['/notifications','Notifications'],['/contributions','Contributions'],['/settings','Settings']];
export default function PageLayout({title,intro,actions,narrow=false,children}) {
  const heading=useRef(null);
  useEffect(()=>{heading.current?.focus({preventScroll:true});},[title]);
  return <main className={`personal-page ${narrow?'page-narrow':''}`}>
    <nav className="account-nav" aria-label="Your space">{links.map(([path,label])=><NavLink key={path} to={path}>{label}</NavLink>)}</nav>
    <header className="page-heading"><div><p className="eyebrow">Your space</p><h1 ref={heading} tabIndex={-1}>{title}</h1>{intro&&<p className="page-intro">{intro}</p>}</div>{actions&&<div className="page-heading-actions">{actions}</div>}</header>
    <div className="page-body">{children}</div>
  </main>;
}
