import {useEffect,useId,useRef,useState} from 'react';
import {createPlacesSearch} from '../services/placesSearch';
import {GTA_BOUNDS} from '../utils/event';
import {GTA_LOCATION_HELP,withinGTA} from '../utils/eventLocation';
export default function LocationSearch({onSelected,onQueryChange,onBusyChange,initialValue='',autoResolve=false,label='Search a location',placeholder='City, neighbourhood or venue',showLabel=false,enforceBounds=true}) {
  const id=useId(),version=useRef(0);
  const [service]=useState(()=>createPlacesSearch(()=>window.google?.maps?.importLibrary('places'),GTA_BOUNDS));
  const [query,setQuery]=useState(initialValue),[items,setItems]=useState([]),[index,setIndex]=useState(-1),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const selected=useRef(initialValue),resultsFor=useRef('');
  useEffect(()=>{onBusyChange?.(busy);return()=>onBusyChange?.(false);},[busy,onBusyChange]);
  useEffect(()=>{
    const request=++version.current;
    if(query.trim().length<2 || query===selected.current) {setItems([]);return;}
    const timer=setTimeout(async()=>{
      try {const result=await service.getPredictions(query);if(request===version.current) {resultsFor.current=query;setItems(result);setIndex(-1);setError('');}}
      catch {if(request===version.current) setError(autoResolve?'Address search is unavailable. You can place a pin manually.':'Location search is unavailable. You can still browse the map.');}
    },350);
    return()=>clearTimeout(timer);
  },[query,service,autoResolve]);
  useEffect(()=>()=>{version.current++;service.resetSession();},[service]);
  async function choose(item) {
    const request=++version.current;setBusy(true);setItems([]);setError('');
    try {const place=await service.getPlaceDetails(item);if(!place) throw new Error();
      if(request!==version.current) return;
      selected.current=place.formatted_address||item.description;setQuery(selected.current);
      const point={lat:place.geometry.location.lat(),lng:place.geometry.location.lng()};
      if(enforceBounds&&!withinGTA(point)) {setError(GTA_LOCATION_HELP);return;}
      onSelected(place);}
    catch {setError('Unable to use that location. Try another result.');}
    finally {setBusy(false);}
  }
  async function resolve() {
    if(busy||query===selected.current||query.trim().length<2) return;
    const request=++version.current;setBusy(true);setError('');
    try {
      const choices=resultsFor.current===query?items:await service.getPredictions(query);
      if(request!==version.current) return;
      if(!choices.length) {setError('No matching address was found. Try a nearby venue or place a pin manually.');setItems([]);return;}
      await choose(choices[0]);
    } catch {setError('Address search is unavailable. You can place a pin manually.');}
    finally {setBusy(false);}
  }
  function key(event) {
    if(event.key==='ArrowDown' || event.key==='ArrowUp') {event.preventDefault();setIndex(old=>Math.max(0,Math.min(items.length-1,old+(event.key==='ArrowDown'?1:-1))));}
    else if(event.key==='Enter' && items.length) {event.preventDefault();void choose(items[Math.max(0,index)]);}
    else if(event.key==='Escape') {event.stopPropagation();setItems([]);}
  }
  return <div className="location-search" onBlur={event=>{if(autoResolve&&!event.currentTarget.contains(event.relatedTarget)) void resolve();}}>
    <label htmlFor={id} className={showLabel?'mb-2 block text-sm font-medium':'sr-only'}>{label}</label>
    <input id={id} role="combobox" type="search" value={query} placeholder={placeholder} className="input input-bordered w-full" onChange={event=>{selected.current='';setQuery(event.target.value);onQueryChange?.(event.target.value);setError('');}}
      onKeyDown={key} disabled={busy} autoComplete="off" aria-autocomplete="list" aria-expanded={items.length>0} aria-controls={`${id}-results`} aria-activedescendant={index>=0&&items[index]?`${id}-${index}`:undefined}/>
    {items.length>0 && <ul role="listbox" id={`${id}-results`} className="location-results">{items.map((item,i)=><li role="option" aria-selected={i===index} id={`${id}-${i}`} key={item.place_id} className={i===index?'is-active':''} onMouseDown={event=>event.preventDefault()}>
      <button type="button" tabIndex={-1} onClick={()=>choose(item)}>{item.description}</button></li>)}</ul>}
    <span role="status" className="sr-only">{items.length>0?`${items.length} locations found. Use arrow keys to choose.`:''}</span>
    {error && <p role="status" className="mt-1 text-sm text-error">{error}</p>}
    {autoResolve&&query.trim().length>=2&&query!==selected.current&&<button type="button" className="link address-resolve" disabled={busy} onClick={resolve}>{busy?'Finding address…':'Find and format address'}</button>}
  </div>;
}
