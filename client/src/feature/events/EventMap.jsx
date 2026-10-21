import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {GoogleMap} from '@react-google-maps/api';
import {useSearchParams} from 'react-router-dom';
import EventInfo from '../../components/EventInfo';
import EventForm from '../../components/EventForm';
import Modal from '../../components/Modal';
import LocationSearch from '../../components/LocationSearch';
import EventArtwork from '../../components/EventArtwork';
import PhotoMarkers from './PhotoMarkers';
import {useAuthAction} from '../../contexts/AuthFlowContext';
import {useNotifications} from '../../contexts/NotificationContext';
import {fetchEvents,deleteEvent} from '../../services/eventsService';
import socket,{onRealtimeWake} from '../../services/socket';
import {CATEGORIES,GTA_BOUNDS,distanceKm,eventImage,eventTime,eventView,isEnded,nextStart} from '../../utils/event';
const DEFAULT_CENTER={lat:43.8,lng:-79.25};
const DEFAULT_ZOOM=10;
const OPTIONS={mapId:import.meta.env.VITE_GOOGLE_MAPS_MAP_ID||'DEMO_MAP_ID',disableDefaultUI:true,zoomControl:false,fullscreenControl:false,
  colorScheme:'FOLLOW_SYSTEM',isFractionalZoomEnabled:true,gestureHandling:'greedy',
  restriction:{latLngBounds:GTA_BOUNDS,strictBounds:true},maxZoom:20,minZoom:3,clickableIcons:false,mapTypeControl:false};
