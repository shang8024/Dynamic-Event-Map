import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapCameraMotion} from '../src/utils/mapCamera.js';

function fixture(reduced=false) {
  let id=0;
  const frames=new Map(),moves=[];
  const view={center:{lat:43.8,lng:-79.25},zoom:10};
  const map={getCenter:()=>({lat:()=>view.center.lat,lng:()=>view.center.lng}),getZoom:()=>view.zoom,
    moveCamera:target=>{moves.push(target);Object.assign(view,target);}};
  const camera=createMapCameraMotion(map,{
    requestFrame:callback=>{frames.set(++id,callback);return id;},cancelFrame:key=>frames.delete(key),reducedMotion:()=>reduced,
  });
  return {camera,view,moves,frames,step:time=>{const pending=[...frames.values()];frames.clear();pending.forEach(callback=>callback(time));}};
}

test('pin focus travels through intermediate centers and zooms before settling exactly',()=>{
  const {camera,view,frames,step}=fixture(),target={center:{lat:43.65,lng:-79.4},zoom:15};
  camera.flyTo(target);
  assert.equal(view.zoom,10);
  step(0);step(375);
  assert.ok(view.zoom>10&&view.zoom<15);
  assert.ok(view.center.lat>target.center.lat&&view.center.lat<43.8);
  assert.equal(camera.isMoving(),true);
  step(750);
  assert.deepEqual(view,target);
  assert.equal(camera.isMoving(),false);
  assert.equal(frames.size,0);
});

test('a second pin replaces the previous flight and user cancellation keeps the current view',()=>{
  const {camera,view,frames,step}=fixture();
  camera.flyTo({center:{lat:43.65,lng:-79.4},zoom:15});step(0);step(250);
  const target={center:{lat:43.9,lng:-79.1},zoom:14};
  camera.flyTo(target);step(300);step(1050);
  assert.deepEqual(view,target);
  camera.flyTo({center:{lat:44,lng:-79.3}});step(1100);step(1400);
  const stopped=structuredClone(view);
  camera.cancel();step(2000);
  assert.deepEqual(view,stopped);
  assert.equal(camera.isMoving(),false);
  assert.equal(frames.size,0);
});

test('cluster focus preserves zoom and reduced-motion preference skips animation',()=>{
  const normal=fixture();
  normal.camera.flyTo({center:{lat:43.9,lng:-79.1}});normal.step(0);normal.step(750);
  assert.equal(normal.view.zoom,10);
  const reduced=fixture(true),target={center:{lat:43.7,lng:-79.3},zoom:15};
  reduced.camera.flyTo(target);
  assert.deepEqual(reduced.view,target);
  assert.equal(reduced.moves.length,1);
  assert.equal(reduced.frames.size,0);
});
