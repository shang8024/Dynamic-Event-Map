import {useEffect,useRef,useState} from 'react';
import {imageLoader} from '../services/imageLoader';
const tones={'Arts & Culture':['#e8d9f2','#795395','✦'],'Entertainment & Leisure':['#ffdfc5','#a94d25','♪'],
  'Food & Drink':['#fde5ae','#92601c','◒'],'Sports & Fitness':['#d4eedb','#2c7851','◉'],
  'Family & Kids':['#ffd9dd','#a04f66','✿'],'Education & Workshops':['#d5e9f5','#376c91','▧'],
  'Community & Social':['#dcdfef','#626794','◎']};
export default function EventArtwork({src,title,category,className='',alt,loading='lazy',onUnavailable}) {
  const host=useRef(null),unavailable=useRef(onUnavailable),[result,setResult]=useState(null);
  useEffect(()=>{unavailable.current=onUnavailable;},[onUnavailable]);
  useEffect(()=>{
    if(!src)return;
    let release=null,alive=true;
    const start=()=>{if(release)return;release=imageLoader.subscribe(src,{priority:loading==='eager'?10:1,
      onReady:url=>{if(alive)setResult({src,url});},onError:()=>{if(alive){setResult({src,failed:true});unavailable.current?.();}}});};
    if(loading==='eager'||typeof IntersectionObserver==='undefined')start();
    const observer=loading!=='eager'&&typeof IntersectionObserver!=='undefined'?new IntersectionObserver(entries=>{
      if(entries.some(e=>e.isIntersecting))start();else {release?.();release=null;}
    },{rootMargin:'160px'}):null;
    if(observer&&host.current)observer.observe(host.current);
    return()=>{alive=false;observer?.disconnect();release?.();};
  },[src,loading]);
  const [background,color,symbol]=tones[category]||['#eee4d6','#8a6b49','✦'];
  const url=result?.src===src?result?.url:null,decorative=alt==='';
  return <div ref={host} className={`${className} event-artwork`} style={{background,color}}>
    {url?<img src={url} alt={alt??title??'Event photo'} decoding="async" className="event-artwork-image"/>
      :<div className="event-template" role={decorative?undefined:'img'} aria-label={decorative?undefined:`${category||'Event'} illustration`} aria-hidden={decorative||undefined}>
        <span aria-hidden="true">{symbol}</span><small aria-hidden="true">{src&&!result?.failed?'Loading photo…':category||'Discover something new'}</small>
      </div>}
  </div>;
}
