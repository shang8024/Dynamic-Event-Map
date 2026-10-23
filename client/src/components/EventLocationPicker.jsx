import {useCallback,useEffect,useState} from 'react';
import {GoogleMap} from '@react-google-maps/api';
import LocationSearch from './LocationSearch';
import {GTA_BOUNDS} from '../utils/event';
import {GTA_LOCATION_HELP,locationPoint,withinGTA} from '../utils/eventLocation';
const CENTER={lat:43.8,lng:-79.4};
const OPTIONS={mapId:import.meta.env.VITE_GOOGLE_MAPS_MAP_ID||'DEMO_MAP_ID',disableDefaultUI:true,zoomControl:true,
  clickableIcons:false,gestureHandling:'cooperative',restriction:{latLngBounds:GTA_BOUNDS,strictBounds:true}};
function PreviewPin({map,point,onMove,disabled}) {
  const lat=point?.lat,lng=point?.lng;
  useEffect(()=>{
    if(!map||lat==null||lng==null||!window.google?.maps?.marker) return;
    const marker=new window.google.maps.marker.AdvancedMarkerElement({map,position:{lat,lng},gmpDraggable:!disabled,title:'Event location. Drag to adjust.'});
    const listener=marker.addListener('dragend',event=>{if(event.latLng) onMove({lat:event.latLng.lat(),lng:event.latLng.lng()});});
    return()=>{listener.remove();marker.map=null;};
  },[map,lat,lng,onMove,disabled]);
  return null;
}
export default function EventLocationPicker({value,onChange,confirmed,onConfirm,onBusyChange,error='',mapsReady=true,required=true,disabled=false}) {
  const [manual,setManual]=useState(false),[map,setMap]=useState(null);
  const point=locationPoint(value),valid=withinGTA(point);
  const change=useCallback(fields=>{if(!disabled) {onChange(old=>({...old,...fields}));onConfirm(false);}},[onChange,onConfirm,disabled]);
  const move=useCallback(next=>{if(withinGTA(next)) change({latitude:next.lat,longitude:next.lng,place_id:null});},[change]);
  return <div className="event-location-picker">
    <p className="form-help">Search for a venue or address. We’ll format the address and show a suggested pin for you to check.</p>
    {mapsReady&&!manual&&<LocationSearch initialValue={value.location_address||''} showLabel autoResolve label="Venue or street address" placeholder="Start typing an address in the GTA"
      onBusyChange={onBusyChange}
      onQueryChange={address=>change({location_address:address,latitude:'',longitude:'',place_id:null})}
      onSelected={place=>change({location_address:place.formatted_address,latitude:place.geometry.location.lat(),longitude:place.geometry.location.lng(),place_id:place.place_id})}/>}
    {mapsReady&&<button type="button" className="link address-resolve" aria-expanded={manual} onClick={()=>setManual(old=>!old)}>{manual?'Search for an address instead':'Can’t find the address? Place a pin manually'}</button>}
    {(manual||!mapsReady)&&<div className="manual-location-fields">
      <p className="form-help">Keep the venue or address visitors should use, then click the map or enter the exact coordinates. For a park or temporary venue, describe the entrance or meeting point.</p>
      <label className="form-field"><span>Address or meeting point</span><input className="input input-bordered w-full" value={value.location_address} maxLength={2000} required onChange={event=>change({location_address:event.target.value,place_id:null})}/></label>
      <details className="advanced-fields"><summary>Enter coordinates</summary><div className="form-grid">
        {['latitude','longitude'].map(name=><label className="form-field" key={name}><span>{name==='latitude'?'Latitude':'Longitude'}</span><input type="number" step="any" className="input input-bordered w-full" value={value[name]} onChange={event=>change({[name]:event.target.value,place_id:null})}/></label>)}
      </div></details>
    </div>}
    <div className="location-preview-map" aria-label="Preview of the event location">
      {mapsReady?<GoogleMap mapContainerStyle={{height:'100%',width:'100%'}} options={OPTIONS} center={valid?point:CENTER} zoom={valid?15:10} onLoad={setMap}
        onClick={event=>{if(!disabled&&event.latLng) {setManual(true);move({lat:event.latLng.lat(),lng:event.latLng.lng()});}}}><PreviewPin map={map} point={valid?point:null} onMove={move} disabled={disabled}/></GoogleMap>
        :<p role="status">Map preview is unavailable. Enter coordinates manually and check the event location before continuing.</p>}
    </div>
    {value.location_address&&<p className="confirmed-address"><strong>{value.place_id?'Suggested address':'Address or meeting point'}</strong><span>{value.location_address}</span></p>}
    {!point&&<p className="form-help">Choose a search result or place a pin on the map to continue.</p>}
    {point&&!valid&&<p role="alert" className="text-sm text-error">{GTA_LOCATION_HELP}</p>}
    {point&&valid&&<label className="location-confirmation"><input type="checkbox" className="checkbox checkbox-primary checkbox-sm" checked={confirmed} required={required} onChange={event=>onConfirm(event.target.checked)}/>
      <span>I checked that the address and pin show the correct event location.</span></label>}
    {error&&<p role="alert" className="text-sm text-error">{error}</p>}
  </div>;
}
