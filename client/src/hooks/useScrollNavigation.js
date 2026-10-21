import {useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {canCollapseNavigation,createNavigationScrollTracker} from '../utils/navigationScroll';

const SETTLE_MS=240;
export default function useScrollNavigation(header,routeKey) {
  const [hidden,setHidden]=useState(false),[height,setHeight]=useState(null);
  const measuredHeight=useRef(0);
  const hiddenNow=useRef(false),ignoreUntil=useRef(0),trackers=useRef(new WeakMap()),keyboard=useRef(false);
  const visibility=useCallback(next=>{
    if(hiddenNow.current===next) return;
    hiddenNow.current=next;ignoreUntil.current=Date.now()+SETTLE_MS;setHidden(next);
  },[]);
  const reveal=useCallback(()=>visibility(false),[visibility]);

  useLayoutEffect(()=>{
    const node=header.current;if(!node) return;
    const measure=()=>{
      const value=Math.ceil(node.getBoundingClientRect().height);
      measuredHeight.current=value;
      setHeight(previous=>previous===value?previous:value);
      ignoreUntil.current=Date.now()+SETTLE_MS;
    };
    measure();
    const observer=new ResizeObserver(measure);observer.observe(node);
    return()=>observer.disconnect();
  },[header]);
  useEffect(()=>{
    reveal();trackers.current=new WeakMap();ignoreUntil.current=Date.now()+SETTLE_MS;
  },[routeKey,reveal]);
  useEffect(()=>{
    const scroll=event=>{
      const node=event.target;
      // Google map gestures and nested controls/dialogs are not page scrolling.
      if(!(node instanceof Element)||!node.matches('.app-content,.event-panel')) return;
      let tracker=trackers.current.get(node);
      if(!tracker) {tracker=createNavigationScrollTracker();trackers.current.set(node,tracker);}
      const navigation=header.current;
      const interacting=navigation?.querySelector('details[open]')||keyboard.current&&navigation?.contains(document.activeElement);
      if(interacting) {reveal();tracker.reset(node.scrollTop);return;}
      // Reclaiming header space can clamp scrollTop near the bottom. Ignore that
      // layout movement so it cannot immediately reverse the visibility change.
      if(Date.now()<ignoreUntil.current) {tracker.reset(node.scrollTop);return;}
      const next=tracker.update(node.scrollTop,hiddenNow.current);
      if(next===true&&!canCollapseNavigation(node,measuredHeight.current)) return;
      if(next!==null) visibility(next);
    };
    const focus=event=>{if(header.current?.contains(event.target)) reveal();};
    const key=event=>{if(event.key==='Tab') {keyboard.current=true;reveal();}};
    const pointer=()=>{keyboard.current=false;};
    const gestureTarget=target=>target instanceof Element&&!target.closest('dialog,input,textarea,select,[contenteditable],.map-canvas')&&target.closest('.app-content,.event-panel');
    const wheel=event=>{if(hiddenNow.current&&event.deltaY<-12&&gestureTarget(event.target)) reveal();};
    let touch=null;
    const touchStart=event=>{touch=gestureTarget(event.target)&&event.touches.length===1?{y:event.touches[0].clientY,distance:0}:null;};
    const touchMove=event=>{
      if(!touch||event.touches.length!==1) return;
      const current=event.touches[0].clientY,delta=current-touch.y;touch.y=current;
      touch.distance=delta>0?touch.distance+delta:0;
      if(hiddenNow.current&&touch.distance>=16) reveal();
    };
    document.addEventListener('scroll',scroll,true);
    document.addEventListener('focusin',focus,true);
    document.addEventListener('keydown',key,true);
    document.addEventListener('pointerdown',pointer,true);
    document.addEventListener('wheel',wheel,{passive:true});
    document.addEventListener('touchstart',touchStart,{passive:true});
    document.addEventListener('touchmove',touchMove,{passive:true});
    return()=>{
      document.removeEventListener('scroll',scroll,true);
      document.removeEventListener('focusin',focus,true);
      document.removeEventListener('keydown',key,true);
      document.removeEventListener('pointerdown',pointer,true);
      document.removeEventListener('wheel',wheel);
      document.removeEventListener('touchstart',touchStart);
      document.removeEventListener('touchmove',touchMove);
    };
  },[header,reveal,visibility]);
  return {hidden,height,reveal};
}
