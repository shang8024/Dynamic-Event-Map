import {useJsApiLoader} from '@react-google-maps/api';

const libraries=['marker'];
export default function useGoogleMaps() {
  return useJsApiLoader({id:'eventmap-google-maps',googleMapsApiKey:import.meta.env.VITE_GOOGLE_MAPS_KEY,libraries});
}
