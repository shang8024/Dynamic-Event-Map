// Animate both center and fractional zoom: panTo alone jumps for distant pins.
export function createMapCameraMotion(map,{
  requestFrame=callback=>requestAnimationFrame(callback),
  cancelFrame=id=>cancelAnimationFrame(id),
  reducedMotion=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches,
}={}) {
  let motion=null;
  function cancel() {
    if(motion) cancelFrame(motion.frame);
    motion=null;
  }
  function flyTo({center,zoom=map?.getZoom()}) {
    cancel();
    if(!map||!center) return;
    const point=map.getCenter(),fromZoom=map.getZoom();
    const target={center,zoom};
    if(!point||!Number.isFinite(fromZoom)||reducedMotion()) {map.moveCamera(target);return;}
    const from={lat:point.lat(),lng:point.lng()},animation={frame:null,started:null};
    motion=animation;
    function tick(timestamp) {
      if(motion!==animation) return;
      animation.started??=timestamp;
      const progress=Math.min(1,(timestamp-animation.started)/750);
      const eased=progress<.5?4*progress**3:1-(-2*progress+2)**3/2;
      // Let the final SDK idle event publish the settled viewport and markers.
      if(progress===1) motion=null;
      map.moveCamera(progress===1?target:{
        center:{lat:from.lat+(center.lat-from.lat)*eased,lng:from.lng+(center.lng-from.lng)*eased},
        zoom:fromZoom+(zoom-fromZoom)*eased,
      });
      if(motion===animation) animation.frame=requestFrame(tick);
    }
    animation.frame=requestFrame(tick);
  }
  return {flyTo,cancel,isMoving:()=>motion!==null};
}
