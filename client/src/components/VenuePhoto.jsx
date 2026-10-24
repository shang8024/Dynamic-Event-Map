import {useEffect,useRef,useState} from 'react';
import {loadVenuePhoto} from '../services/venuePhoto';
import EventArtwork from './EventArtwork';
import useGoogleMaps from '../hooks/useGoogleMaps';
export default function VenuePhoto({event}) {
  const {isLoaded,loadError}=useGoogleMaps();
  const [photo,setPhoto]=useState(null),[pending,setPending]=useState(true);
  const request=useRef(null);
  useEffect(()=>{
    if(!isLoaded) {if(loadError)setPending(false);return;}
    let active=true;
    request.current??=(async()=>{
      let timer;
      try {return await Promise.race([(async()=>{
        const places=await window.google.maps.importLibrary('places');return loadVenuePhoto(event,places);
      })(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Venue photo timed out')),10000);})]);}
      finally {clearTimeout(timer);}
    })();
    request.current.then(value=>{if(active) setPhoto(value);}).catch(()=>{}).finally(()=>{if(active) setPending(false);});
    return()=>{active=false;};
  },[event,isLoaded,loadError]);
  if(pending) return <div className="h-full w-full bg-base-200 flex items-center justify-center" role="status"><span className="loading loading-spinner mr-2"/>Checking venue photo…</div>;
  if(!photo) return <EventArtwork title={event.title} category={event.category} className="h-full w-full"/>;
  return <figure className="relative h-full w-full"><img src={photo.url} alt={`Venue photograph for ${event.location_name||event.title}`} className="h-full w-full object-cover" referrerPolicy="strict-origin-when-cross-origin" onError={()=>setPhoto(null)}/>
    <figcaption className="absolute inset-x-0 bottom-0 bg-black/80 px-3 py-2 text-xs text-white">Venue photo · Google Maps {photo.authors.map((author,index)=><span key={index}> · {author.uri?.startsWith('https://')?<a href={author.uri} target="_blank" rel="noopener noreferrer" className="underline">{author.displayName}</a>:author.displayName}</span>)}</figcaption></figure>;
}
