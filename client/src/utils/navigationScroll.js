// Accumulate intentional travel rather than toggling for every touchpad pixel.
export function canCollapseNavigation({scrollHeight,clientHeight},headerHeight) {
  // Leave enough scrollable travel to reveal the header again after reclaiming it.
  return scrollHeight-clientHeight>headerHeight+8;
}
export function createNavigationScrollTracker({initial=0,hideAfter=48,showAfter=16,top=8}={}) {
  let previous=Math.max(0,initial),direction=0,distance=0;
  function reset(position=previous) {previous=Math.max(0,position);direction=0;distance=0;}
  return {
    reset,
    update(position,hidden=false) {
      const current=Math.max(0,position),delta=current-previous;previous=current;
      if(current<=top) {reset(current);return false;}
      if(Math.abs(delta)<1) return null;
      const nextDirection=Math.sign(delta);
      if(nextDirection!==direction) {direction=nextDirection;distance=0;}
      distance+=Math.abs(delta);
      if(!hidden&&direction>0&&current>=hideAfter&&distance>=hideAfter) {reset(current);return true;}
      if(hidden&&direction<0&&distance>=showAfter) {reset(current);return false;}
      return null;
    },
  };
}
