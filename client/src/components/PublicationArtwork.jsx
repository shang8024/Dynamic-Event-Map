import {useEffect,useState} from 'react';
import EventArtwork from './EventArtwork';
import PublicationStatus from './PublicationStatus';
import {API_BASE} from '../services/apiService';
import {getVerifiedIdToken} from '../services/authToken';

export default function PublicationArtwork({item,large=false}) {
  const [photo,setPhoto]=useState(null),id=item.id,url=item.draft?.image?.url;
  useEffect(()=>{
    if(!url) return;
    const controller=new AbortController();let objectURL=null;
    (async()=>{
      const token=await getVerifiedIdToken();
      const response=await fetch(`${API_BASE}/event-publications/${id}/image?size=${large?'detail':'thumb'}`,{
        headers:{Authorization:`Bearer ${token}`},credentials:'omit',cache:'no-store',signal:controller.signal});
      if(!response.ok) return;
      const blob=await response.blob();if(controller.signal.aborted) return;
      objectURL=URL.createObjectURL(blob);setPhoto({id,url,large,src:objectURL});
    })().catch(()=>{});
    return()=>{controller.abort();if(objectURL) URL.revokeObjectURL(objectURL);};
  },[id,url,large]);
  const src=photo?.id===id&&photo.url===url&&photo.large===large?photo.src:null;
  return <div className={`publication-artwork ${large?'publication-hero':''}`}>
    {src?<img src={src} alt={item.draft.image.alt||item.draft.title}/>:<EventArtwork title={item.draft?.title} category={item.draft?.category} className="h-full w-full"/>}
    <PublicationStatus status={item.status}/>
  </div>;
}
