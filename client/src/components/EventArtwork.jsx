import {useState} from 'react';
const tones={'Arts & Culture':['#e8d9f2','#795395','✦'],'Entertainment & Leisure':['#ffdfc5','#a94d25','♪'],
  'Food & Drink':['#fde5ae','#92601c','◒'],'Sports & Fitness':['#d4eedb','#2c7851','◉'],
  'Family & Kids':['#ffd9dd','#a04f66','✿'],'Education & Workshops':['#d5e9f5','#376c91','▧'],
  'Community & Social':['#dcdfef','#626794','◎']};
export default function EventArtwork({src,title,category,className='',alt,loading='lazy',onUnavailable}) {
  const [failed,setFailed]=useState(null);
  if(src && failed!==src) return <img src={src} alt={alt||title||'Event photo'} loading={loading} decoding="async" referrerPolicy="no-referrer"
    className={`${className} object-cover`} onError={()=>{setFailed(src);onUnavailable?.();}}/>;
  const [background,color,symbol]=tones[category]||['#eee4d6','#8a6b49','✦'];
  return <div className={`${className} event-template`} style={{background,color}} role="img" aria-label={`${category||'Event'} illustration`}>
    <span aria-hidden="true">{symbol}</span><small aria-hidden="true">{category||'Discover something new'}</small>
  </div>;
}
