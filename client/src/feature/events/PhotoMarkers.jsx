import {useEffect,useRef} from 'react';
import {MarkerClusterer,SuperClusterAlgorithm} from '@googlemaps/markerclusterer';
import {eventImage} from '../../utils/event';
import {createMapMarkerLayer} from '../../services/mapMarkerLayer';
import {imageLoader} from '../../services/imageLoader';

function createContent() {
  const element=document.createElement('div'),image=document.createElement('img'),symbol=document.createElement('span'),badge=document.createElement('span');
  symbol.className='photo-pin-symbol';symbol.textContent='✦';symbol.setAttribute('aria-hidden','true');
  badge.className='photo-count';image.alt='';image.width=48;image.height=48;image.decoding='async';
  let signature='',source=null,release=null;
  return {element,dispose(){release?.();release=null;image.onload=null;image.onerror=null;},update({event,count,photos,selected}) {
    element.classList.toggle('is-selected',selected);
    const photo=photos?eventImage(event,'thumb'):null;
    const next=[photo?.url,photos,count].join(':');
    if(signature===next) return;signature=next;
    element.className=(photos?'photo-pin':'count-pin')+(selected?' is-selected':'');
    element.replaceChildren();
    if(source!==photo?.url) {
      release?.();release=null;source=photo?.url;image.removeAttribute('src');image.classList.remove('is-loaded');
      if(source) {const requested=source;
        release=imageLoader.subscribe(source,{priority:selected?5:0,onReady:url=>{
          if(source!==requested)return;
          image.onload=()=>{if(source===requested&&image.currentSrc===url)image.classList.add('is-loaded');};image.src=url;
        },onError:()=>{if(source===requested)image.classList.remove('is-loaded');}});
      }
    }
    if(photos) {
      element.classList.add('photo-pin-fallback');element.append(symbol);if(photo)element.append(image);
      if(count>1) {badge.textContent=String(count);element.append(badge);}
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
