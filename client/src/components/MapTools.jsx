import LocationSearch from './LocationSearch';
import {CATEGORIES} from '../utils/event';

const TIME_LABELS={day:'Next 24 hours',week:'Next 7 days',month:'Next 30 days'};

export default function MapTools({mode,setMode,query,onQueryChange,filters,setFilters,category,setCategory,time,setTime,distance,setDistance,listOpen,onViewChange,onLocationSelected}) {
  const active=[];
  if(category) active.push({key:'category',label:category,remove:()=>setCategory('')});
  if(time!=='all') active.push({key:'time',label:TIME_LABELS[time]||time,remove:()=>setTime('all')});
  if(distance!=='0') active.push({key:'distance',label:`Within ${distance} km of map centre`,remove:()=>setDistance('0')});
  if(mode==='event'&&query.trim()) active.push({key:'query',label:`Search: “${query.trim()}”`,remove:()=>onQueryChange('')});
  function resetFilters() {setTime('all');setCategory('');setDistance('0');}
  function clearAll() {resetFilters();if(mode==='event'&&query) onQueryChange('');}
  return <div id="map-tools" className="map-tools">
    <div className="map-toolbar">
      <div className="map-search"><label className="sr-only" htmlFor="search-mode">Search type</label><select id="search-mode" value={mode} onChange={event=>setMode(event.target.value)} className="select select-bordered w-28 shrink-0"><option value="location">Location</option><option value="event">Events</option></select>
        {mode==='location'?<LocationSearch onSelected={onLocationSelected}/>:<><label className="sr-only" htmlFor="event-query">Search events</label><input id="event-query" type="search" placeholder="Search event titles or descriptions" value={query} onChange={event=>onQueryChange(event.target.value)} className="input input-bordered min-w-0 flex-1"/></>}
      </div>
      <div className="map-toolbar-actions"><button type="button" className={`btn btn-outline ${filters?'btn-active':''}`} aria-expanded={filters} aria-controls="map-filters" onClick={()=>setFilters(value=>!value)}>Filters{active.length?` (${active.length})`:''}</button>
        <div className="view-switch" role="group" aria-label="Event view"><button type="button" id="map-mode" className="btn" aria-pressed={!listOpen} onClick={()=>onViewChange('map')}>Map</button><button type="button" id="list-mode" className="btn" aria-pressed={listOpen} onClick={()=>onViewChange('list')}>List</button></div>
      </div>
    </div>
    {active.length>0&&<div className="map-filter-summary"><ul className="map-filter-chips" aria-label="Active filters">{active.map(item=><li key={item.key}><button type="button" className="map-filter-chip" aria-label={`Remove filter: ${item.label}`} title={item.label} onClick={item.remove}><span className="map-filter-chip-label">{item.label}</span><span aria-hidden="true">×</span></button></li>)}</ul><button type="button" className="map-clear-filters" onClick={clearAll}>Clear all<span className="sr-only"> filters</span></button></div>}
    {filters&&<div id="map-filters" className="map-filters">
      <label className="form-field" htmlFor="filter-time"><span>When</span><select id="filter-time" className="select select-bordered" value={time} onChange={event=>setTime(event.target.value)}><option value="all">All upcoming</option><option value="day">Next 24 hours</option><option value="week">Next 7 days</option><option value="month">Next 30 days</option></select></label>
      <label className="form-field" htmlFor="filter-category"><span>Category</span><select id="filter-category" className="select select-bordered" value={category} onChange={event=>setCategory(event.target.value)}><option value="">All categories</option>{CATEGORIES.map(value=><option key={value}>{value}</option>)}</select></label>
      <label className="form-field" htmlFor="filter-distance"><span>Within map centre</span><select id="filter-distance" className="select select-bordered" value={distance} onChange={event=>setDistance(event.target.value)}><option value="0">Any distance</option>{[1,5,10,25,50,100].map(value=><option key={value} value={value}>{value} km</option>)}</select></label>
      <button type="button" className="btn btn-ghost self-end" onClick={resetFilters}>Reset filters</button>
    </div>}
  </div>;
}