function viewGTA(instance) {
  if(!instance) return;
  // Start over the urban corridor; the northern GTA remains reachable by panning.
  instance.moveCamera({center:DEFAULT_CENTER,zoom:DEFAULT_ZOOM});
}
export default function EventMap() {
  const {push}=useNotifications();
  const [params,setParams]=useSearchParams(),[events,setEvents]=useState([]),[map,setMap]=useState(null),[viewport,setViewport]=useState(null);
  const [zoom,setZoom]=useState(DEFAULT_ZOOM),[center,setCenter]=useState(DEFAULT_CENTER),[category,setCategory]=useState(''),[time,setTime]=useState('all'),[distance,setDistance]=useState('0');
  const [mode,setMode]=useState('location'),[query,setQuery]=useState(''),[filters,setFilters]=useState(false),[listOpen,setListOpen]=useState(false),[listLimit,setListLimit]=useState(30),[clusterIds,setClusterIds]=useState([]);
  const [form,setForm]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[locationBusy,setLocationBusy]=useState(false);
  const request=useRef(0),active=useRef(true),mapRef=useRef(null),opened=useRef(null),selectionTrigger=useRef(null);
  const selectedId=params.get('event'),selected=events.find(event=>String(event.id)===selectedId)||null;
  const select=useCallback(id=>{selectionTrigger.current=document.activeElement;setClusterIds([]);setListOpen(false);setParams({event:String(id)},{replace:true});},[setParams]);
  const close=()=>{setParams({},{replace:true});opened.current=null;requestAnimationFrame(()=>{
    const target=selectionTrigger.current; if(target?.isConnected) target.focus({preventScroll:true});else document.getElementById('map-mode')?.focus({preventScroll:true});
  });};
  const create=useAuthAction(()=>setForm({latitude:center.lat,longitude:center.lng}),'create an event');
  useEffect(()=>{
    if(!params.has('create')) return;
    const next=new URLSearchParams(params);next.delete('create');setParams(next,{replace:true});create();
  },[params,setParams,create]);
  const refresh=useCallback(async()=>{
    const generation=++request.current;
    try {const rows=await fetchEvents();if(!active.current||generation!==request.current) return;setEvents(rows.map(eventView));setError('');}
    catch {if(active.current && generation===request.current) setError('Unable to load events. Please try again.');}
    finally {if(active.current) setLoading(false);}
  },[]);
  useEffect(()=>{
    active.current=true;void refresh();
    const changed=row=>setEvents(old=>{const value=eventView(row);const found=old.find(item=>String(item.id)===String(row.id));return found?old.map(item=>String(item.id)===String(row.id)?{...item,...value}:item):[...old,value];});
    const deleted=({id})=>setEvents(old=>old.filter(item=>String(item.id)!==String(id)));
    socket.on('event:created',changed);socket.on('event:updated',changed);socket.on('event:deleted',deleted);const stop=onRealtimeWake(refresh);
    const timer=setInterval(()=>{if(document.visibilityState==='visible') void refresh();},60000);
    // Invalidate request generations on unmount; this ref is a counter, not a DOM node.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return()=>{active.current=false;request.current++;stop();clearInterval(timer);socket.off('event:created',changed);socket.off('event:updated',changed);socket.off('event:deleted',deleted);};
  },[refresh]);
  useEffect(()=>{
    if(!selected || !map || opened.current===selected.id) return;
    opened.current=selected.id;
    if(selected.position) {map.panTo(selected.position);if(map.getZoom()<14) map.setZoom(15);}
    const frame=requestAnimationFrame(()=>document.getElementById('event-detail-title')?.focus({preventScroll:true}));return()=>cancelAnimationFrame(frame);
  },[map,selected]);
  const filtered=useMemo(()=>{
    const now=Date.now(),days={day:1,week:7,month:30}[time];
    return events.filter(event=>{
      if(isEnded(event,now)||event.status==='cancelled') return false;
      if(category && event.category!==category) return false;
      if(query && mode==='event' && !`${event.title} ${event.description||''}`.toLowerCase().includes(query.toLowerCase())) return false;
      const next=nextStart(event,now);
      if(days && (!next || new Date(next).getTime()>now+days*86400000)) return false;
      if(Number(distance)>0 && distanceKm(center,event.position)>Number(distance)) return false;
      return true;
    });
  },[events,time,category,query,mode,distance,center]);
  const visible=useMemo(()=>filtered.filter(event=>!event.position || !viewport || (event.position.lat>=viewport.south && event.position.lat<=viewport.north && event.position.lng>=viewport.west && event.position.lng<=viewport.east)),[filtered,viewport]);
  const listed=useMemo(()=>[...(clusterIds.length?filtered.filter(event=>clusterIds.includes(event.id)):visible)].sort((a,b)=>new Date(nextStart(a))-new Date(nextStart(b))),[clusterIds,filtered,visible]);
  const cluster=useCallback(ids=>{setClusterIds(ids);setListLimit(30);setListOpen(true);setParams({},{replace:true});},[setParams]);
  const loadMap=useCallback(instance=>{mapRef.current=instance;setMap(instance);},[]);
  function idle() {
    const instance=mapRef.current;if(!instance?.getBounds()) return;
    const value=instance.getBounds().toJSON();
    setViewport(old=>old && Object.keys(value).every(key=>Math.abs(value[key]-old[key])<0.000001)?old:value);
    const point=instance.getCenter();setCenter(old=>Math.abs(old.lat-point.lat())<0.000001&&Math.abs(old.lng-point.lng())<0.000001?old:{lat:point.lat(),lng:point.lng()});
    setZoom(instance.getZoom());
  }
  function locate() {
    if(!navigator.geolocation) return push({type:'warning',message:'Location is unavailable in this browser.',autoCloseMs:5000});
    setLocationBusy(true);navigator.geolocation.getCurrentPosition(position=>{
      map?.panTo({lat:position.coords.latitude,lng:position.coords.longitude});map?.setZoom(14);setLocationBusy(false);
    },()=>{setLocationBusy(false);push({type:'warning',message:'Location could not be used. Search for a city or neighbourhood instead.',autoCloseMs:6000});},{timeout:10000,maximumAge:60000});
  }
  function saved(row) {
    const value=eventView(row);setEvents(old=>old.some(event=>event.id===value.id)?old.map(event=>event.id===value.id?value:event):[...old,value]);setForm(null);select(value.id);void refresh();
  }
  async function remove(id) {
    try {const result=await deleteEvent(id);if(result.event) saved(result.event);else {setEvents(old=>old.filter(event=>event.id!==id));close();}}
    catch(failure) {push({type:'error',message:failure.message||'Unable to update this event.',autoCloseMs:5000});}
  }
  return <main className="map-page">
    <div className="map-toolbar">
      <div className="map-search"><label className="sr-only" htmlFor="search-mode">Search type</label><select id="search-mode" value={mode} onChange={event=>setMode(event.target.value)} className="select select-bordered w-28 shrink-0"><option value="location">Location</option><option value="event">Events</option></select>
        {mode==='location'?<LocationSearch onSelected={place=>{const point=place.geometry.location;map?.panTo({lat:point.lat(),lng:point.lng()});map?.setZoom(14);}}/>
          :<><label className="sr-only" htmlFor="event-query">Search events</label><input id="event-query" type="search" placeholder="Search event titles or descriptions" value={query} onChange={event=>{setQuery(event.target.value);setListOpen(true);setClusterIds([]);}} className="input input-bordered min-w-0 flex-1"/></>}
      </div>
      <div className="map-toolbar-actions"><button className={`btn btn-outline ${filters?'btn-active':''}`} aria-expanded={filters} aria-controls="map-filters" onClick={()=>setFilters(value=>!value)}>Filters{category||time!=='all'||distance!=='0'?' •':''}</button>
        <div className="view-switch" role="group" aria-label="Event view"><button id="map-mode" className="btn" aria-pressed={!listOpen} onClick={()=>{setListOpen(false);setClusterIds([]);close();}}>Map</button><button className="btn" aria-pressed={listOpen} onClick={()=>{setListOpen(true);setClusterIds([]);close();}}>List</button></div></div>
    </div>
    {filters && <div id="map-filters" className="map-filters">
      <label className="form-field" htmlFor="filter-time"><span>When</span><select id="filter-time" className="select select-bordered" value={time} onChange={event=>setTime(event.target.value)}><option value="all">All upcoming</option><option value="day">Next 24 hours</option><option value="week">Next 7 days</option><option value="month">Next 30 days</option></select></label>
      <label className="form-field" htmlFor="filter-category"><span>Category</span><select id="filter-category" className="select select-bordered" value={category} onChange={event=>setCategory(event.target.value)}><option value="">All categories</option>{CATEGORIES.map(value=><option key={value}>{value}</option>)}</select></label>
      <label className="form-field" htmlFor="filter-distance"><span>Within map centre</span><select id="filter-distance" className="select select-bordered" value={distance} onChange={event=>setDistance(event.target.value)}><option value="0">Any distance</option>{[1,5,10,25,50,100].map(value=><option key={value} value={value}>{value} km</option>)}</select></label>
      <button className="btn btn-ghost self-end" onClick={()=>{setTime('all');setCategory('');setDistance('0');}}>Reset</button>
    </div>}
    {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-base-200 p-3 text-sm">{error}<button className="btn btn-sm" onClick={refresh}>Retry</button></div>}
    <div className={`map-stage ${selected||listOpen?'has-panel':''}`}>
      <div className="map-canvas"><GoogleMap onLoad={loadMap} onIdle={idle} mapContainerStyle={{height:'100%',width:'100%'}} center={DEFAULT_CENTER} zoom={DEFAULT_ZOOM} options={OPTIONS}>
        <PhotoMarkers map={map} events={filtered} zoom={zoom} viewport={viewport} onSelect={select} onCluster={cluster} selectedId={selectedId}/>
      </GoogleMap>
        <div className="map-navigation"><div className="map-control-group"><button aria-label="Show my location" disabled={locationBusy} onClick={locate}>{locationBusy?'Locating…':'My location'}</button><button onClick={()=>viewGTA(map)}>View GTA</button></div><div className="map-control-group map-zoom" role="group" aria-label="Map zoom"><button aria-label="Zoom in" disabled={zoom>=20} onClick={()=>map?.setZoom(zoom+1)}>＋</button><button aria-label="Zoom out" disabled={zoom<=3} onClick={()=>map?.setZoom(zoom-1)}>−</button></div></div>
        <div className="map-caption" role="status">{loading?'Loading events…':`${filtered.length} upcoming`}</div>
      </div>
      {selected && <aside className="event-panel" aria-labelledby="event-detail-title" onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented) {event.stopPropagation();close();}}}><EventInfo event={selected} onClose={close} onEdit={setForm} onDelete={remove} onSaved={saved}/></aside>}
      {!selected && listOpen && <aside className="event-panel event-list" aria-label="Events in this area"><header className="event-list-header"><div><h2 className="text-xl font-semibold">{clusterIds.length?'Events in this group':'Events in this view'}</h2><p className="text-sm text-base-content/75">{listed.length} events</p></div><button className="btn btn-circle btn-ghost" aria-label="Close event list" onClick={()=>{setListOpen(false);setClusterIds([]);}}>✕</button></header>
        {!listed.length && <p className="p-5 text-base-content/75">No matching events here. Move the map or change your filters.</p>}
        <ul className="divide-y divide-base-300">{listed.slice(0,listLimit).map(event=><li key={event.id}><button className="event-list-item" onClick={()=>select(event.id)}><EventArtwork src={eventImage(event,'thumb')?.url} title={event.title} category={event.category} className="h-20 w-20 shrink-0 rounded-lg"/><span className="min-w-0"><strong className="block text-left font-semibold">{event.title}</strong><span className="mt-2 block text-left text-sm text-base-content/75">{eventTime(nextStart(event))}</span>{!event.position&&<span className="text-sm">Location to be confirmed</span>}</span></button></li>)}</ul>
        {listed.length>listLimit && <button className="btn m-4" onClick={()=>setListLimit(value=>value+30)}>Show more events</button>}
      </aside>}
    </div>
    <p className="map-source-note">Explore the GTA · Official listings currently come from Toronto. Times are shown in Toronto time.</p>
    {form && <Modal title={form.id?'Edit event':'Create event'} onClose={()=>setForm(null)} description="Share something worth going to. Dates and times use Toronto time."><EventForm initialData={form} onCancel={()=>setForm(null)} onSaved={saved}/></Modal>}
  </main>;
}
