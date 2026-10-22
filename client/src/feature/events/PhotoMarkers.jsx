import {useEffect} from 'react';
import {MarkerClusterer,SuperClusterAlgorithm} from '@googlemaps/markerclusterer';
import {eventImage,representative} from '../../utils/event';
function content(event,count,photos,selected=false) {
  const element=document.createElement('div');element.className=photos?'photo-pin':'count-pin';
  if(selected) element.classList.add('is-selected');
  if(photos) {
    const image=eventImage(event,'thumb');
    if(image) {const img=document.createElement('img');img.loading='lazy';img.src=image.url;img.alt='';img.width=48;img.height=48;img.decoding='async';img.referrerPolicy='no-referrer';
      img.onerror=()=>{img.remove();element.classList.add('photo-pin-fallback');element.prepend(document.createTextNode('✦'));};element.append(img);}
    else {element.classList.add('photo-pin-fallback');element.append(document.createTextNode('✦'));}
    if(count>1) {const badge=document.createElement('span');badge.className='photo-count';badge.textContent=String(count);element.append(badge);}
  } else element.textContent=count>1?String(count):'•';
  return element;
}
export default function PhotoMarkers({map,events,zoom,viewport,onSelect,onCluster,selectedId}) {
  useEffect(()=>{
    if(!map || !window.google?.maps?.marker) return;
    const {AdvancedMarkerElement}=window.google.maps.marker;
    const byMarker=new Map(),photos=zoom>=14;
    const isVisible=position=>!viewport || (position.lat>=viewport.south && position.lat<=viewport.north && position.lng>=viewport.west && position.lng<=viewport.east);
    const markers=events.filter(event=>event.position).map(event=>{
      const marker=new AdvancedMarkerElement({position:event.position,content:content(event,1,photos&&isVisible(event.position),String(event.id)===String(selectedId)),title:event.title,gmpClickable:true,zIndex:String(event.id)===String(selectedId)?1000:undefined});
      marker.addEventListener('gmp-click',()=>onSelect(event.id));byMarker.set(marker,event);return marker;
    });
    const clusterer=new MarkerClusterer({map,markers,algorithm:new SuperClusterAlgorithm({radius:70,maxZoom:21}),
      renderer:{render:({count,position,markers:members})=>{
        const grouped=members.map(marker=>byMarker.get(marker)).filter(Boolean);
        const marker=new AdvancedMarkerElement({position,
          content:content(representative(grouped),count,photos&&isVisible({lat:position.lat(),lng:position.lng()}),grouped.some(event=>String(event.id)===String(selectedId))),
          title:`${count} events in this area`,gmpClickable:true,zIndex:100+count});
        marker.addEventListener('gmp-click',()=>onCluster(grouped.map(event=>event.id),{lat:position.lat(),lng:position.lng()}));return marker;
      }},
      // The SDK's AdvancedMarker uses DOM events. Disable the clusterer's older
      // addListener('gmp-click') bridge and handle the accessible marker above.
      onClusterClick:null});
    return()=>{clusterer.clearMarkers();clusterer.setMap(null);for(const marker of markers) marker.map=null;};
  },[map,events,zoom,viewport,onSelect,onCluster,selectedId]);
  return null;
}
