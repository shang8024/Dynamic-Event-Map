import {lazy,Suspense,useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {GoogleMap} from '@react-google-maps/api';
import {useLocation,useNavigate,useSearchParams} from 'react-router-dom';
import EventInfo from '../../components/EventInfo';
import Icon from '../../components/Icon';
const EventForm=lazy(()=>import('../../components/EventForm'));
import Modal from '../../components/Modal';
import MapTools from '../../components/MapTools';
import useCompactMap from '../../hooks/useCompactMap';
import EventArtwork from '../../components/EventArtwork';
import PhotoMarkers from './PhotoMarkers';
import {useAuthFlow} from '../../contexts/AuthFlowContext';
import {useAuth} from '../../contexts/AuthContext';
import {useTheme} from '../../contexts/ThemeContext';
import {authIntent} from '../../services/authNavigation';
import {useNotifications} from '../../contexts/NotificationContext';
import {fetchMapEvents,fetchEvent,deleteEvent} from '../../services/eventsService';
import socket,{onRealtimeWake} from '../../services/socket';
import {readMapBrowsing,rememberMapBrowsing} from '../../services/mapBrowsing';
import {createMapCameraMotion} from '../../utils/mapCamera';
import {withinGTA,GTA_LOCATION_HELP} from '../../utils/eventLocation';
import {GTA_BOUNDS,compareEventStarts,distanceKm,eventImage,eventTime,eventView,isEnded,nextStart} from '../../utils/event';
import './MapFocusLayout.css';
const DEFAULT_CENTER={lat:43.8,lng:-79.25};
const DEFAULT_ZOOM=10;
const OPTIONS={mapId:import.meta.env.VITE_GOOGLE_MAPS_MAP_ID||'DEMO_MAP_ID',disableDefaultUI:true,zoomControl:false,fullscreenControl:false,
  isFractionalZoomEnabled:true,gestureHandling:'greedy',
  restriction:{latLngBounds:GTA_BOUNDS,strictBounds:true},maxZoom:20,minZoom:3,clickableIcons:false,mapTypeControl:false};
function viewGTA(instance) {
  if(!instance) return;
  // Start over the urban corridor; the northern GTA remains reachable by panning.
  instance.moveCamera({center:DEFAULT_CENTER,zoom:DEFAULT_ZOOM});
}
export default function EventMap({mapsReady=true,mapsError=null}) {
  const {push}=useNotifications();
  const {colorMode}=useTheme();
  const {user}=useAuth(),requestAuth=useAuthFlow(),location=useLocation(),navigate=useNavigate();
  const [initialBrowse]=useState(()=>readMapBrowsing(location.key));
  const [params,setParams]=useSearchParams(),[events,setEvents]=useState([]),[map,setMap]=useState(null),[viewport,setViewport]=useState(null);
  const camera=useMemo(()=>createMapCameraMotion(map),[map]);
  useEffect(()=>()=>camera.cancel(),[camera]);
  const [zoom,setZoom]=useState(initialBrowse?.zoom??DEFAULT_ZOOM),[center,setCenter]=useState(initialBrowse?.center??DEFAULT_CENTER),[category,setCategory]=useState(initialBrowse?.category??''),[time,setTime]=useState(initialBrowse?.time??'all'),[distance,setDistance]=useState(initialBrowse?.distance??'0');
  const [mode,setMode]=useState(initialBrowse?.mode??'location'),[query,setQuery]=useState(initialBrowse?.query??''),[filters,setFilters]=useState(initialBrowse?.filters??false),[listOpen,setListOpen]=useState(initialBrowse?.listOpen??false),[listLimit,setListLimit]=useState(initialBrowse?.listLimit??30),[clusterIds,setClusterIds]=useState(initialBrowse?.clusterIds??[]);
  const [toolsOpen,setToolsOpen]=useState(false);
  const compact=useCompactMap(),[navigationOpen,setNavigationOpen]=useState(false);
  const [form,setForm]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[locationBusy,setLocationBusy]=useState(false);
  const [formDirty,setFormDirty]=useState(false),[formBusy,setFormBusy]=useState(false),[photoPrompt,setPhotoPrompt]=useState(null);
  const request=useRef(0),active=useRef(true),mapRef=useRef(null),panelRef=useRef(null),opened=useRef(null),selectionTrigger=useRef(null);
  const [mapAppearance,setMapAppearance]=useState(()=>({colorMode,center:initialBrowse?.center??DEFAULT_CENTER,zoom:initialBrowse?.zoom??DEFAULT_ZOOM}));
  const mapOptions=useMemo(()=>({...OPTIONS,colorScheme:mapAppearance.colorMode==='dark'?'DARK':'LIGHT'}),[mapAppearance.colorMode]);
  useEffect(()=>{
    if(mapAppearance.colorMode===colorMode) return;
    // Maps fixes its color scheme at construction. Keep the camera when recreating it.
    camera.cancel();
    const instance=mapRef.current,point=instance?.getCenter();
    setMapAppearance({colorMode,center:point?{lat:point.lat(),lng:point.lng()}:center,zoom:instance?.getZoom()??zoom});
  },[colorMode,mapAppearance.colorMode,camera,center,zoom]);
  const previousEntry=useRef(location.key),skipRemember=useRef(false),restoreList=useRef(initialBrowse?.listOpen&&!params.has('event')?initialBrowse:null);
  const restoringCamera=useRef(Boolean(initialBrowse)),[restoreTick,setRestoreTick]=useState(0);
  const selectedId=params.get('event'),summary=events.find(event=>String(event.id)===selectedId)||null;
  const [detail,setDetail]=useState(null),[detailError,setDetailError]=useState(''),[detailRetry,setDetailRetry]=useState(0);
  const selected=detail&&String(detail.id)===selectedId&&(!summary||String(detail.version)===String(summary.version))?detail:summary;
  useEffect(()=>{
    if(!selectedId||!/^[1-9]\d{0,9}$/.test(selectedId)) return;
    const controller=new AbortController();setDetailError('');
    fetchEvent(selectedId,{signal:controller.signal}).then(row=>{if(!controller.signal.aborted)setDetail(eventView(row));})
      .catch(()=>{if(!controller.signal.aborted)setDetailError('Event details could not be loaded.');});
    return()=>controller.abort();
  },[selectedId,summary?.version,detailRetry]);
  const panelOpen=Boolean(selected||listOpen);
  const intent=useMemo(()=>authIntent(location.state?.authIntent,location.pathname+location.search),[location.state,location.pathname,location.search]);
  const browsing=useCallback(()=>({center,zoom,category,time,distance,mode,query,filters,listOpen,listLimit,clusterIds,
    scrollTop:panelRef.current?.scrollTop||0,focusId:document.activeElement?.closest('[data-event-id]')?.dataset.eventId}),[center,zoom,category,time,distance,mode,query,filters,listOpen,listLimit,clusterIds]);
  useLayoutEffect(()=>{
    if(previousEntry.current===location.key) return;
    previousEntry.current=location.key;
    const view=readMapBrowsing(location.key,{fallback:false});
    if(!view) return;
    camera.cancel();
    skipRemember.current=true;restoreList.current=view.listOpen&&!params.has('event')?view:null;
    setCenter(view.center);setZoom(view.zoom);setCategory(view.category);setTime(view.time);setDistance(view.distance);
    setMode(view.mode);setQuery(view.query);setFilters(view.filters);setListOpen(view.listOpen);setListLimit(view.listLimit);setClusterIds(view.clusterIds);
    const instance=mapRef.current,point=instance?.getCenter();
    const atTarget=point&&Math.abs(point.lat()-view.center.lat)<0.000001&&Math.abs(point.lng()-view.center.lng)<0.000001&&Math.abs(instance.getZoom()-view.zoom)<0.000001;
    restoringCamera.current=!atTarget;
    if(atTarget) setRestoreTick(value=>value+1);
    else instance?.moveCamera({center:view.center,zoom:view.zoom});
  },[location.key,params,camera]);
  useEffect(()=>{
    if(skipRemember.current) {skipRemember.current=false;return;}
    if(restoreList.current||restoringCamera.current) return;
    rememberMapBrowsing(location.key,browsing());
  },[location.key,browsing]);
  const handledIntent=useCallback(()=>setParams(params,{replace:true,state:{...location.state,authIntent:null}}),[params,setParams,location.state]);
  const select=useCallback(id=>{
    camera.cancel();
    rememberMapBrowsing(location.key,{...browsing(),focusId:String(id)});selectionTrigger.current=document.activeElement;
    setToolsOpen(false);setListOpen(false);setClusterIds([]);restoreList.current=null;opened.current=null;
    setParams({event:String(id)});
  },[setParams,location.key,browsing,camera]);
  function openForm(value) {setFormDirty(false);setFormBusy(false);setForm(value);}
  const discardForm=useCallback(()=>{setForm(null);setFormDirty(false);setFormBusy(false);},[]);
  const close=()=>{
    camera.cancel();
    setToolsOpen(false);setListOpen(false);setClusterIds([]);restoreList.current=null;opened.current=null;
    setParams({},{replace:true});requestAnimationFrame(()=>{
    const target=selectionTrigger.current; if(target?.isConnected) target.focus({preventScroll:true});else document.getElementById('map-mode')?.focus({preventScroll:true});
  });};
  useEffect(()=>{if(selectedId) {setToolsOpen(false);setNavigationOpen(false);}},[selectedId]);
  useEffect(()=>{if(!panelOpen) {setToolsOpen(false);setNavigationOpen(false);}},[panelOpen]);
  useEffect(()=>{
    if(!params.has('create')&&intent?.kind!=='create') return;
    if(user) navigate('/events/new',{replace:true,state:null});else requestAuth('create an event','/events/new');
  },[params,user,requestAuth,navigate,intent]);
  const [search,setSearch]=useState(mode==='event'?query.trim():'');
  useEffect(()=>{const timer=setTimeout(()=>setSearch(mode==='event'?query.trim():''),350);return()=>clearTimeout(timer);},[query,mode]);
  const flight=useRef(null),lastRows=useRef(null);
  const refresh=useCallback(async()=>{
    if(flight.current?.query===search) return flight.current.promise;
    flight.current?.controller.abort();const controller=new AbortController();
    const generation=++request.current;
    const promise=(async()=>{
      try {const rows=await fetchMapEvents(search,{signal:controller.signal});if(!active.current||generation!==request.current) return;
        if(lastRows.current!==rows){lastRows.current=rows;setEvents(rows.map(eventView));}setError('');}
      catch {if(!controller.signal.aborted&&active.current&&generation===request.current)setError('Unable to load events. Please try again.');}
      finally {if(active.current&&generation===request.current)setLoading(false);if(flight.current?.controller===controller)flight.current=null;}
    })();
    flight.current={query:search,controller,promise};return promise;
  },[search]);
  useEffect(()=>{
    active.current=true;setLoading(true);void refresh();
    const changed=row=>{
      setDetail(old=>String(old?.id)===String(row.id)?eventView(row):old);
      if(search) {void refresh();return;}
      setEvents(old=>{const value=eventView(row),found=old.find(item=>String(item.id)===String(row.id));
        if(found&&Number(found.version)>=Number(row.version))return old;
        return found?old.map(item=>String(item.id)===String(row.id)?value:item):[...old,value];});
    };
    const deleted=({id})=>setEvents(old=>old.filter(item=>String(item.id)!==String(id)));
    socket.on('event:created',changed);socket.on('event:updated',changed);socket.on('event:deleted',deleted);const stop=onRealtimeWake(refresh);
    const timer=setInterval(()=>{if(document.visibilityState==='visible') void refresh();},60000);
    // Invalidate request generations on unmount; this ref is a counter, not a DOM node.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return()=>{active.current=false;request.current++;flight.current?.controller.abort();flight.current=null;stop();clearInterval(timer);socket.off('event:created',changed);socket.off('event:updated',changed);socket.off('event:deleted',deleted);};
  },[refresh,search]);
  useEffect(()=>{
    if(!selected || !map || opened.current===selected.id) return;
    opened.current=selected.id;
    panelRef.current?.scrollTo({top:0});
    if(selected.position) camera.flyTo({center:selected.position,zoom:map.getZoom()<14?15:map.getZoom()});
    if(intent?.kind==='comment') return;
    const frame=requestAnimationFrame(()=>document.getElementById('event-detail-title')?.focus({preventScroll:true}));return()=>cancelAnimationFrame(frame);
  },[map,selected,intent,camera,location.key]);
  useEffect(()=>{
    if(!listOpen||selected||document.activeElement?.id==='event-query') return;
    const restored=restoreList.current;
    if(restored&&(loading||restoringCamera.current)) return;
    const frame=requestAnimationFrame(()=>{
      panelRef.current?.scrollTo({top:restored?.scrollTop||0});
      const target=restored?.focusId?document.querySelector(`.event-list-item[data-event-id="${restored.focusId}"]`):null;
      (target||document.getElementById('event-list-title'))?.focus({preventScroll:true});
      if(restored) {restoreList.current=null;rememberMapBrowsing(location.key,{...restored,scrollTop:panelRef.current?.scrollTop||0});}
    });return()=>cancelAnimationFrame(frame);
  },[listOpen,clusterIds,selected,loading,restoreTick,location.key]);
  const filtered=useMemo(()=>{
    const now=Date.now(),days={day:1,week:7,month:30}[time];
    return events.filter(event=>{
      if(isEnded(event,now)||event.status==='cancelled') return false;
      if(category && event.category!==category) return false;
      if(!event._summary&&search&&!`${event.title} ${event.description||''}`.toLowerCase().includes(search.toLowerCase()))return false;
      const next=nextStart(event,now);
      if(days && (!next || new Date(next).getTime()>now+days*86400000)) return false;
      if(Number(distance)>0 && distanceKm(center,event.position)>Number(distance)) return false;
      return true;
    });
  },[events,time,category,search,distance,center]);
  const visible=useMemo(()=>filtered.filter(event=>!event.position || !viewport || (event.position.lat>=viewport.south && event.position.lat<=viewport.north && event.position.lng>=viewport.west && event.position.lng<=viewport.east)),[filtered,viewport]);
  const listed=useMemo(()=>[...(clusterIds.length?filtered.filter(event=>clusterIds.includes(event.id)):visible)].sort(compareEventStarts),[clusterIds,filtered,visible]);
  const cluster=useCallback((ids,position)=>{setToolsOpen(false);setClusterIds(ids);setListLimit(30);setListOpen(true);setParams({},{replace:true});camera.flyTo({center:position});},[setParams,camera]);
  const loadMap=useCallback(instance=>{if(!mapRef.current) opened.current=null;mapRef.current=instance;setMap(instance);},[]);
  function idle() {
    if(camera.isMoving()) return;
    const instance=mapRef.current;if(!instance?.getBounds()) return;
    const value=instance.getBounds().toJSON();
    setViewport(old=>old && Object.keys(value).every(key=>Math.abs(value[key]-old[key])<0.000001)?old:value);
    const point=instance.getCenter();setCenter(old=>Math.abs(old.lat-point.lat())<0.000001&&Math.abs(old.lng-point.lng())<0.000001?old:{lat:point.lat(),lng:point.lng()});
    setZoom(instance.getZoom());
    if(restoringCamera.current) {restoringCamera.current=false;setRestoreTick(value=>value+1);}
  }
  function locate() {
    if(!navigator.geolocation) return push({type:'warning',message:'Location is unavailable in this browser.',autoCloseMs:5000});
    setLocationBusy(true);navigator.geolocation.getCurrentPosition(position=>{
      const point={lat:position.coords.latitude,lng:position.coords.longitude};
      if(withinGTA(point)) {camera.cancel();map?.moveCamera({center:point,zoom:14});}
      else push({type:'warning',message:GTA_LOCATION_HELP,autoCloseMs:7000});
      setLocationBusy(false);
    },()=>{setLocationBusy(false);push({type:'warning',message:'Location could not be used. Search for a city or neighbourhood instead.',autoCloseMs:6000});},{timeout:10000,maximumAge:60000});
  }
  function saved(row) {
    const value=eventView(row);if(form&&!form.id) setPhotoPrompt(value.id);
    setEvents(old=>old.some(event=>event.id===value.id)?old.map(event=>event.id===value.id?value:event):[...old,value]);
    setForm(null);setFormDirty(false);setFormBusy(false);if(String(value.id)!==selectedId) select(value.id);void refresh();
  }
  async function remove(id) {
    try {const result=await deleteEvent(id);if(result.event) saved(result.event);else {setEvents(old=>old.filter(event=>event.id!==id));close();}return true;}
    catch(failure) {push({type:'error',message:failure.message||'Unable to update this event.',autoCloseMs:5000});return false;}
  }
  function toggleTools() {
    setToolsOpen(value=>!value);
  }
  function resetView() {camera.cancel();viewGTA(map);}
  const activeFilters=Number(Boolean(category))+Number(time!=='all')+Number(distance!=='0')+Number(mode==='event'&&Boolean(query.trim()));
  const mapTools=<MapTools mode={mode} setMode={setMode} query={query} onQueryChange={value=>{setQuery(value);if(!compact||toolsOpen) setListOpen(true);setClusterIds([]);if(selectedId) setParams({},{replace:true});}}
    filters={filters} setFilters={setFilters} category={category} setCategory={setCategory} time={time} setTime={setTime} distance={distance} setDistance={setDistance} listOpen={listOpen}
    onViewChange={value=>{setToolsOpen(false);setListOpen(value==='list');setClusterIds([]);setParams({},{replace:true});}}
    onLocationSelected={place=>{const point=place.geometry.location;camera.cancel();map?.moveCamera({center:{lat:point.lat(),lng:point.lng()},zoom:14});setToolsOpen(false);}}/>;
  return <main className="map-page" data-panel-open={panelOpen} data-tools-open={toolsOpen} data-navigation-open={navigationOpen}>
    {!(compact&&panelOpen)&&mapTools}
    {compact&&panelOpen&&toolsOpen&&<Modal title="Map tools" className="map-tools-drawer" onClose={()=>setToolsOpen(false)} description="Search and filter events without losing your place on the map.">
      {mapTools}<div className="map-tools-quick-actions"><button className="btn btn-outline" onClick={()=>{resetView();setToolsOpen(false);}}>View GTA</button>
        <button className="btn btn-outline" disabled={locationBusy} onClick={()=>{locate();setToolsOpen(false);}}>{locationBusy?'Locating…':'My location'}</button>
        <button className="btn btn-ghost" onClick={()=>{setNavigationOpen(value=>!value);setToolsOpen(false);if(!navigationOpen) window.dispatchEvent(new Event('eventmap:show-navigation'));}}>{navigationOpen?'Hide site navigation':'Show site navigation'}</button></div>
    </Modal>}
    {error && <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-base-200 p-3 text-sm">{error}<button className="btn btn-sm" onClick={refresh}>Retry</button></div>}
    <div className={`map-stage ${selected||listOpen?'has-panel':''}`}>
      <div className="map-canvas" onPointerDownCapture={camera.cancel} onWheelCapture={camera.cancel} onKeyDownCapture={camera.cancel}>{mapsReady?<GoogleMap key={mapAppearance.colorMode} onLoad={loadMap} onIdle={idle} mapContainerStyle={{height:'100%',width:'100%'}} center={mapAppearance.center} zoom={mapAppearance.zoom} options={mapOptions}>
        <PhotoMarkers map={map} events={filtered} zoom={zoom} viewport={viewport} onSelect={select} onCluster={cluster} selectedId={selectedId}/>
      </GoogleMap>:<div className="map-loading" role="status">{mapsError?<><p>The map could not be loaded. You can still browse the event list.</p><button className="btn btn-outline" onClick={()=>setListOpen(true)}>Browse events as a list</button></>:<p>Loading map…</p>}</div>}
        {panelOpen&&<button type="button" className="btn map-tools-toggle" aria-controls={toolsOpen?'map-tools':undefined} aria-haspopup="dialog" aria-expanded={toolsOpen} onClick={toggleTools}>{activeFilters?`Map tools (${activeFilters})`:'Map tools'}</button>}
        <div className="map-navigation"><div className="map-control-group"><button aria-label="Show my location" disabled={locationBusy} onClick={locate}>{locationBusy?'Locating…':'My location'}</button><button onClick={()=>viewGTA(map)}>View GTA</button></div><div className="map-control-group map-zoom" role="group" aria-label="Map zoom"><button aria-label="Zoom in" disabled={zoom>=20} onClick={()=>map?.setZoom(zoom+1)}><Icon name="plus"/></button><button aria-label="Zoom out" disabled={zoom<=3} onClick={()=>map?.setZoom(zoom-1)}><Icon name="minus"/></button></div></div>
        <div className="map-caption" role="status">{loading?'Loading events…':`${visible.length} upcoming`}</div>
      </div>
      {selected && <aside className="event-panel event-detail-panel" aria-labelledby="event-detail-title" onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented) {event.stopPropagation();close();}}}><EventInfo key={selected.id} event={selected} mapsReady={mapsReady} detailsLoading={Boolean(selected._summary)} detailsError={detailError} onRetryDetails={()=>setDetailRetry(value=>value+1)} onClose={close} bodyRef={panelRef} onBodyScroll={()=>{if(!restoreList.current&&!restoringCamera.current) rememberMapBrowsing(location.key,browsing());}} onEdit={openForm} onDelete={remove} onSaved={saved} promptForPhoto={photoPrompt===selected.id} pendingAction={intent} onActionHandled={handledIntent}/></aside>}
      {!selected && listOpen && <aside className="event-panel event-list" aria-label="Events in this area"><header className="event-list-header"><div><h2 id="event-list-title" tabIndex={-1} className="text-xl font-semibold outline-none">{clusterIds.length?'Events in this group':'Events in this view'}</h2><p className="text-sm muted">{listed.length} events</p></div><button className="btn btn-circle btn-ghost" aria-label="Close event list" onClick={()=>{camera.cancel();setToolsOpen(false);setListOpen(false);setClusterIds([]);requestAnimationFrame(()=>document.getElementById('list-mode')?.focus());}}><Icon name="close" size={16}/></button></header>
        <div ref={panelRef} className="event-list-scroll" onScroll={()=>{if(!restoreList.current&&!restoringCamera.current) rememberMapBrowsing(location.key,browsing());}}>
        {!listed.length && <p className="p-5 text-base-content/75">No matching events here. Move the map or change your filters.</p>}
        <ul className="divide-y divide-base-300">{listed.slice(0,listLimit).map(event=><li key={event.id}><button className="event-list-item" data-event-id={event.id} onClick={()=>select(event.id)}><EventArtwork alt="" src={eventImage(event,'thumb')?.url} title={event.title} category={event.category} className="h-20 w-20 shrink-0 rounded-lg"/><span className="min-w-0"><strong className="block text-left font-semibold">{event.title}</strong><span className="mt-2 block text-left text-sm text-base-content/75">{eventTime(nextStart(event))}</span>{!event.position&&<span className="text-sm">Location to be confirmed</span>}</span></button></li>)}</ul>
        {listed.length>listLimit && <button className="btn m-4" onClick={()=>setListLimit(value=>value+30)}>Show more events</button>}
        </div>
      </aside>}
    </div>
    {form && <Modal dirty={formDirty} busy={formBusy} title={form.id?'Edit event':'Create event'} onClose={discardForm} description="Share something worth going to. Dates and times use Toronto time.">{({requestClose})=><Suspense fallback={<p role="status">Loading event editor…</p>}><EventForm initialData={form} onDirtyChange={setFormDirty} onBusyChange={setFormBusy} onDiscard={discardForm} onCancel={requestClose} onSaved={saved}/></Suspense>}</Modal>}
  </main>;
}
