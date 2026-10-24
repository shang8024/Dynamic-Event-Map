import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapMarkerLayer} from '../src/services/mapMarkerLayer.js';

function fixture({width=1200,grouped=false}={}) {
  const all=[],contents=[],counts={renders:0,cleared:0};let clusterer,callbacks;
  const layer=createMapMarkerLayer({map:{getDiv:()=>({clientWidth:width}),getCenter:()=>({toJSON:()=>({lat:43.7,lng:-79.4})})},
    createMarker:options=>{const marker={...options,handlers:{},addEventListener(name,fn){this.handlers[name]=fn;}};all.push(marker);return marker;},
    createContent:()=>{const value={element:{},update(state){this.state=state;},dispose(){this.disposed=true;}};contents.push(value);return value;},
    createClusterer:options=>{callbacks=options;clusterer={markers:[],
      addMarkers(values){this.markers.push(...values);},removeMarkers(values){this.markers=this.markers.filter(m=>!values.includes(m));},
      render(){counts.renders++;const clusters=grouped&&this.markers.length>1?[{markers:[...this.markers],position:{lat:()=>43.7,lng:()=>-79.4}}]:this.markers.map(marker=>({markers:[marker],marker}));
        for(const cluster of clusters) if(cluster.markers.length>1) cluster.marker=options.render(cluster);
        options.onClusters(clusters);options.onRendered();},
      clearMarkers(){counts.cleared++;this.markers=[];},setMap(){},};return clusterer;},
  });
  const events=Array.from({length:60},(_,i)=>({id:i+1,title:'Event '+i,position:{lat:43.7+i*.0001,lng:-79.4},data:{image:{url:'https://images.unsplash.com/'+i}}}));
  const props={events,zoom:14,viewport:{north:44,south:43,west:-80,east:-79},onSelect:()=>{},onCluster:()=>{}};
  return {layer,events,props,all,contents,counts,get clusterer(){return clusterer;},get callbacks(){return callbacks;}};
}

test('panning, selecting and callbacks reuse markers and spatial index; clicks use the current callback',()=>{
  const f=fixture();f.layer.update(f.props);const original=[...f.all];let clicked;
  f.layer.update({...f.props,events:f.events.map(e=>({...e,title:e.title+' updated'})),selectedId:2,
    viewport:{north:44.1,south:43.1,west:-80,east:-79},onSelect:id=>{clicked=id;}});
  assert.equal(f.counts.renders,1);assert.equal(f.counts.cleared,0);assert.deepEqual(f.all,original);
  original[1].handlers['gmp-click']();assert.equal(clicked,2);assert.equal(original[1].zIndex,1000);
  assert.match(original[0].title,/updated/);
  f.layer.dispose();assert.equal(f.counts.cleared,1);assert.ok(f.contents.every(content=>content.disposed));
});

test('only moved/removed/added coordinates change membership, while the photo budget preserves all pins',()=>{
  const f=fixture({width:390});f.layer.update(f.props);
  assert.equal(f.clusterer.markers.length,60);assert.equal(f.contents.filter(c=>c.state?.photos).length,24);
  const stable=f.clusterer.markers[10],first=f.clusterer.markers[0];
  f.layer.update({...f.props,events:[{...f.events[0],position:{lat:43.8,lng:-79.4}},...f.events.slice(1)]});
  assert.equal(f.counts.renders,2);assert.equal(f.counts.cleared,0);assert.ok(f.clusterer.markers.includes(stable));assert.ok(!f.clusterer.markers.includes(first));
  f.layer.update({...f.props,events:f.events.slice(1)});assert.equal(f.clusterer.markers.length,59);
  f.layer.dispose();
});

test('cluster selection changes appearance without rebuilding the group or losing its complete event count',()=>{
  const f=fixture({grouped:true});f.layer.update(f.props);const group=f.all.at(-1);let selected;
  f.layer.update({...f.props,selectedId:3,onCluster:ids=>{selected=ids;}});
  assert.equal(f.counts.renders,1);group.handlers['gmp-click']();assert.equal(selected.length,60);
  assert.equal(group.zIndex,1000);assert.equal(f.contents.at(-1).state.count,60);
  f.layer.dispose();
});
