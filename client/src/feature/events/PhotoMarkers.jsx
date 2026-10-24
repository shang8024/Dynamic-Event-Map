import {useEffect,useRef} from 'react';
import {MarkerClusterer,SuperClusterAlgorithm} from '@googlemaps/markerclusterer';
import {eventImage} from '../../utils/event';
import {createMapMarkerLayer} from '../../services/mapMarkerLayer';

function createContent() {
  const element=document.createElement('div');
  let signature='',image=null,source='';
  return {element,update({event,count,photos,selected}) {
    const photo=photos?eventImage(event,'thumb'):null;
    const next=[photo?.url,photos,count,selected].join(':');
    if(signature===next) return;signature=next;
    element.className=(photos?'photo-pin':'count-pin')+(selected?' is-selected':'');
    if(source!==photo?.url) {image?.remove();image=null;source=photo?.url;}
    element.replaceChildren();
    if(photos) {
      element.classList.add('photo-pin-fallback');
      if(!photo) element.append(document.createTextNode('✦'));
      else {
        if(!image) {
          image=document.createElement('img');image.alt='';image.width=48;image.height=48;image.decoding='async';image.referrerPolicy='no-referrer';
          image.onerror=()=>{image?.remove();element.append(document.createTextNode('✦'));};
          image.src=photo.url;
        }
        element.append(image);
      }
      if(count>1) {const badge=document.createElement('span');badge.className='photo-count';badge.textContent=String(count);element.append(badge);}
    } else element.textContent=count>1?String(count):'•';
  }};
}

export default function PhotoMarkers(props) {
  const layer=useRef(null),{map}=props;
  useEffect(()=>{
    if(!map||!window.google?.maps?.marker) return;
    layer.current=createMapMarkerLayer({map,createContent,
      createMarker:options=>new window.google.maps.marker.AdvancedMarkerElement(options),
      createClusterer:({render,onClusters,onRendered})=>{
        const base=new SuperClusterAlgorithm({radius:70,maxZoom:21});
        const instance=new MarkerClusterer({map,markers:[],onClusterClick:null,renderer:{render},
          algorithm:{calculate(input){const result=base.calculate(input);onClusters(result.clusters);return result;}}});
        const listener=instance.addListener('clusteringend',onRendered);
        instance.dispose=()=>listener.remove();return instance;
      },
    });
    return()=>{layer.current?.dispose();layer.current=null;};
  },[map]);
  useEffect(()=>{layer.current?.update(props);},[props]);
  return null;
}
