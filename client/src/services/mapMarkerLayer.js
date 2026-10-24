import {representative} from '../utils/event.js';

// Only changed membership/coordinates invalidate the spatial index. Selection,
// viewport and React callback changes update the existing marker contents.
export function createMapMarkerLayer({map,createMarker,createClusterer,createContent}) {
  const items=new Map(),groups=new Map(),byMarker=new Map();
  let current={events:[],zoom:0,viewport:null},clusters=[],disposed=false;
  function paint() {
    if(disposed) return;
    const active=new Set(clusters.map(cluster=>cluster.marker).filter(Boolean));
    for(const [marker,record] of groups) if(!active.has(marker)) {record.content.dispose?.();groups.delete(marker);}
    const displayed=clusters.map(cluster=>cluster.markers.length===1?items.get(String(byMarker.get(cluster.markers[0])?.id)):groups.get(cluster.marker)).filter(Boolean);
    const bounds=current.viewport,visible=record=>!bounds||(record.position.lat>=bounds.south&&record.position.lat<=bounds.north&&record.position.lng>=bounds.west&&record.position.lng<=bounds.east);
    const center=bounds?{lat:(bounds.north+bounds.south)/2,lng:(bounds.east+bounds.west)/2}:map.getCenter()?.toJSON?.()||{lat:0,lng:0};
    const selected=record=>record.ids.includes(String(current.selectedId));
    const distance=record=>(record.position.lat-center.lat)**2+(record.position.lng-center.lng)**2;
    const budget=map.getDiv().clientWidth<600?24:48;
    const photos=new Set(current.zoom>=14?displayed.filter(visible).sort((a,b)=>Number(selected(b))-Number(selected(a))||distance(a)-distance(b)).slice(0,budget):[]);
    const shown=new Set(displayed);
    for(const record of [...items.values(),...groups.values()]) {
      const events=record.ids.map(id=>items.get(id)?.event).filter(Boolean);
      const event=events.length===1?events[0]:representative(events);
      record.marker.zIndex=selected(record)?1000:record.ids.length>1?100+record.ids.length:undefined;
      record.content.update({event,count:record.ids.length,photos:shown.has(record)&&photos.has(record),selected:selected(record)});
    }
  }
  const clusterer=createClusterer({
    onClusters:value=>{clusters=value;},onRendered:paint,
    render:cluster=>{
      const ids=cluster.markers.map(marker=>String(byMarker.get(marker)?.id)).filter(id=>items.has(id));
      const position={lat:cluster.position.lat(),lng:cluster.position.lng()},content=createContent();
      const marker=createMarker({position,content:content.element,title:`${ids.length} events in this area`,gmpClickable:true});
      marker.addEventListener('gmp-click',()=>current.onCluster?.(ids.map(id=>items.get(id)?.event.id).filter(id=>id!=null),position));
      groups.set(marker,{ids,position,marker,content});return marker;
    },
  });
  return {
    update(next) {
      if(disposed) return;
      current=next;const wanted=new Map(next.events.filter(event=>event.position).map(event=>[String(event.id),event]));
      const removed=[],added=[];
      for(const [id,record] of items) {
        const event=wanted.get(id);
        if(!event || event.position.lat!==record.position.lat || event.position.lng!==record.position.lng) {
          removed.push(record.marker);record.content.dispose?.();byMarker.delete(record.marker);items.delete(id);
        }
      }
      for(const [id,event] of wanted) {
        let record=items.get(id);
        if(!record) {
          const content=createContent(),marker=createMarker({position:event.position,content:content.element,title:event.title,gmpClickable:true});
          record={ids:[id],position:event.position,event,marker,content};items.set(id,record);added.push(marker);
          marker.addEventListener('gmp-click',()=>current.onSelect?.(items.get(id)?.event.id));
        }
        record.event=event;record.marker.title=event.title;byMarker.set(record.marker,event);
      }
      if(removed.length) clusterer.removeMarkers(removed,true);
      if(added.length) clusterer.addMarkers(added,true);
      if(removed.length||added.length) clusterer.render();
      paint();
    },
    dispose() {
      disposed=true;clusterer.dispose?.();clusterer.clearMarkers();clusterer.setMap(null);
      for(const record of [...items.values(),...groups.values()]) {record.content.dispose?.();record.marker.map=null;}
      items.clear();groups.clear();byMarker.clear();clusters=[];
    },
  };
}
